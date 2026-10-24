import type { Quaternion, Vector3 } from 'three';
import { GHOST_DT } from '../util/constants';

/** Floats per recorded sample: time, position (3), orientation (4), progress along the lap. */
const STRIDE = 9;

/** One recorded lap: the car's pose every 1/30 s, and how far round the lap it was at each sample. */
export interface GhostData {
  /** Lap time in seconds. */
  lapTime: number;
  /** Packed samples: [t, x, y, z, qx, qy, qz, qw, progress] repeated. */
  samples: Float32Array;
}

/** Records a lap as it is driven. */
export class GhostRecorder {
  private data: number[] = [];
  private nextTime = 0;
  private bestProgress = 0;

  /** Starts a new lap. */
  begin(): void {
    this.data = [];
    this.nextTime = 0;
    this.bestProgress = 0;
  }

  /**
   * Offers the car's state at `time` seconds into the lap. A sample is kept once every GHOST_DT.
   * `progress` is metres round the lap; it is kept from ever going backwards so it can be searched.
   */
  offer(time: number, position: Vector3, quaternion: Quaternion, progress: number): void {
    if (time < this.nextTime - 1e-6) return; // (a hair of tolerance: times land on sample boundaries)
    this.nextTime = (Math.floor(time / GHOST_DT + 1e-6) + 1) * GHOST_DT;
    this.add(time, position, quaternion, progress);
  }

  /**
   * Records a sample now, whatever the cadence. Used for the exact start and end of a lap, so the ghost
   * has no stale stretch there.
   */
  add(time: number, position: Vector3, quaternion: Quaternion, progress: number): void {
    this.bestProgress = Math.max(this.bestProgress, progress);
    this.data.push(
      time,
      position.x,
      position.y,
      position.z,
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w,
      this.bestProgress,
    );
  }

  /** Ends the lap and returns what was recorded, or null if nothing was. */
  finish(lapTime: number): GhostData | null {
    if (this.data.length === 0) return null;
    return { lapTime, samples: Float32Array.from(this.data) };
  }
}

/** Replays a recorded lap: where the ghost is at a given time, and how far round the lap it was. */
export class GhostPlayer {
  readonly data: GhostData;
  private readonly count: number;

  constructor(data: GhostData) {
    this.data = data;
    this.count = Math.floor(data.samples.length / STRIDE);
  }

  get lapTime(): number {
    return this.data.lapTime;
  }

  /** Writes the interpolated pose at `time` seconds into the lap. Holds the last pose after the end. */
  poseAt(time: number, outPosition: Vector3, outQuaternion: Quaternion): void {
    const s = this.data.samples;
    if (this.count === 0) return;
    const i = this.indexBefore(time);
    const j = Math.min(i + 1, this.count - 1);
    const t0 = s[i * STRIDE] ?? 0;
    const t1 = s[j * STRIDE] ?? 0;
    const f = t1 > t0 ? Math.min(1, Math.max(0, (time - t0) / (t1 - t0))) : 0;
    const at = (k: number, o: number) => s[k * STRIDE + o] ?? 0;
    outPosition.set(
      at(i, 1) + (at(j, 1) - at(i, 1)) * f,
      at(i, 2) + (at(j, 2) - at(i, 2)) * f,
      at(i, 3) + (at(j, 3) - at(i, 3)) * f,
    );
    // Normalised linear blend is accurate enough between samples a thirtieth of a second apart.
    outQuaternion
      .set(
        at(i, 4) + (at(j, 4) - at(i, 4)) * f,
        at(i, 5) + (at(j, 5) - at(i, 5)) * f,
        at(i, 6) + (at(j, 6) - at(i, 6)) * f,
        at(i, 7) + (at(j, 7) - at(i, 7)) * f,
      )
      .normalize();
  }

  /** The time (seconds into the lap) at which the ghost had gone `progress` metres round the lap. */
  timeAtProgress(progress: number): number {
    const s = this.data.samples;
    let lo = 0;
    let hi = this.count - 1;
    if (hi < 0) return 0;
    if (progress <= (s[8] ?? 0)) return s[0] ?? 0;
    if (progress >= (s[hi * STRIDE + 8] ?? 0)) return this.data.lapTime;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((s[mid * STRIDE + 8] ?? 0) <= progress) lo = mid;
      else hi = mid;
    }
    const p0 = s[lo * STRIDE + 8] ?? 0;
    const p1 = s[hi * STRIDE + 8] ?? 0;
    const t0 = s[lo * STRIDE] ?? 0;
    const t1 = s[hi * STRIDE] ?? 0;
    return p1 > p0 ? t0 + ((progress - p0) / (p1 - p0)) * (t1 - t0) : t0;
  }

  /** Index of the last sample at or before `time`. */
  private indexBefore(time: number): number {
    const s = this.data.samples;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((s[mid * STRIDE] ?? 0) <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

/** Packs a ghost into a string, for localStorage. */
export function encodeGhost(data: GhostData): string {
  const bytes = new Uint8Array(
    data.samples.buffer,
    data.samples.byteOffset,
    data.samples.byteLength,
  );
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `${data.lapTime}|${btoa(binary)}`;
}

/** The reverse of encodeGhost. Returns null for anything that does not decode cleanly. */
export function decodeGhost(text: string): GhostData | null {
  const bar = text.indexOf('|');
  if (bar < 0) return null;
  const lapTime = Number(text.slice(0, bar));
  if (!Number.isFinite(lapTime)) return null;
  try {
    const binary = atob(text.slice(bar + 1));
    if (binary.length === 0 || binary.length % (STRIDE * 4) !== 0) return null;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { lapTime, samples: new Float32Array(bytes.buffer) };
  } catch {
    return null;
  }
}
