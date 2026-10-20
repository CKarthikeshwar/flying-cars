import { describe, expect, it } from 'vitest';
import { FlipCounter } from '../../src/physics/flips';

const DT = 1 / 120;

function spin(counter: FlipCounter, omegaRight: number, omegaForward: number, seconds: number): number {
  let flips = 0;
  for (let t = 0; t < seconds; t += DT) flips += counter.update(omegaRight, omegaForward, DT);
  return flips;
}

describe('FlipCounter', () => {
  it('counts nothing for a partial turn', () => {
    expect(spin(new FlipCounter(), 3, 0, 1)).toBe(0);
  });

  it('counts one flip per full pitch turn, in either direction', () => {
    expect(spin(new FlipCounter(), 2 * Math.PI, 0, 1.01)).toBe(1);
    expect(spin(new FlipCounter(), -2 * Math.PI, 0, 1.01)).toBe(1);
  });

  it('counts roll turns too', () => {
    expect(spin(new FlipCounter(), 0, 2 * Math.PI, 1.01)).toBe(1);
  });

  it('counts two flips for two turns, keeping the overshoot', () => {
    expect(spin(new FlipCounter(), Math.PI, 0, 4.02)).toBe(2);
  });

  it('does not count rocking back and forth', () => {
    const c = new FlipCounter();
    let flips = 0;
    for (let i = 0; i < 5; i++) {
      flips += spin(c, 5, 0, 1);
      flips += spin(c, -5, 0, 1);
    }
    expect(flips).toBe(0);
  });

  it('starts again from zero after a reset', () => {
    const c = new FlipCounter();
    spin(c, 5, 0, 1);
    c.reset();
    expect(c.pitchAngle).toBe(0);
    expect(spin(c, 2 * Math.PI, 0, 0.9)).toBe(0);
  });
});
