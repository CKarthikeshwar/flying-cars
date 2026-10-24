import { beforeAll, describe, expect, it } from 'vitest';
import { Keyboard } from '../../src/input/keyboard';
import { Sim, type SimEvent } from '../../src/physics/Sim';
import { createInput, type Input } from '../../src/physics/Input';
import { initPhysics } from '../../src/physics/world';
import {
  DASH_COOLDOWN,
  DASH_COST,
  DASH_DOUBLE_TAP,
  PHYSICS_DT,
  RETRO_MIN_SPEED,
} from '../../src/util/constants';

beforeAll(async () => {
  await initPhysics();
});

type Control = (input: Input, sim: Sim, t: number) => void;

function run(sim: Sim, seconds: number, control: Control): SimEvent[] {
  const input = createInput();
  const log: SimEvent[] = [];
  const steps = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < steps; i++) {
    Object.assign(input, createInput());
    control(input, sim, i * PHYSICS_DT);
    sim.step(input);
    log.push(...sim.events);
  }
  return log;
}

/** A sim that has settled on the floor and then accelerated to about `speed` m/s. */
function atSpeed(speed: number): Sim {
  const sim = new Sim();
  run(sim, 1, () => {});
  run(sim, 12, (i, s) => {
    i.throttle = s.speed < speed ? 1 : 0;
    i.boost = s.speed < speed - 10;
  });
  return sim;
}

/** How high the car gets and how far it travels forward during one hop. */
function hopShape(style: number) {
  const sim = atSpeed(30);
  sim.air.value = 100;
  const start = sim.car.position.clone();
  let apex = 0;
  let airSteps = 0;
  run(sim, 4, (i, s, now) => {
    i.hop = now === 0;
    i.hopStyle = style;
    apex = Math.max(apex, s.car.position.y - start.y);
    if (!s.attached) airSteps++;
  });
  return { apex, air: airSteps * PHYSICS_DT, spent: 100 - sim.air.value };
}

describe('side dash', () => {
  it('slides the car across the road and costs air', () => {
    const sim = atSpeed(25);
    sim.air.value = 100;
    const x0 = sim.car.position.x;
    const log = run(sim, 1.2, (i, _s, now) => {
      i.throttle = 1;
      i.dash = now === 0 ? 1 : 0; // right
    });
    expect(log.some((e) => e.type === 'dash' && e.direction === 1)).toBe(true);
    const shift = sim.car.position.x - x0;
    expect(shift).toBeGreaterThan(2.5); // a real lane change
    expect(shift).toBeLessThan(8);
    expect(Math.abs(sim.car.velocity.x)).toBeLessThan(1); // and then the grip holds the car again
    expect(100 - sim.air.value).toBeGreaterThan(DASH_COST / 2); // some is regenerated on the road meanwhile
  });

  it('goes the other way for left', () => {
    const sim = atSpeed(25);
    const x0 = sim.car.position.x;
    run(sim, 1.2, (i, _s, now) => {
      i.throttle = 1;
      i.dash = now === 0 ? -1 : 0;
    });
    expect(sim.car.position.x - x0).toBeLessThan(-2.5);
  });

  it('is refused without the air, and waits out its cooldown', () => {
    const empty = atSpeed(25);
    empty.air.value = DASH_COST - 1;
    const log = run(empty, 0.1, (i) => {
      i.dash = 1;
    });
    expect(log.some((e) => e.type === 'dash')).toBe(false);

    const sim = atSpeed(25);
    sim.air.value = 100;
    const dashes = run(sim, DASH_COOLDOWN * 0.8, (i) => {
      i.dash = 1; // held down: only one may fire
    }).filter((e) => e.type === 'dash');
    expect(dashes.length).toBe(1);
  });

  it('works in the air, sideways from the car', () => {
    const sim = atSpeed(25);
    sim.air.value = 100;
    let side = 0;
    run(sim, 0.9, (i, s, now) => {
      i.hop = now === 0;
      i.dash = now > 0.3 && now < 0.31 ? 1 : 0;
      side = s.car.velocity.x;
    });
    expect(side).toBeGreaterThan(8);
  });
});

describe('brake jet', () => {
  /** Distance covered while braking from 45 m/s down to 15 m/s. */
  const stop = (retro: boolean) => {
    const sim = atSpeed(45);
    sim.air.value = 100;
    const z0 = sim.car.position.z;
    let used = 0;
    let travelled = Infinity;
    run(sim, 2, (i, s) => {
      i.brake = 1;
      i.retro = retro;
      if (s.retroing) used++;
      if (travelled === Infinity && s.speed < 15) travelled = Math.abs(s.car.position.z - z0);
    });
    return { travelled, used };
  };

  it('stops the car much faster than the plain brake, and costs air', () => {
    const plain = stop(false);
    const jets = stop(true);
    expect(plain.used).toBe(0);
    expect(jets.used).toBeGreaterThan(30);
    expect(jets.travelled).toBeLessThan(plain.travelled * 0.8);
  });

  it('shuts off below its minimum speed and with an empty tank', () => {
    const slow = new Sim();
    run(slow, 1, () => {});
    let fired = false;
    run(slow, 1, (i, s) => {
      i.retro = true;
      if (s.retroing) fired = true;
    });
    expect(fired).toBe(false);
    expect(RETRO_MIN_SPEED).toBeGreaterThan(0);

    const dry = atSpeed(40);
    dry.air.value = 0;
    let dryFired = 0;
    run(dry, 0.3, (i, s) => {
      i.retro = true;
      if (s.retroing) dryFired++;
    });
    expect(dryFired).toBeLessThan(14); // only the trickle of air that regenerates on the road: about 4 of every 14 steps
  });
});

