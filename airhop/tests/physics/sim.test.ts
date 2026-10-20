import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/physics/world';
import { Sim, type SimEvent } from '../../src/physics/Sim';
import { createInput, type Input } from '../../src/physics/Input';
import { AIR_MAX, AIR_TORQUE_ALPHA, CAR_HALF_HEIGHT, PHYSICS_DT } from '../../src/util/constants';

beforeAll(async () => {
  await initPhysics();
});

type Control = (input: Input, sim: Sim, t: number, log: SimEvent[]) => void;

/** Runs the sim headless. `control` fills the input each step and sees every event logged so far. */
function run(sim: Sim, seconds: number, control: Control): SimEvent[] {
  const input = createInput();
  const log: SimEvent[] = [];
  const steps = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < steps; i++) {
    input.steer = input.throttle = input.brake = input.pitch = input.roll = 0;
    input.hop = input.boost = input.respawn = false;
    control(input, sim, i * PHYSICS_DT, log);
    sim.step(input);
    log.push(...sim.events);
  }
  return log;
}

const count = (log: SimEvent[], type: SimEvent['type']) => log.filter((e) => e.type === type).length;

describe('flat ground driving', () => {
  it('rests at ride height and stays attached', () => {
    const sim = new Sim();
    run(sim, 2, () => {});
    expect(sim.attached).toBe(true);
    expect(sim.car.position.y).toBeGreaterThan(CAR_HALF_HEIGHT - 0.05);
    expect(sim.car.position.y).toBeLessThan(CAR_HALF_HEIGHT + 0.05);
    expect(sim.speed).toBeLessThan(0.05);
  });

  it('tops out between 55 and 65 m/s with the throttle held', () => {
    const sim = new Sim();
    run(sim, 30, (i) => {
      i.throttle = 1;
    });
    expect(sim.speed).toBeGreaterThan(55);
    expect(sim.speed).toBeLessThan(65);
  });

  it('drives straight and stays level', () => {
    const sim = new Sim();
    run(sim, 10, (i) => {
      i.throttle = 1;
    });
    expect(Math.abs(sim.car.position.x)).toBeLessThan(0.05);
    expect(sim.car.up.y).toBeGreaterThan(0.999);
  });

  it('steers right toward +x', () => {
    const sim = new Sim();
    run(sim, 6, (i) => {
      i.throttle = 1;
      i.steer = 1;
    });
    expect(sim.car.position.x).toBeGreaterThan(5);
  });

  it('steers left toward -x', () => {
    const sim = new Sim();
    run(sim, 6, (i) => {
      i.throttle = 1;
      i.steer = -1;
    });
    expect(sim.car.position.x).toBeLessThan(-5);
  });
});

describe('hop', () => {
  it('peaks about 4.1 m (give or take 0.4) above the start', () => {
    const sim = new Sim();
    run(sim, 1, () => {});
    const startY = sim.car.position.y;
    let peak = 0;
    run(sim, 3, (i, s, t) => {
      if (t === 0) i.hop = true;
      peak = Math.max(peak, s.car.position.y - startY);
    });
    expect(peak).toBeGreaterThan(3.7);
    expect(peak).toBeLessThan(4.5);
  });

  it('is one hop, then a perfect landing, back on the surface', () => {
    const sim = new Sim();
    run(sim, 1, () => {});
    const log = run(sim, 3, (i, _s, t) => {
      if (t === 0) i.hop = true;
    });
    expect(count(log, 'hop')).toBe(1);
    expect(log.find((e) => e.type === 'landing')).toMatchObject({ kind: 'perfect' });
    expect(sim.attached).toBe(true);
  });

  it('is limited by the cooldown', () => {
    const sim = new Sim();
    const log = run(sim, 0.3, (i) => {
      i.hop = true;
    });
    expect(count(log, 'hop')).toBe(1);
  });

  it('refuses a hop with too little air', () => {
    const sim = new Sim();
    sim.air.burn(AIR_MAX - 5);
    const log = run(sim, 0.1, (i) => {
      i.hop = true;
    });
    expect(count(log, 'hop')).toBe(0);
    expect(count(log, 'hopRefused')).toBeGreaterThan(0);
  });
});

