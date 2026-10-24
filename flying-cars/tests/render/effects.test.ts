import { describe, expect, it } from 'vitest';
import { Quaternion, Scene, Vector3 } from 'three';
import { Effects, jetsFor, type EmitterPose, type StreamState } from '../../src/render/effects';
import { ParticlePool } from '../../src/render/particles';
import { BOOST_PUFFS_PER_S, GLIDE_PUFFS_PER_S, HOP_PUFFS } from '../../src/util/constants';

const FRAME = 1 / 60;

function pose(
  x = 0,
  y = 0,
  z = 0,
  velocity = new Vector3(),
  quaternion = new Quaternion(),
): EmitterPose {
  return { position: new Vector3(x, y, z), quaternion, velocity };
}

const still: StreamState = {
  boosting: false,
  gliding: false,
  retro: false,
  slam: false,
  airborne: false,
  pitch: 0,
  roll: 0,
  steer: 0,
};

/** Positions of the live particles in a pool, as vectors. */
function live(pool: ParticlePool): { p: Vector3; v: Vector3 }[] {
  const out: { p: Vector3; v: Vector3 }[] = [];
  for (let i = 0; i < pool.capacity; i++) {
    if ((pool.life[i] ?? 0) <= 0) continue;
    out.push({
      p: new Vector3(pool.position[i * 3], pool.position[i * 3 + 1], pool.position[i * 3 + 2]),
      v: new Vector3(pool.velocity[i * 3], pool.velocity[i * 3 + 1], pool.velocity[i * 3 + 2]),
    });
  }
  return out;
}

describe('ParticlePool', () => {
  it('starts empty, and counts what is spawned', () => {
    const pool = new ParticlePool(10);
    expect(pool.alive()).toBe(0);
    pool.spawn(0, 0, 0, 1, 0, 0, 1, 1, 2, 1, 1, 1);
    pool.spawn(0, 0, 0, 1, 0, 0, 1, 1, 2, 1, 1, 1);
    expect(pool.alive()).toBe(2);
  });

  it('moves particles by their velocity and ages them to their end of life', () => {
    const pool = new ParticlePool(4);
    pool.spawn(0, 0, 0, 10, 0, 0, 1, 1, 2, 1, 1, 1);
    pool.update(0.5, 0, 0);
    expect(pool.position[0]).toBeCloseTo(5);
    expect(pool.progress(0)).toBeCloseTo(0.5);
    pool.update(0.6, 0, 0);
    expect(pool.alive()).toBe(0); // 1.1 s old, life was 1 s
  });

  it('slows with drag and falls with gravity', () => {
    const pool = new ParticlePool(2);
    pool.spawn(0, 0, 0, 10, 0, 0, 5, 1, 1, 1, 1, 1);
    pool.update(1, 1, 0);
    expect(pool.velocity[0]).toBeCloseTo(10 * Math.exp(-1), 4);
    const falling = new ParticlePool(2);
    falling.spawn(0, 0, 0, 0, 0, 0, 5, 1, 1, 1, 1, 1);
    falling.update(1, 0, -10);
    expect(falling.velocity[1]).toBeCloseTo(-10);
  });

  it('recycles the oldest particle when it is full, and never grows', () => {
    const pool = new ParticlePool(3);
    for (let i = 0; i < 5; i++) pool.spawn(i, 0, 0, 0, 0, 0, 10, 1, 1, 1, 1, 1);
    expect(pool.alive()).toBe(3);
    const xs = live(pool)
      .map((q) => q.p.x)
      .sort();
    expect(xs).toEqual([2, 3, 4]); // 0 and 1 were overwritten
    expect(pool.position.length).toBe(9);
  });

  it('frees expired slots so they can be reused', () => {
    const pool = new ParticlePool(2);
    pool.spawn(0, 0, 0, 0, 0, 0, 0.1, 1, 1, 1, 1, 1);
    pool.update(0.2, 0, 0);
    expect(pool.alive()).toBe(0);
    pool.spawn(1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1);
    expect(pool.alive()).toBe(1);
  });
});

