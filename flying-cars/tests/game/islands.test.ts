import { beforeAll, describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { Racer } from '../../src/ai/Racer';
import { Race } from '../../src/game/Race';
import { Sim, type SimEvent } from '../../src/physics/Sim';
import { createInput } from '../../src/physics/Input';
import { initPhysics } from '../../src/physics/world';
import { Track } from '../../src/track/Track';
import { RESPAWN_PENALTY } from '../../src/util/constants';
import { islandLabDef } from '../helpers/islandLab';
import { runRace } from '../helpers/raceHarness';

beforeAll(async () => {
  await initPhysics();
});

/** The lab: a flat gap, then a gap up to an upside-down island 8 m higher, then a gap back down. */
const lab = () => new Track(islandLabDef({ rise: 8, island: 150 }));

/** What a lone AI driver does on the lab over its first `seconds`, with the events of its car. */
function drive(skill: number, seconds: number) {
  const track = lab();
  const race = new Race(track, { ai: [] });
  const events: { clock: number; event: SimEvent; index: number }[] = [];
  const attached: { index: number; up: number }[] = [];
  runRace(race, new Racer(track, skill), {
    maxSeconds: seconds + 4,
    until: (r) => r.clock > seconds,
    onStep: (r) => {
      for (const event of r.player.sim.events) {
        events.push({ clock: r.clock, event, index: r.player.progress.index });
      }
      if (r.player.sim.attached)
        attached.push({ index: r.player.progress.index, up: r.player.sim.car.up.y });
    },
  });
  return { track, race, events, attached };
}

describe('crossing islands', () => {
  for (const skill of [0.9, 0.95]) {
    it(`an AI at skill ${skill} crosses all three gaps without falling or crashing`, () => {
      const { events, track } = drive(skill, 16);
      const bad = events.filter(
        (e) =>
          (e.event.type === 'respawn' && e.clock > 5) ||
          (e.event.type === 'landing' && e.event.kind === 'crash'),
      );
      expect(bad).toEqual([]);
      // it landed on each of the three islands beyond the gaps
      for (const [k, g] of track.gaps.entries()) {
        const landed = events.some(
          (e) => e.event.type === 'landing' && e.index >= g.last - 4 && e.index < g.last + 70,
        );
        expect(landed, `a landing past gap ${k + 1}`).toBe(true);
      }
    });
  }

  it('lands on the underside of the sky island nearly level, which is a perfect landing', () => {
    const { events, track } = drive(0.9, 12);
    const up = track.gaps[1];
    if (!up) throw new Error('no second gap');
    const landing = events.find(
      (e) => e.event.type === 'landing' && Math.abs(e.index - up.last) < 12,
    );
    expect(landing?.event.type === 'landing' && landing.event.kind).toBe('perfect');
    expect(landing?.event.type === 'landing' && landing.event.angleDeg).toBeLessThan(30);
  });

  it('stays stuck to the ceiling for the whole island, then drives off the end', () => {
    const { attached, track } = drive(0.9, 12);
    const up = track.gaps[1];
    if (!up) throw new Error('no second gap');
    const island = attached.filter((a) => a.index > up.last + 5 && a.index < up.last + 140);
    const down = track.gaps[2];
    expect(island.length).toBeGreaterThan(80);
    expect(island.every((a) => a.up < -0.99)).toBe(true); // upside down all the way
    expect(down).toBeDefined();
  });

  it('taps hop for the cushion on the long drop at the end, so that landing is perfect too', () => {
    const { events, track } = drive(0.9, 16);
    const down = track.gaps[2];
    if (!down) throw new Error('no third gap');
    expect(events.some((e) => e.event.type === 'cushion' && e.index > down.first)).toBe(true);
    const landing = events.find(
      (e) => e.event.type === 'landing' && e.index >= down.last - 4 && e.index < down.last + 70,
    );
    expect(landing?.event.type === 'landing' && landing.event.kind).toBe('perfect');
  });

  it('falls into the gap, and loses 3 s, when the car is too slow to reach the far side', () => {
    const track = lab();
    const sim = new Sim(track);
    const gap = track.gaps[0];
    if (!gap) throw new Error('no gap');
    const index = gap.first - 20;
    const pose = track.poseAt(index, 0);
    sim.placeCar(pose.position, pose.quaternion);
    const frame = track.frames[index];
    if (!frame) throw new Error('no frame');
    sim.car.setVelocity(frame.tangent.clone().multiplyScalar(12));
    const input = createInput();
    let fell = 0;
    for (let i = 0; i < 120 * 8; i++) {
      input.throttle = 0;
      sim.step(input);
      if (sim.events.some((e) => e.type === 'respawn' && e.reason === 'fell')) fell++;
    }
    expect(fell).toBe(1);
    expect(sim.penalty).toBe(RESPAWN_PENALTY);
  });
});

describe('the AI turning in the air', () => {
  /** A car dropped upside down (or tilted) above a flat road, with the AI in charge of its attitude. */
  function settle(rx: number, rz: number, seconds: number): { up: number; time: number } {
    const track = lab();
    const sim = new Sim(track);
    const index = track.count - 300; // the flat road home
    const pose = track.poseAt(index, 0);
    const turn = new Quaternion()
      .setFromAxisAngle(new Vector3(1, 0, 0), rx)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rz));
    sim.placeCar(
      pose.position.clone().add(new Vector3(0, 40, 0)),
      pose.quaternion.clone().multiply(turn),
    );
    const frame = track.frames[index];
    if (!frame) throw new Error('no frame');
    sim.car.setVelocity(frame.tangent.clone().multiplyScalar(40));
    const pilot = new Racer(track, 0.9);
    pilot.reset(sim);
    const input = createInput();
    for (let k = 0; k < Math.round(seconds * 120); k++) {
      Object.assign(input, createInput());
      pilot.drive(sim, input);
      sim.step(input);
      if (sim.car.up.y > 0.97) return { up: sim.car.up.y, time: k / 120 };
    }
    return { up: sim.car.up.y, time: seconds };
  }

  it('rolls a car that is upside down back to level inside 1.2 s', () => {
    const result = settle(0, Math.PI, 2);
    expect(result.up).toBeGreaterThan(0.97);
    expect(result.time).toBeLessThan(1.2);
  });

  it('puts right a nose-down tilt and a sideways tilt too, without spinning round', () => {
    expect(settle(0.9, 0, 2).time).toBeLessThan(0.7);
    expect(settle(-0.8, 0.8, 2).time).toBeLessThan(0.9);
  });
});

