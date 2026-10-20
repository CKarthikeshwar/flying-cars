import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { classifyLanding, impactSpeed, landingAngle } from '../../src/physics/landing';

const deg = (d: number) => (d * Math.PI) / 180;

describe('classifyLanding', () => {
  it('is perfect under 30 degrees and under 8 m/s', () => {
    expect(classifyLanding(deg(0), 0)).toBe('perfect');
    expect(classifyLanding(deg(29.9), 7.9)).toBe('perfect');
  });

  it('is rough from 30 to 60 degrees, or at 8 m/s and above', () => {
    expect(classifyLanding(deg(30), 2)).toBe('rough');
    expect(classifyLanding(deg(45), 2)).toBe('rough');
    expect(classifyLanding(deg(60), 2)).toBe('rough');
    expect(classifyLanding(deg(5), 8)).toBe('rough');
    expect(classifyLanding(deg(5), 30)).toBe('rough');
  });

  it('is a crash only over 60 degrees, whatever the speed', () => {
    expect(classifyLanding(deg(60.1), 0)).toBe('crash');
    expect(classifyLanding(deg(180), 0)).toBe('crash');
    expect(classifyLanding(deg(90), 20)).toBe('crash');
  });
});

describe('landing measurements', () => {
  it('measures the angle between up and the surface normal', () => {
    const up = new Vector3(0, 1, 0);
    expect(landingAngle(up, new Vector3(0, 1, 0))).toBeCloseTo(0);
    expect(landingAngle(up, new Vector3(1, 0, 0))).toBeCloseTo(Math.PI / 2);
    expect(landingAngle(up, new Vector3(0, -1, 0))).toBeCloseTo(Math.PI);
  });

  it('survives rounding past one', () => {
    const a = new Vector3(0, 1.0000001, 0);
    expect(landingAngle(a, new Vector3(0, 1, 0))).toBe(0);
  });

  it('measures impact speed into the surface, and zero when leaving it', () => {
    const n = new Vector3(0, 1, 0);
    expect(impactSpeed(new Vector3(5, -7, 0), n)).toBeCloseTo(7);
    expect(impactSpeed(new Vector3(5, 3, 0), n)).toBe(0);
  });
});
