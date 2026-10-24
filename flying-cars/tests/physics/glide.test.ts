import { beforeAll, describe, expect, it } from 'vitest';
import { Keyboard } from '../../src/input/keyboard';
import { Sim, type SimEvent } from '../../src/physics/Sim';
import { createInput, type Input } from '../../src/physics/Input';
import { initPhysics } from '../../src/physics/world';
import {
  AIR_MAX,
  GLIDE_HOLD_SECONDS,
  GLIDE_RATE,
  HOP_COST,
  PHYSICS_DT,
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
    input.steer = input.throttle = input.brake = input.pitch = input.roll = 0;
    input.hop = input.boost = input.respawn = input.glide = false;
    control(input, sim, i * PHYSICS_DT);
    sim.step(input);
    log.push(...sim.events);
  }
  return log;
}

/** Seconds spent off the road during a hop that starts at t = 0. */
function airtime(sim: Sim, glideFrom: number | null, seconds = 6): number {
  let t = 0;
  run(sim, seconds, (i, s, now) => {
    if (now === 0) i.hop = true;
    if (glideFrom !== null && now >= glideFrom) i.glide = true;
    if (!s.attached) t += PHYSICS_DT;
  });
  return t;
}

describe('glide', () => {
  it('keeps the car in the air longer than a plain hop', () => {
    const plain = new Sim();
    const gliding = new Sim();
    run(plain, 1, () => {});
    run(gliding, 1, () => {});
    const a = airtime(plain, null);
    const b = airtime(gliding, 0.4);
    expect(a).toBeGreaterThan(1.5);
    expect(a).toBeLessThan(2);
    expect(b).toBeGreaterThan(a + 0.5);
  });

  it('costs air for as long as it lasts', () => {
    const sim = new Sim();
    run(sim, 1, () => {});
    const before = sim.air.value;
    let glideSteps = 0;
    run(sim, 1.5, (i, s, now) => {
      if (now === 0) i.hop = true;
      if (now >= 0.4) {
        i.glide = true;
        if (s.gliding) glideSteps++;
      }
    });
    const spent = before - sim.air.value + 4 * 1.5; // add back the regeneration while on the road
    expect(glideSteps).toBeGreaterThan(60);
    expect(spent).toBeGreaterThan(HOP_COST + GLIDE_RATE * glideSteps * PHYSICS_DT * 0.8);
  });

  it('does nothing on the road, and a plain hop never glides', () => {
    const sim = new Sim();
    let glided = false;
    run(sim, 2, (i, s) => {
      i.glide = true; // held on the road
      if (s.gliding) glided = true;
    });
    expect(glided).toBe(false);

    const hopOnly = new Sim();
    run(hopOnly, 1, () => {});
    let glidedInHop = false;
    run(hopOnly, 3, (i, s, now) => {
      if (now === 0) i.hop = true;
      if (s.gliding) glidedInHop = true;
    });
    expect(glidedInHop).toBe(false);
  });

  it('stops when the tank is empty', () => {
    const sim = new Sim();
    run(sim, 1, () => {});
    let steps = 0;
    run(sim, 2.5, (i, s, now) => {
      if (now === 0) i.hop = true;
      if (now === 0.4) s.air.burn(AIR_MAX); // run the tank dry mid-glide
      if (now >= 0.4) i.glide = true;
      if (s.gliding) steps++;
    });
    expect(steps).toBeLessThan(5);
    expect(sim.air.value).toBeGreaterThanOrEqual(0);
  });

  it('steers the flight toward the way the car points, keeping its speed', () => {
    const heading = (s: Sim) => Math.atan2(s.car.velocity.x, s.car.velocity.z);
    const horizontal = (s: Sim) => Math.hypot(s.car.velocity.x, s.car.velocity.z);

    const flyer = (glide: boolean) => {
      const sim = new Sim();
      run(sim, 1, () => {});
      // get up to speed going straight, then hop and yaw the car left while in the air
      run(sim, 4, (i) => {
        i.throttle = 1;
      });
      const before = heading(sim);
      const speedBefore = horizontal(sim);
      run(sim, 1.2, (i, _s, now) => {
        if (now === 0) i.hop = true;
        if (now > 0.2 && now < 0.7) i.steer = -1; // yaw left in the air
        if (glide && now >= 0.3) i.glide = true;
      });
      return { turned: Math.abs(heading(sim) - before), speedBefore, speedAfter: horizontal(sim) };
    };

    const free = flyer(false);
    const glide = flyer(true);
    expect(free.turned).toBeLessThan(0.05); // a plain hop flies straight whatever the car does
    expect(glide.turned).toBeGreaterThan(0.2); // gliding swings the flight toward the car's heading
    expect(glide.speedAfter).toBeGreaterThan(glide.speedBefore * 0.8);
  });

  it('keeps the air in range through a long random mix of gliding, boosting and hopping', () => {
    const sim = new Sim();
    let seed = 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let low = Infinity;
    let high = -Infinity;
    run(sim, 40, (i) => {
      i.throttle = 1;
      i.hop = rand() < 0.03;
      i.glide = rand() < 0.5;
      i.boost = rand() < 0.3;
      i.steer = Math.round(rand() * 2 - 1);
      low = Math.min(low, sim.air.value);
      high = Math.max(high, sim.air.value);
    });
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(AIR_MAX);
  });
});

describe('the Space key', () => {
  const press = (kb: Keyboard, code: string) =>
    (kb as unknown as { keyDown: (e: object) => void }).keyDown({
      code,
      repeat: false,
      shiftKey: false,
      preventDefault() {},
    });
  const release = (kb: Keyboard, code: string) =>
    (kb as unknown as { keyUp: (e: object) => void }).keyUp({ code, shiftKey: false });

  it('a tap is a hop and not a glide', () => {
    const kb = new Keyboard();
    press(kb, 'Space');
    const first = kb.poll();
    expect(first.hop).toBe(true);
    expect(first.glide).toBe(false);
    for (let i = 0; i < Math.floor((GLIDE_HOLD_SECONDS / PHYSICS_DT) * 0.5); i++) {
      expect(kb.poll().glide).toBe(false);
    }
    release(kb, 'Space');
    expect(kb.poll().glide).toBe(false);
  });

  it('holding it long enough becomes a glide, and releasing it stops the glide', () => {
    const kb = new Keyboard();
    press(kb, 'Space');
    let glide = false;
    for (let i = 0; i < Math.ceil((GLIDE_HOLD_SECONDS / PHYSICS_DT) * 1.2); i++)
      glide = kb.poll().glide;
    expect(glide).toBe(true);
    release(kb, 'Space');
    expect(kb.poll().glide).toBe(false);
  });
});