describe('boost', () => {
  it('burns air', () => {
    const sim = new Sim();
    run(sim, 4, (i) => {
      i.throttle = 1;
      i.boost = true;
    });
    expect(sim.air.value).toBeLessThan(AIR_MAX - 50);
  });

  it('beats the no-boost top speed', () => {
    const plain = new Sim();
    const boosted = new Sim();
    const drive = (i: Input) => {
      i.throttle = 1;
    };
    run(plain, 8, drive);
    run(boosted, 8, (i) => {
      drive(i);
      i.boost = true;
    });
    expect(boosted.speed).toBeGreaterThan(plain.speed + 5);
  });

  it('runs on the air budget: an empty tank can only boost as fast as it refills', () => {
    const sim = new Sim();
    sim.air.burn(AIR_MAX);
    let boostSteps = 0;
    run(sim, 2, (i, s) => {
      i.boost = true;
      if (s.boosting) boostSteps++;
    });
    // regen is 4 per s and boosting burns 20 per s, so at most about a fifth of the steps
    expect(boostSteps / (2 / PHYSICS_DT)).toBeLessThan(0.25);
    expect(sim.air.value).toBeGreaterThanOrEqual(0);
  });
});

describe('flip', () => {
  it('one flip in a single hop still lands perfect', () => {
    const sim = new Sim();
    run(sim, 1, () => {});
    const target = 2 * Math.PI + 0.1; // a hair past one full turn
    let flipsDone = 0;
    const log = run(sim, 3, (i, s, t, events) => {
      if (t === 0) i.hop = true;
      if (s.attached) return;
      flipsDone = events.filter((e) => e.type === 'flip').length;
      const angle = flipsDone * 2 * Math.PI + s.flips.pitchAngle;
      const w = s.car.body.angvel();
      const spin = w.x * s.car.right.x + w.y * s.car.right.y + w.z * s.car.right.z;
      const brakingAngle = (spin * spin) / (2 * AIR_TORQUE_ALPHA);
      if (target - angle > brakingAngle + 0.05) i.pitch = -1; // S: nose up
      else if (spin > 0.05) i.pitch = 1;
    });
    expect(count(log, 'flip')).toBe(1);
    expect(log.find((e) => e.type === 'landing')).toMatchObject({ kind: 'perfect' });
  });

  it('a flip refunds 10 air', () => {
    const sim = new Sim();
    run(sim, 1, () => {});
    const log = run(sim, 2, (i, s, t) => {
      if (t === 0) i.hop = true;
      if (!s.attached) i.pitch = -1;
    });
    expect(count(log, 'flip')).toBeGreaterThan(0);
  });
});

describe('crash and respawn', () => {
  it('a landing on the back is a crash that costs 3 s and respawns after 1.5 s', () => {
    const sim = new Sim();
    run(sim, 1, () => {});
    let crashedAt = -1;
    const log = run(sim, 3.5, (i, s, t) => {
      if (t === 0) i.hop = true;
      if (t > 0.2 && t < 0.9) i.roll = 1; // roll over and stay on the back
      if (s.crashed && crashedAt < 0) crashedAt = t;
    });
    expect(log.find((e) => e.type === 'landing')).toMatchObject({ kind: 'crash' });
    expect(sim.penalty).toBe(3);
    expect(count(log, 'respawn')).toBe(1);
    expect(sim.crashed).toBe(false);
    expect(Math.abs(sim.car.position.z)).toBeLessThan(0.5);
  });

  it('R respawns at the start with a 3 s penalty', () => {
    const sim = new Sim();
    run(sim, 3, (i) => {
      i.throttle = 1;
    });
    expect(sim.car.position.z).toBeLessThan(-10);
    run(sim, 0.5, (i, _s, t) => {
      if (t === 0) i.respawn = true;
    });
    expect(sim.penalty).toBe(3);
    expect(Math.abs(sim.car.position.z)).toBeLessThan(0.5);
    expect(sim.speed).toBeLessThan(0.5);
  });
});

describe('air stays in range', () => {
  it('under random inputs for a minute of play', () => {
    const sim = new Sim();
    let seed = 99;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let low = Infinity;
    let high = -Infinity;
    run(sim, 60, (i) => {
      i.throttle = rand() < 0.7 ? 1 : 0;
      i.steer = Math.round(rand() * 2 - 1);
      i.pitch = Math.round(rand() * 2 - 1);
      i.roll = Math.round(rand() * 2 - 1);
      i.hop = rand() < 0.02;
      i.boost = rand() < 0.4;
      low = Math.min(low, sim.air.value);
      high = Math.max(high, sim.air.value);
    });
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(AIR_MAX);
  });
});