describe('Effects: the hop burst', () => {
  it('vents gas from both underside nozzles, downward and outward from the car', () => {
    const fx = new Effects(new Scene());
    fx.hop(pose(10, 5, -3));
    const gas = live(fx.gas.pool);
    expect(gas.length).toBe(2 * HOP_PUFFS);
    const left = gas.filter((q) => q.p.x < 10);
    const right = gas.filter((q) => q.p.x > 10);
    expect(left.length).toBe(HOP_PUFFS);
    expect(right.length).toBe(HOP_PUFFS);
    for (const q of gas) {
      expect(q.p.y).toBeLessThan(5); // under the body
      expect(q.v.y).toBeLessThan(0); // thrown downward
      expect(q.v.length()).toBeGreaterThan(5);
    }
  });

  it('shoots out of the car underneath whichever way the car is turned, even upside down', () => {
    const fx = new Effects(new Scene());
    const upsideDown = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
    fx.hop(pose(0, 0, 0, new Vector3(), upsideDown));
    for (const q of live(fx.gas.pool)) {
      expect(q.p.y).toBeGreaterThan(0); // the underside is up now
      expect(q.v.y).toBeGreaterThan(0); // and the gas goes up, away from the car body
    }
  });

  it('gives the puffs some of the car own speed so they trail behind it', () => {
    const fx = new Effects(new Scene());
    fx.hop(pose(0, 0, 0, new Vector3(0, 0, -40)));
    const meanZ = live(fx.gas.pool).reduce((sum, q) => sum + q.v.z, 0) / (2 * HOP_PUFFS);
    expect(meanZ).toBeLessThan(-15); // moving forward (-z) with the car, not standing still in the air
  });
});

describe('Effects: the boost stream', () => {
  it('comes out of the two rear nozzles at about the set rate, backward', () => {
    const fx = new Effects(new Scene());
    for (let i = 0; i < 60; i++) fx.stream(1, pose(), { ...still, boosting: true }, FRAME);
    const gas = live(fx.gas.pool);
    expect(gas.length).toBeGreaterThan(2 * BOOST_PUFFS_PER_S - 6);
    expect(gas.length).toBeLessThan(2 * BOOST_PUFFS_PER_S + 6);
    for (const q of gas) {
      expect(q.p.z).toBeGreaterThan(1); // behind the car (it faces -z)
      expect(q.v.z).toBeGreaterThan(5); // streaming backward
    }
    expect(gas.some((q) => q.p.x < 0)).toBe(true);
    expect(gas.some((q) => q.p.x > 0)).toBe(true);
  });

  it('follows the car as it turns: a car facing left blows gas out to the right', () => {
    const fx = new Effects(new Scene());
    const faceLeft = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2); // forward -z becomes -x
    for (let i = 0; i < 30; i++)
      fx.stream(1, pose(0, 0, 0, new Vector3(), faceLeft), { ...still, boosting: true }, FRAME);
    for (const q of live(fx.gas.pool)) {
      expect(q.p.x).toBeGreaterThan(1);
      expect(q.v.x).toBeGreaterThan(5);
    }
  });

  it('makes nothing when the car is not boosting, and nothing when no time passes', () => {
    const fx = new Effects(new Scene());
    for (let i = 0; i < 30; i++) fx.stream(1, pose(), still, FRAME);
    expect(fx.gas.pool.alive()).toBe(0);
    for (let i = 0; i < 30; i++) fx.stream(1, pose(), { ...still, boosting: true }, 0);
    expect(fx.gas.pool.alive()).toBe(0);
  });

  it('gives each car its own stream, so two cars boosting make twice the gas', () => {
    const one = new Effects(new Scene());
    const two = new Effects(new Scene());
    for (let i = 0; i < 60; i++) {
      one.stream(1, pose(), { ...still, boosting: true }, FRAME);
      two.stream(1, pose(), { ...still, boosting: true }, FRAME);
      two.stream(2, pose(5, 0, 0), { ...still, boosting: true }, FRAME);
    }
    expect(two.gas.pool.alive()).toBeGreaterThan(one.gas.pool.alive() * 1.8);
  });
});

describe('Effects: gliding and attitude jets', () => {
  it('leaks gas from underneath while gliding', () => {
    const fx = new Effects(new Scene());
    for (let i = 0; i < 60; i++)
      fx.stream(1, pose(), { ...still, gliding: true, airborne: true }, FRAME);
    const gas = live(fx.gas.pool);
    expect(gas.length).toBeGreaterThan(2 * GLIDE_PUFFS_PER_S - 6);
    for (const q of gas) expect(q.v.y).toBeLessThan(0);
  });

  it('puffs from jets only while tilting in the air', () => {
    const tilting = { ...still, airborne: true, roll: 1 };
    const fx = new Effects(new Scene());
    for (let i = 0; i < 30; i++) fx.stream(1, pose(), tilting, FRAME);
    expect(fx.gas.pool.alive()).toBeGreaterThan(20);

    const onRoad = new Effects(new Scene());
    for (let i = 0; i < 30; i++) onRoad.stream(1, pose(), { ...tilting, airborne: false }, FRAME);
    expect(onRoad.gas.pool.alive()).toBe(0);

    const notTilting = new Effects(new Scene());
    for (let i = 0; i < 30; i++) notTilting.stream(1, pose(), { ...still, airborne: true }, FRAME);
    expect(notTilting.gas.pool.alive()).toBe(0);
  });

  it('fires the jet that pushes the car the way the player asked: gas leaves the opposite way', () => {
    // nose down: gas up at the nose
    const noseDown = jetsFor(1, 0, 0);
    expect(noseDown.length).toBe(2);
    for (const jet of noseDown) {
      expect(jet.at[2]).toBeLessThan(0); // at the nose (the car faces -z)
      expect(jet.dir[1]).toBeGreaterThan(0);
    }
    // nose up: gas down at the nose
    for (const jet of jetsFor(-1, 0, 0)) expect(jet.dir[1]).toBeLessThan(0);
    // roll right: gas up on the right side
    for (const jet of jetsFor(0, 1, 0)) {
      expect(jet.at[0]).toBeGreaterThan(0);
      expect(jet.dir[1]).toBeGreaterThan(0);
    }
    // roll left: gas up on the left side
    for (const jet of jetsFor(0, -1, 0)) expect(jet.at[0]).toBeLessThan(0);
    // turn right: gas out to the left at the nose, to the right at the tail
    const right = jetsFor(0, 0, 1);
    expect(right.find((j) => j.at[2] < 0)?.dir[0]).toBeLessThan(0);
    expect(right.find((j) => j.at[2] > 0)?.dir[0]).toBeGreaterThan(0);
    // nothing asked, nothing fires
    expect(jetsFor(0, 0, 0)).toEqual([]);
  });
});