describe('slam', () => {
  /** Hop, then (optionally) slam from the top of the jump. Returns the time spent in the air. */
  const jump = (slam: boolean) => {
    const sim = atSpeed(30);
    sim.air.value = 100;
    let air = 0;
    let slammed = 0;
    const log = run(sim, 4, (i, s, now) => {
      i.hop = now === 0;
      i.hopStyle = -1;
      i.slam = slam && now > 0.45;
      if (!s.attached) air += PHYSICS_DT;
      if (s.slamming) slammed++;
    });
    return { air, slammed, log, sim };
  };

  it('brings the car down sooner than a plain fall', () => {
    const plain = jump(false);
    const slam = jump(true);
    expect(plain.slammed).toBe(0);
    expect(slam.slammed).toBeGreaterThan(10);
    expect(slam.air).toBeLessThan(plain.air - 0.15);
  });

  it('lands softly, as a perfect landing, not a rough one', () => {
    const { log } = jump(true);
    const landing = log.find((e) => e.type === 'landing');
    expect(landing).toBeDefined();
    expect(landing?.type === 'landing' && landing.kind).toBe('perfect');
  });

  it('does nothing on the road or with an empty tank', () => {
    const sim = atSpeed(20);
    let slammed = false;
    run(sim, 0.5, (i, s) => {
      i.slam = true;
      if (s.slamming) slammed = true;
    });
    expect(slammed).toBe(false);

    const dry = atSpeed(30);
    dry.air.value = 20;
    let dryAir = 0;
    run(dry, 1, (i, s, now) => {
      i.hop = now === 0;
      if (now === 0.1) s.air.value = 0;
      i.slam = now > 0.2;
      if (s.slamming) dryAir++;
    });
    expect(dryAir).toBe(0);
  });
});

describe('hop styles', () => {
  it('a boosted hop is a long, low jump and a held-back hop is a high one', () => {
    const normal = hopShape(0);
    const long = hopShape(1);
    const high = hopShape(-1);
    expect(high.apex).toBeGreaterThan(normal.apex * 1.3);
    expect(long.air).toBeGreaterThan(normal.air * 0.8);
    expect(high.spent).toBeGreaterThan(normal.spent);
    expect(long.spent).toBeGreaterThan(normal.spent);
  });

  it('a long hop covers more ground than a normal one', () => {
    const distance = (style: number) => {
      const sim = atSpeed(30);
      sim.air.value = 100;
      const z0 = sim.car.position.z;
      run(sim, 1.2, (i, _s, now) => {
        i.hop = now === 0;
        i.hopStyle = style;
      });
      return Math.abs(sim.car.position.z - z0);
    };
    expect(distance(1)).toBeGreaterThan(distance(0));
  });
});

describe('keyboard: the new moves', () => {
  const key = (kb: Keyboard, type: 'keyDown' | 'keyUp', code: string, timeStamp: number) =>
    (kb as unknown as Record<'keyDown' | 'keyUp', (e: object) => void>)[type]({
      code,
      repeat: false,
      shiftKey: false,
      timeStamp,
      preventDefault() {},
    });

  it('a quick double tap of D dashes right, once', () => {
    const kb = new Keyboard();
    key(kb, 'keyDown', 'KeyD', 1000);
    key(kb, 'keyUp', 'KeyD', 1050);
    expect(kb.poll().dash).toBe(0);
    key(kb, 'keyDown', 'KeyD', 1000 + (DASH_DOUBLE_TAP * 1000) / 2);
    expect(kb.poll().dash).toBe(1);
    expect(kb.poll().dash).toBe(0);
  });

  it('a double tap of A dashes left, and slow taps do not dash', () => {
    const kb = new Keyboard();
    key(kb, 'keyDown', 'KeyA', 0);
    key(kb, 'keyUp', 'KeyA', 50);
    key(kb, 'keyDown', 'KeyA', 100);
    expect(kb.poll().dash).toBe(-1);

    const slow = new Keyboard();
    key(slow, 'keyDown', 'KeyD', 0);
    key(slow, 'keyUp', 'KeyD', 50);
    key(slow, 'keyDown', 'KeyD', DASH_DOUBLE_TAP * 1000 + 400);
    expect(slow.poll().dash).toBe(0);
  });

  it('a third tap right after a dash starts a new count', () => {
    const kb = new Keyboard();
    for (const t of [0, 100, 200]) key(kb, 'keyDown', 'KeyD', t);
    expect(kb.poll().dash).toBe(1); // the second tap
    expect(kb.poll().dash).toBe(0); // the third is only a first tap
  });

  it('S fires the brake jets and sets the high hop, X slams, boost sets the long hop', () => {
    const kb = new Keyboard();
    key(kb, 'keyDown', 'KeyS', 0);
    let i = kb.poll();
    expect(i.retro).toBe(true);
    expect(i.hopStyle).toBe(-1);
    key(kb, 'keyUp', 'KeyS', 10);
    key(kb, 'keyDown', 'ShiftLeft', 20);
    i = kb.poll();
    expect(i.retro).toBe(false);
    expect(i.hopStyle).toBe(1);
    expect(i.slam).toBe(false);
    key(kb, 'keyDown', 'KeyX', 30);
    expect(kb.poll().slam).toBe(true);
    key(kb, 'keyUp', 'KeyX', 40);
    expect(kb.poll().slam).toBe(false);
  });
});
