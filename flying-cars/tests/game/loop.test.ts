import { describe, expect, it } from 'vitest';
import { Accumulator } from '../../src/game/Loop';
import { MAX_FRAME_TIME, PHYSICS_DT } from '../../src/util/constants';

describe('Accumulator', () => {
  it('runs the right number of fixed steps for the time that passed', () => {
    const acc = new Accumulator();
    let steps = 0;
    acc.tick(0.05, () => steps++);
    expect(steps).toBe(Math.floor(0.05 / PHYSICS_DT));
  });

  it('carries the leftover time into the next frame and reports it as alpha', () => {
    const acc = new Accumulator();
    let steps = 0;
    const alpha = acc.tick(PHYSICS_DT * 1.5, () => steps++);
    expect(steps).toBe(1);
    expect(alpha).toBeCloseTo(0.5);
    acc.tick(PHYSICS_DT * 0.5, () => steps++);
    expect(steps).toBe(2);
  });

  it('gives the same number of steps in total at 30, 60 and 144 fps', () => {
    for (const fps of [30, 60, 144]) {
      const acc = new Accumulator();
      let steps = 0;
      for (let i = 0; i < fps * 10; i++) acc.tick(1 / fps, () => steps++);
      expect(Math.abs(steps - 1200)).toBeLessThanOrEqual(1);
    }
  });

  it('caps a long stall so the game slows down instead of freezing', () => {
    const acc = new Accumulator();
    let steps = 0;
    acc.tick(5, () => steps++);
    expect(steps).toBe(Math.round(MAX_FRAME_TIME / PHYSICS_DT));
  });
});
