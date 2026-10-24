import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/physics/world';
import { Sim, type SimEvent } from '../../src/physics/Sim';
import { createInput, type Input } from '../../src/physics/Input';
import { Track } from '../../src/track/Track';
import { testTrackDef } from '../../src/track/tracks/testTrack';
import { Autopilot } from '../helpers/autopilot';
import { PHYSICS_DT, RIDE_HEIGHT, SURFACE_RANGE } from '../../src/util/constants';

beforeAll(async () => {
  await initPhysics();
});

const track = new Track(testTrackDef());

/** The first stretch of road after `afterS` where the centre line is off the ground: a vertical loop. */
function findLoop(afterS: number): { start: number; end: number } {
  let start = -1;
  for (const f of track.frames) {
    if (f.s < afterS) continue;
    if (start < 0 && f.position.y > 0.5) start = f.s;
    if (start >= 0 && f.position.y <= 0.5) return { start, end: f.s };
  }
  throw new Error('no loop found');
}

interface Sample {
  progress: number;
  speed: number;
  attached: boolean;
  distance: number;
}

/** Drives the autopilot for `seconds` and records a sample every step. */
function drive(sim: Sim, pilot: Autopilot, seconds: number, log?: SimEvent[]): Sample[] {
  const input: Input = createInput();
  const samples: Sample[] = [];
  const steps = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < steps; i++) {
    input.steer = input.throttle = input.brake = input.pitch = input.roll = 0;
    input.hop = input.boost = input.respawn = false;
    pilot.drive(input);
    sim.step(input);
    log?.push(...sim.events);
    samples.push({
      progress: pilot.progress,
      speed: sim.speed,
      attached: sim.attached,
      distance: sim.sensor.distance,
    });
  }
  return samples;
}

describe('the start of the track', () => {
  it('sits still on the road, attached, at ride height', () => {
    const sim = new Sim(track);
    const input = createInput();
    for (let i = 0; i < 360; i++) sim.step(input);
    expect(sim.attached).toBe(true);
    expect(sim.speed).toBeLessThan(0.05);
    expect(sim.sensor.distance).toBeGreaterThan(RIDE_HEIGHT - 0.08);
    expect(sim.sensor.distance).toBeLessThan(RIDE_HEIGHT + 0.02);
  });

  it('reads the road normal from the ray cast, pointing from the road to the car', () => {
    const sim = new Sim(track);
    sim.step(createInput());
    const up = track.frames[0]?.up;
    if (!up) throw new Error('no frame');
    expect(sim.sensor.normal.dot(up)).toBeGreaterThan(0.999);
  });

  it('drives without jitter on the flat: steady height and no bouncing', () => {
    const sim = new Sim(track);
    const pilot = new Autopilot(track, sim, 40);
    const samples = drive(sim, pilot, 4);
    // the flat part of the first straight, once the car is up to speed and before the wall begins at 50 m
    const flat = samples.filter((s) => s.progress > 15 && s.progress < 48 && s.speed > 20);
    expect(flat.length).toBeGreaterThan(60);
    const distances = flat.map((s) => s.distance);
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(0.03);
  });
});

describe('walls', () => {
  it('drives along the 90 degree wall at 20 m/s or more and stays attached', () => {
    const sim = new Sim(track);
    const pilot = new Autopilot(track, sim, 28);
    const samples = drive(sim, pilot, 12);
    const onWall = samples.filter((s) => s.progress >= 110 && s.progress <= 160);
    expect(onWall.length).toBeGreaterThan(100);
    expect(onWall.every((s) => s.attached)).toBe(true);
    expect(Math.min(...onWall.map((s) => s.speed))).toBeGreaterThanOrEqual(20);
  });
});

describe('loops', () => {
  it('completes the first loop at 25 m/s without detaching', () => {
    const loop = findLoop(400);
    const sim = new Sim(track);
    const log: SimEvent[] = [];
    const pilot = new Autopilot(track, sim, 25);
    const samples = drive(sim, pilot, 30, log);
    const inLoop = samples.filter((s) => s.progress >= loop.start && s.progress <= loop.end);
    expect(inLoop.length).toBeGreaterThan(300);
    expect(inLoop.every((s) => s.attached)).toBe(true);
    expect(Math.min(...inLoop.map((s) => s.speed))).toBeGreaterThanOrEqual(22);
    expect(samples[samples.length - 1]?.progress).toBeGreaterThan(loop.end);
    expect(log.some((e) => e.type === 'respawn')).toBe(false);
  });
});

describe('ceilings', () => {
  const ceiling = track.frames.filter((f) => f.up.y < -0.999);
  const middle = ceiling[Math.floor(ceiling.length / 2)];

  it('has a ceiling to test on', () => {
    expect(ceiling.length).toBeGreaterThan(40);
  });

  it('holds a stationary car upside down on the ceiling for 10 s', () => {
    if (!middle) throw new Error('no ceiling');
    const index = track.frames.indexOf(middle);
    const sim = new Sim(track);
    const pose = track.poseAt(index);
    sim.placeCar(pose.position, pose.quaternion);
    const start = sim.car.position.clone();
    const input = createInput();
    let detached = 0;
    for (let i = 0; i < 10 / PHYSICS_DT; i++) {
      sim.step(input);
      if (!sim.attached) detached++;
    }
    expect(detached).toBe(0);
    expect(sim.sensor.distance).toBeLessThan(SURFACE_RANGE);
    expect(sim.car.position.distanceTo(start)).toBeLessThan(0.5);
    expect(sim.car.up.y).toBeLessThan(-0.99); // still upside down
  });

  it('also holds a car that is off to one side of the road', () => {
    if (!middle) throw new Error('no ceiling');
    const index = track.frames.indexOf(middle);
    const sim = new Sim(track);
    const pose = track.poseAt(index, 4);
    sim.placeCar(pose.position, pose.quaternion);
    const input = createInput();
    let detached = 0;
    for (let i = 0; i < 5 / PHYSICS_DT; i++) {
      sim.step(input);
      if (!sim.attached) detached++;
    }
    expect(detached).toBe(0);
  });
});

describe('a full lap', () => {
  it('drives all the way round at 25 m/s without falling off or respawning', () => {
    const sim = new Sim(track);
    const log: SimEvent[] = [];
    const pilot = new Autopilot(track, sim, 25);
    const lapSeconds = Math.ceil(track.length / 22);
    const samples = drive(sim, pilot, lapSeconds, log);
    const last = samples[samples.length - 1];
    expect(last).toBeDefined();
    // The car has gone round and crossed the finish line, so progress wrapped past the start.
    const maxProgress = Math.max(...samples.map((s) => s.progress));
    expect(maxProgress).toBeGreaterThan(track.length - 20);
    expect(log.some((e) => e.type === 'respawn')).toBe(false);
    const detached = samples.filter((s) => !s.attached).length;
    expect(detached * PHYSICS_DT).toBeLessThan(0.5);
  });
});
