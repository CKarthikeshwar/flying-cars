import { beforeAll, describe, expect, it } from 'vitest';
import { Racer } from '../../src/ai/Racer';
import { Race } from '../../src/game/Race';
import { Sim } from '../../src/physics/Sim';
import { createInput } from '../../src/physics/Input';
import { initPhysics } from '../../src/physics/world';
import type { Track } from '../../src/track/Track';
import { TRACK_LIST, createTrack } from '../../src/track/tracks';
import { PHYSICS_DT, STRIP_RATE } from '../../src/util/constants';
import { runRace, seeded } from '../helpers/raceHarness';

beforeAll(async () => {
  await initPhysics();
});

const tracks = TRACK_LIST.map((info) => ({ info, track: createTrack(info.id) as Track }));

/** Lap times are measured with a decent driver in mind: between 40 and 90 seconds. */
const LAP_MIN = 40;
const LAP_MAX = 90;

describe.each(tracks)('racing on $info.name', ({ track }) => {
  it('has every AI finish 3 laps in each of 2 noisy trials, with no penalties and sensible lap times', () => {
    for (let trial = 0; trial < 2; trial++) {
      const random = seeded(500 + trial);
      const race = new Race(track, { aiNoise: 0.12, random });
      const pilot = new Racer(track, 0.95);
      pilot.steerNoise = 0.12;
      pilot.random = random;
      runRace(race, pilot, { maxSeconds: 400, until: (r) => r.racers.every((x) => x.finished) });
      for (const r of race.racers) {
        expect(r.finished, `trial ${trial}: ${r.name} finished`).toBe(true);
        expect(r.lapTimes.length).toBe(3);
        expect(r.penaltyAtFinish, `trial ${trial}: ${r.name} penalties`).toBeLessThanOrEqual(3);
        for (const lap of r.lapTimes) {
          expect(lap).toBeGreaterThan(LAP_MIN);
          expect(lap).toBeLessThan(LAP_MAX);
        }
      }
      // the skill factors still order the field
      const [, dune, marrow, kestrel] = race.racers;
      expect(kestrel?.finishTime).toBeLessThan(marrow?.finishTime ?? 0);
      expect(marrow?.finishTime).toBeLessThan(dune?.finishTime ?? 0);
    }
  }, 180000);

  it('needs hops: a driver who never hops keeps falling into the first gap', () => {
    const race = new Race(track, { useHops: false });
    runRace(race, new Racer(track, 0.95, false), { maxSeconds: 40, until: (r) => r.clock > 38 });
    expect(race.player.sim.penalty).toBeGreaterThanOrEqual(6); // at least two falls
    expect(race.player.lap).toBeLessThanOrEqual(1);
  }, 120000);
});

describe('gaps in the road', () => {
  const track = tracks[2]?.track as Track; // Gap Run
  const gap = track.gaps[0];
  if (!gap) throw new Error('no gap');
  const gapFirst = gap.first;

  /** A car on the road `before` metres ahead of the gap, up to `speed` along it. */
  function approach(before: number, speed: number): Sim {
    const sim = new Sim(track);
    const index = (gapFirst - Math.round(before / track.spacing) + track.count) % track.count;
    const pose = track.poseAt(index, 0);
    sim.placeCar(pose.position, pose.quaternion);
    const f = track.frames[index];
    if (!f) throw new Error('missing frame');
    sim.car.setVelocity(f.tangent.clone().multiplyScalar(speed));
    return sim;
  }

  it('drops a car that drives straight into the hole, and respawns it for 3 s', () => {
    const sim = approach(30, 30);
    const input = createInput();
    let fell = false;
    for (let i = 0; i < 120 * 8 && !fell; i++) {
      input.throttle = 0;
      sim.step(input);
      if (sim.events.some((e) => e.type === 'respawn' && e.reason === 'fell')) fell = true;
    }
    expect(fell).toBe(true);
    expect(sim.penalty).toBe(3);
  });

  it('carries a car across with a hop made 8 m before the gap, and lands it safely', () => {
    const sim = approach(30, 35);
    const input = createInput();
    const hopAt = Math.round((30 - 8) / 35 / PHYSICS_DT); // steps until the car is 8 m before the gap
    let landed: string | null = null;
    let fell = false;
    for (let i = 0; i < 120 * 6; i++) {
      input.hop = i === hopAt;
      sim.step(input);
      for (const e of sim.events) {
        if (e.type === 'landing') landed = e.kind;
        if (e.type === 'respawn') fell = true;
      }
    }
    expect(fell).toBe(false);
    expect(landed).toBe('perfect');
  });

  it('has nothing under a car in the middle of an island gap', () => {
    const sim = new Sim(track);
    const mid = Math.round((gap.first + gap.last) / 2);
    const hole = track.poseAt(mid, 0);
    sim.placeCar(hole.position, hole.quaternion);
    sim.step(createInput());
    expect(sim.sensor.found).toBe(false);
  });
});

describe('charge strips', () => {
  const track = tracks[0]?.track as Track;
  const strip = track.charges[0];
  if (!strip) throw new Error('no strip');

  it('refill the tank quickly while the car is on them, and not off them', () => {
    const race = new Race(track);
    const input = createInput();
    for (let i = 0; i < 4 * 120; i++) race.step(input); // through the countdown
    expect(race.state).toBe('racing');

    const sim = race.player.sim;
    const mid = Math.round((strip.first + strip.last) / 2);
    const pose = track.poseAt(mid, 0);
    sim.placeCar(pose.position, pose.quaternion);
    race.player.relocate(track);
    sim.air.burn(80);
    const before = sim.air.value;
    for (let i = 0; i < 120; i++) race.step(input); // one second, parked on the strip
    expect(sim.onChargeStrip).toBe(true);
    expect(sim.air.value - before).toBeGreaterThan(STRIP_RATE * 0.8);

    // the same second parked off the strip refills at the slow rate
    const off = track.poseAt(strip.last + 40, 0);
    sim.placeCar(off.position, off.quaternion);
    race.player.relocate(track);
    sim.air.burn(40);
    const beforeOff = sim.air.value;
    for (let i = 0; i < 120; i++) race.step(input);
    expect(sim.onChargeStrip).toBe(false);
    expect(sim.air.value - beforeOff).toBeLessThan(6);
  });
});