describe('Effects: dash, brake jets and slam', () => {
  it('a dash to the right vents gas out of the left side, to the left vents it out of the right', () => {
    const fx = new Effects(new Scene());
    fx.dash(pose(), 1);
    for (const q of live(fx.gas.pool)) {
      expect(q.p.x).toBeLessThan(0);
      expect(q.v.x).toBeLessThan(0);
    }
    const left = new Effects(new Scene());
    left.dash(pose(), -1);
    for (const q of live(left.gas.pool)) expect(q.v.x).toBeGreaterThan(0);
  });

  it('the brake jets blow gas forward from the nose', () => {
    const fx = new Effects(new Scene());
    for (let i = 0; i < 30; i++) fx.stream(1, pose(), { ...still, retro: true }, FRAME);
    const gas = live(fx.gas.pool);
    expect(gas.length).toBeGreaterThan(30);
    for (const q of gas) {
      expect(q.p.z).toBeLessThan(-1);
      expect(q.v.z).toBeLessThan(0);
    }
  });

  it('the slam jets blow gas up from the roof, away from the surface being slammed toward', () => {
    const fx = new Effects(new Scene());
    for (let i = 0; i < 30; i++)
      fx.stream(1, pose(), { ...still, slam: true, airborne: true }, FRAME);
    const gas = live(fx.gas.pool);
    expect(gas.length).toBeGreaterThan(30);
    for (const q of gas) {
      expect(q.p.y).toBeGreaterThan(0);
      expect(q.v.y).toBeGreaterThan(0);
    }
  });
});

describe('Effects housekeeping', () => {
  it('lets puffs fade and disappear on their own', () => {
    const fx = new Effects(new Scene());
    fx.hop(pose());
    expect(fx.gas.pool.alive()).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) fx.update(FRAME, 600); // two seconds
    expect(fx.gas.pool.alive()).toBe(0);
  });

  it('clears everything for a new race', () => {
    const fx = new Effects(new Scene());
    fx.hop(pose());
    fx.clear();
    expect(fx.gas.pool.alive()).toBe(0);
  });

  it('keeps going when more is asked for than the pool holds', () => {
    const fx = new Effects(new Scene());
    for (let i = 0; i < 200; i++) fx.hop(pose());
    expect(fx.gas.pool.alive()).toBe(fx.gas.pool.capacity);
  });
});

describe('Effects: ring and hit bursts', () => {
  it('a ring throws lime gas, a hit throws red gas, in every direction', () => {
    const lime = new Effects(new Scene());
    lime.ring(pose());
    const limeGas = live(lime.gas.pool);
    expect(limeGas.length).toBeGreaterThan(20);
    expect(limeGas.some((q) => q.v.x > 0) && limeGas.some((q) => q.v.x < 0)).toBe(true);
    expect(limeGas.some((q) => q.v.y > 0) && limeGas.some((q) => q.v.y < 0)).toBe(true);
    const limeRed = lime.gas.pool.color[0] ?? 0;
    expect(limeRed).toBeLessThan(0.8);
    expect(lime.gas.pool.color[1] ?? 0).toBeGreaterThan(0.8);

    const red = new Effects(new Scene());
    red.hit(pose());
    expect(red.gas.pool.alive()).toBeGreaterThan(limeGas.length);
    expect(red.gas.pool.color[0] ?? 0).toBeGreaterThan(0.8);
    expect(red.gas.pool.color[1] ?? 1).toBeLessThan(0.4);
  });
});