describe('flip assist for the player', () => {
  /** The player doing only what the guide asks for the hop: a plain Space tap 8 m before the edge, nothing else. */
  function playerJump(assistFirstGap: boolean) {
    const track = lab();
    const race = new Race(track, { ai: [] });
    const idle = createInput();
    for (let i = 0; i < 4 * 120; i++) race.step(idle);
    const gap = track.gaps[assistFirstGap ? 0 : 1];
    if (!gap) throw new Error('no gap');
    const sim = race.player.sim;
    const index = gap.first - 40;
    const pose = track.poseAt(index, 0);
    sim.placeCar(pose.position, pose.quaternion);
    const frame = track.frames[index];
    if (!frame) throw new Error('no frame');
    sim.car.setVelocity(frame.tangent.clone().multiplyScalar(50));
    race.player.relocate(track);
    const input = createInput();
    let hopped = false;
    let landing: SimEvent | null = null;
    let fell = false;
    for (let i = 0; i < 120 * 2.4; i++) {
      input.throttle = 1;
      const toEdge = (gap.first - race.player.progress.index) * track.spacing;
      input.hop = !hopped && toEdge <= 8;
      if (input.hop) hopped = true;
      race.step(input);
      for (const e of sim.events) {
        if (e.type === 'landing' && landing === null) landing = e;
        if (e.type === 'respawn') fell = true;
      }
    }
    return { sim, landing, fell };
  }

  it('a plain Space tap before a sky island is a high hop that flips itself, and sticks', () => {
    const { sim, landing, fell } = playerJump(false);
    expect(fell).toBe(false);
    expect(landing?.type === 'landing' && landing.kind).toBe('perfect');
    expect(sim.car.up.y).toBeLessThan(-0.99); // stuck to the underside
  });

  it('does nothing special before an ordinary flat gap', () => {
    const { sim, landing, fell } = playerJump(true);
    expect(fell).toBe(false);
    expect(landing?.type === 'landing' && landing.kind).toBe('perfect');
    expect(sim.car.up.y).toBeGreaterThan(0.99);
  });

  it('lets any key press take over: rolling the wrong way is not undone', () => {
    const track = lab();
    const sim = new Sim(track);
    const index = track.count - 300; // flat road home, no gap near: assist is off
    const pose = track.poseAt(index, 0);
    sim.placeCar(pose.position.clone().add(new Vector3(0, 30, 0)), pose.quaternion);
    sim.assistOn = true;
    sim.assistUp.set(0, -1, 0); // pretend the landing is upside down
    const input = createInput();
    input.roll = -1;
    for (let i = 0; i < 60; i++) sim.step(input);
    // held roll left the whole time: the car rolled left, assist stayed out of it
    const spin = sim.localSpin(new Vector3());
    expect(spin.z).toBeGreaterThan(0.5); // rolling left is positive about z
  });
});
