import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  addDrag,
  addDriveAndGrip,
  suctionMagnitude,
  surfaceTangent,
  yawRate,
} from '../../src/physics/forces';
import {
  A_MAX,
  BOOST_ACCEL,
  CAR_HALF_HEIGHT,
  CAR_MASS,
  DRAG_C,
  GRAVITY,
  STEER_RATE_MAX,
  SURFACE_RANGE,
} from '../../src/util/constants';

describe('suction', () => {
  it('fades linearly to zero at the surface range', () => {
    expect(suctionMagnitude(SURFACE_RANGE)).toBe(0);
    expect(suctionMagnitude(SURFACE_RANGE + 1)).toBe(0);
    expect(suctionMagnitude(SURFACE_RANGE / 2)).toBeCloseTo(suctionMagnitude(0) / 2);
  });

  it('beats gravity at ride height, so a car on a ceiling stays up', () => {
    const weight = CAR_MASS * GRAVITY;
    expect(suctionMagnitude(CAR_HALF_HEIGHT)).toBeGreaterThan(weight);
  });
});

describe('driving', () => {
  it('projects forward onto the surface', () => {
    const t = new Vector3();
    surfaceTangent(t, new Vector3(0, 0.6, -0.8), new Vector3(0, 1, 0), new Vector3(1, 0, 0));
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(0);
    expect(t.z).toBeCloseTo(-1);
  });

  it('falls back when forward points straight into the surface', () => {
    const t = new Vector3();
    surfaceTangent(t, new Vector3(0, -1, 0), new Vector3(0, 1, 0), new Vector3(1, 0, 0));
    expect(t.length()).toBeCloseTo(1);
    expect(t.y).toBeCloseTo(0);
  });

  it('throttle pushes along the tangent and grip pushes against sideways sliding', () => {
    const out = new Vector3();
    addDriveAndGrip(out, new Vector3(0, 0, -1), new Vector3(0, 1, 0), new Vector3(3, 0, 0), 1);
    expect(out.z).toBeCloseTo(-CAR_MASS * A_MAX);
    expect(out.x).toBeLessThan(0);
    expect(out.y).toBeCloseTo(0);
  });

  it('drag opposes velocity and scales with its square', () => {
    const slow = addDrag(new Vector3(), new Vector3(10, 0, 0), 1);
    const fast = addDrag(new Vector3(), new Vector3(20, 0, 0), 1);
    expect(slow.x).toBeCloseTo(-DRAG_C * 100);
    expect(fast.x / slow.x).toBeCloseTo(4);
  });

  it('cannot turn at a standstill, and turning saturates at speed', () => {
    expect(yawRate(1, 0)).toBeCloseTo(0);
    expect(yawRate(1, 1000)).toBeCloseTo(-STEER_RATE_MAX);
    expect(yawRate(-1, 1000)).toBeCloseTo(STEER_RATE_MAX);
    expect(Math.abs(yawRate(1, 7.5))).toBeCloseTo(STEER_RATE_MAX / 2);
  });

  it('matches the top speed checks from the spec', () => {
    expect(Math.sqrt((CAR_MASS * A_MAX) / DRAG_C)).toBeCloseTo(60.3, 0);
    expect(Math.sqrt((CAR_MASS * (A_MAX + BOOST_ACCEL)) / DRAG_C)).toBeCloseTo(85.3, 0);
  });
});
