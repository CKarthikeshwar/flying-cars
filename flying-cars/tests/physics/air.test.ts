import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { AirTank, boostThrustFactor, hopApexHeight, stepSpin } from '../../src/physics/thrusters';
import { AIR_MAX, AIR_SPIN_CAP, GRAVITY, HOP_DV } from '../../src/util/constants';

describe('AirTank', () => {
  it('never leaves 0 to 100, whatever is added, burned or spent', () => {
    const tank = new AirTank();
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 20000; i++) {
      const amount = (rand() - 0.5) * 300;
      const pick = Math.floor(rand() * 3);
      if (pick === 0) tank.add(amount);
      else if (pick === 1) tank.burn(amount);
      else tank.spend(Math.abs(amount));
      expect(tank.value).toBeGreaterThanOrEqual(0);
      expect(tank.value).toBeLessThanOrEqual(AIR_MAX);
    }
  });

  it('clamps an overfill at the top and an overburn at the bottom', () => {
    const tank = new AirTank();
    tank.add(1000);
    expect(tank.value).toBe(AIR_MAX);
    tank.burn(1000);
    expect(tank.value).toBe(0);
  });

  it('refuses a cost it cannot pay and spends nothing', () => {
    const tank = new AirTank();
    tank.burn(AIR_MAX - 10);
    expect(tank.spend(15)).toBe(false);
    expect(tank.value).toBeCloseTo(10);
    expect(tank.spend(10)).toBe(true);
    expect(tank.value).toBe(0);
  });

  it('gives six hops from a full tank', () => {
    const tank = new AirTank();
    let hops = 0;
    while (tank.spend(15)) hops++;
    expect(hops).toBe(6);
  });
});

describe('thruster maths', () => {
  it('boost thrust shrinks from 100% to 40% as the tank empties', () => {
    expect(boostThrustFactor(100)).toBeCloseTo(1);
    expect(boostThrustFactor(0)).toBeCloseTo(0.4);
    expect(boostThrustFactor(50)).toBeCloseTo(0.7);
  });

  it('a hop of 9 m/s peaks at about 4.1 m', () => {
    expect(hopApexHeight(HOP_DV, GRAVITY)).toBeCloseTo(4.13, 1);
  });

  it('air control spins the car up, then caps the spin speed', () => {
    const omega = new Vector3();
    for (let i = 0; i < 1000; i++) stepSpin(omega, 1, 1, 1, 1 / 120);
    expect(omega.length()).toBeLessThanOrEqual(AIR_SPIN_CAP + 1e-9);
    expect(omega.length()).toBeGreaterThan(AIR_SPIN_CAP * 0.99);
  });

  it('pitching nose down and nose up spin the car opposite ways', () => {
    const down = new Vector3();
    stepSpin(down, 1, 0, 0, 0.1);
    const up = new Vector3();
    stepSpin(up, -1, 0, 0, 0.1);
    expect(down.x).toBeLessThan(0);
    expect(up.x).toBeGreaterThan(0);
  });

  it('damps a free spin lightly', () => {
    const omega = new Vector3(5, 0, 0);
    for (let i = 0; i < 120; i++) stepSpin(omega, 0, 0, 0, 1 / 120);
    expect(omega.x).toBeCloseTo(5 * Math.exp(-0.5), 5);
  });
});
