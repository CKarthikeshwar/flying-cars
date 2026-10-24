import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  GhostPlayer,
  GhostRecorder,
  decodeGhost,
  encodeGhost,
  type GhostData,
} from '../../src/game/Ghost';
import { GHOST_DT } from '../../src/util/constants';

/** A lap where the car goes round a circle of radius 50 m at 20 m/s, recorded every physics step. */
function circleLap(seconds = 10): { data: GhostData; truth: { t: number; p: Vector3 }[] } {
  const rec = new GhostRecorder();
  rec.begin();
  const truth: { t: number; p: Vector3 }[] = [];
  const dt = 1 / 120;
  for (let t = dt; t <= seconds + 1e-9; t += dt) {
    const a = (t * 20) / 50;
    const p = new Vector3(50 * Math.cos(a), 0, 50 * Math.sin(a));
    truth.push({ t, p });
    rec.offer(t, p, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -a), t * 20);
  }
  const data = rec.finish(seconds);
  if (!data) throw new Error('nothing recorded');
  return { data, truth };
}

describe('GhostRecorder', () => {
  it('keeps one sample every 1/30 s, not one per physics step', () => {
    const { data } = circleLap(10);
    const samples = data.samples.length / 9;
    expect(samples).toBeGreaterThan(10 * 30 - 3);
    expect(samples).toBeLessThan(10 * 30 + 3);
  });

  it('returns nothing for a lap with no samples', () => {
    const rec = new GhostRecorder();
    rec.begin();
    expect(rec.finish(5)).toBeNull();
  });

  it('forgets the previous lap when a new one begins', () => {
    const rec = new GhostRecorder();
    rec.begin();
    rec.offer(0.1, new Vector3(), new Quaternion(), 1);
    rec.begin();
    expect(rec.finish(1)).toBeNull();
  });

  it('never lets progress go backwards, so it can be searched', () => {
    const rec = new GhostRecorder();
    rec.begin();
    let t = 0;
    for (const p of [0, 5, 10, 8, 12, 11, 20]) {
      t += GHOST_DT;
      rec.offer(t, new Vector3(), new Quaternion(), p);
    }
    const data = rec.finish(t);
    const progress = Array.from({ length: 7 }, (_, i) => data?.samples[i * 9 + 8] ?? -1);
    expect(progress).toEqual([0, 5, 10, 10, 12, 12, 20]);
  });
});

describe('GhostPlayer', () => {
  it('replays the recorded poses exactly at the recorded times', () => {
    const { data } = circleLap(10);
    const ghost = new GhostPlayer(data);
    const pos = new Vector3();
    const quat = new Quaternion();
    for (let i = 0; i < data.samples.length / 9; i += 7) {
      const t = data.samples[i * 9] ?? 0;
      ghost.poseAt(t, pos, quat);
      expect(pos.x).toBeCloseTo(data.samples[i * 9 + 1] ?? 0, 4);
      expect(pos.y).toBeCloseTo(data.samples[i * 9 + 2] ?? 0, 4);
      expect(pos.z).toBeCloseTo(data.samples[i * 9 + 3] ?? 0, 4);
    }
  });

  it('matches where the car really was to within 5 cm, between samples too', () => {
    const { data, truth } = circleLap(10);
    const ghost = new GhostPlayer(data);
    const pos = new Vector3();
    const quat = new Quaternion();
    let worst = 0;
    for (const { t, p } of truth) {
      ghost.poseAt(t, pos, quat);
      worst = Math.max(worst, pos.distanceTo(p));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('holds the last pose after the lap ends and the first before it starts', () => {
    const { data } = circleLap(2);
    const ghost = new GhostPlayer(data);
    const a = new Vector3();
    const b = new Vector3();
    const q = new Quaternion();
    ghost.poseAt(50, a, q);
    ghost.poseAt(100, b, q);
    expect(a.distanceTo(b)).toBe(0);
    ghost.poseAt(-5, a, q);
    ghost.poseAt(0, b, q);
    expect(a.distanceTo(b)).toBe(0);
  });

  it('maps progress to time: how long the ghost took to get that far', () => {
    const { data } = circleLap(10); // progress = 20 m per second
    const ghost = new GhostPlayer(data);
    expect(ghost.timeAtProgress(100)).toBeCloseTo(5, 1);
    expect(ghost.timeAtProgress(20)).toBeCloseTo(1, 1);
    expect(ghost.timeAtProgress(-10)).toBeLessThan(0.1);
    expect(ghost.timeAtProgress(1e6)).toBe(10); // past the end: the lap time
  });

  it('says how far ahead or behind a slower or faster car is', () => {
    const { data } = circleLap(10);
    const ghost = new GhostPlayer(data);
    // a car that reached 100 m after 4 s is 1 s ahead of the ghost (which took 5 s)
    expect(4 - ghost.timeAtProgress(100)).toBeCloseTo(-1, 1);
    expect(6 - ghost.timeAtProgress(100)).toBeCloseTo(1, 1);
  });
});

describe('ghost storage format', () => {
  it('round-trips through a string without changing a sample', () => {
    const { data } = circleLap(5);
    const back = decodeGhost(encodeGhost(data));
    expect(back).not.toBeNull();
    expect(back?.lapTime).toBe(data.lapTime);
    expect(Array.from(back?.samples ?? [])).toEqual(Array.from(data.samples));
  });

  it('rejects anything that is not a ghost', () => {
    expect(decodeGhost('')).toBeNull();
    expect(decodeGhost('hello')).toBeNull();
    expect(decodeGhost('12.5|!!!not base64!!!')).toBeNull();
    expect(decodeGhost('abc|AAAA')).toBeNull();
    expect(decodeGhost('12.5|AAAA')).toBeNull(); // wrong length for whole samples
  });
});
