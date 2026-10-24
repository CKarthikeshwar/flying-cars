import type { Vector3 } from 'three';
import type { Track, TrackFrame } from './Track';

/** How far behind and ahead of the last sample to look for the nearest one, in samples. */
const WINDOW_BACK = 15;
const WINDOW_AHEAD = 45;
/** If the nearest sample in the window is farther than this (metres) the car has jumped, so search everywhere. */
const LOST_DISTANCE = 20;

/**
 * Follows a car along a track by remembering the nearest road sample. Searching only a window around the
 * last answer keeps it cheap and stops it jumping to another part of the road that happens to pass close
 * (the two ends of a loop are only a road width apart).
 */
export class TrackProgress {
  /** Index of the road sample nearest the car. */
  index = 0;

  private readonly track: Track;

  constructor(track: Track) {
    this.track = track;
  }

  /** Searches the whole track. Use after a teleport such as a respawn. */
  locate(position: Vector3): number {
    this.index = this.search(position, 0, this.track.count);
    return this.index;
  }

  /** Updates from the car's current position and returns the nearest sample index. */
  update(position: Vector3): number {
    const n = this.track.count;
    const start = (this.index - WINDOW_BACK + n) % n;
    const found = this.search(position, start, WINDOW_BACK + WINDOW_AHEAD);
    const frame = this.track.frames[found] as TrackFrame;
    if (frame.position.distanceTo(position) > LOST_DISTANCE) return this.locate(position);
    this.index = found;
    return found;
  }

  /** Distance from the start line to the nearest sample, metres. */
  get lapDistance(): number {
    return this.track.lapDistance(this.index);
  }

  private search(position: Vector3, from: number, count: number): number {
    const n = this.track.count;
    let best = Infinity;
    let bestIndex = from % n;
    for (let k = 0; k < count; k++) {
      const i = (from + k) % n;
      const d = position.distanceToSquared((this.track.frames[i] as TrackFrame).position);
      if (d < best) {
        best = d;
        bestIndex = i;
      }
    }
    return bestIndex;
  }
}
