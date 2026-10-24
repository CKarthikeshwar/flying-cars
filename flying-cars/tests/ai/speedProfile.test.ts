import { describe, expect, it } from 'vitest';
import { buildSpeedProfile } from '../../src/ai/speedProfile';
import { Track } from '../../src/track/Track';
import { testTrackDef } from '../../src/track/tracks/testTrack';
import {
  AI_BRAKE_DECEL,
  AI_LAT_ACCEL,
  AI_MAX_SPEED,
  AI_NORMAL_RATE_MAX,
} from '../../src/util/constants';

const track = new Track(testTrackDef());
const profile = buildSpeedProfile(track);

describe('track curvature', () => {
  it('matches the radius of the turns and the loops', () => {
    // the first flat turn has radius 60 m, the loops 28 m
    const turn = track.curvature.filter((k) => Math.abs(k - 1 / 60) < 0.002).length;
    const loop = track.curvature.filter((k) => Math.abs(k - 1 / 28) < 0.003).length;
    expect(turn).toBeGreaterThan(300); // two half turns of about 190 m
    expect(loop).toBeGreaterThan(250); // two loops of about 176 m
  });

  it('is nearly zero on the straights', () => {
    expect(track.curvature[10]).toBeLessThan(1e-4);
  });
});

describe('buildSpeedProfile', () => {
  it('never asks for more than the cornering limit sqrt(a_lat / kappa)', () => {
    for (let i = 0; i < track.count; i++) {
      const kappa = track.curvature[i] ?? 0;
      if (kappa > 1e-6)
        expect(profile[i]).toBeLessThanOrEqual(Math.sqrt(AI_LAT_ACCEL / kappa) + 1e-9);
      expect(profile[i]).toBeLessThanOrEqual(AI_MAX_SPEED);
    }
  });

  it('never asks the road to turn faster under the car than the rate limit allows', () => {
    for (let i = 0; i < track.count; i++) {
      const rate = track.normalRate[i] ?? 0;
      if (rate > 1e-6)
        expect((profile[i] ?? 0) * rate).toBeLessThanOrEqual(AI_NORMAL_RATE_MAX + 1e-9);
    }
  });

  it('slows down before it has to, no faster than the braking it plans for', () => {
    const n = track.count;
    for (let i = 0; i < n; i++) {
      const here = profile[i] ?? 0;
      const next = profile[(i + 1) % n] ?? 0;
      expect(here * here).toBeLessThanOrEqual(
        next * next + 2 * AI_BRAKE_DECEL * track.spacing + 1e-6,
      );
    }
  });

  it('goes fastest on the straights and slowest in the loops', () => {
    const fastest = Math.max(...profile);
    const slowest = Math.min(...profile);
    expect(fastest).toBeGreaterThan(50);
    expect(slowest).toBeGreaterThan(15);
    expect(slowest).toBeLessThan(25);
  });
});
