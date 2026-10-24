import { beforeAll, describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { landingGuide } from '../../src/game/landingGuide';
import { Sim } from '../../src/physics/Sim';
import { initPhysics } from '../../src/physics/world';
import { Track } from '../../src/track/Track';
import { islandLabDef } from '../helpers/islandLab';

beforeAll(async () => {
  await initPhysics();
});

const track = new Track(islandLabDef({ rise: 8, island: 150 }));

/** A car in the air over the flat road at sample `index`, turned by the given rotations about its x (pitch) and z (roll) axes. */
function airborne(index: number, rx: number, rz: number): Sim {
  const sim = new Sim(track);
  const pose = track.poseAt(index, 0);
  const turn = new Quaternion()
    .setFromAxisAngle(new Vector3(1, 0, 0), rx)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rz));
  sim.placeCar(
    pose.position.clone().add(new Vector3(0, 30, 0)),
    pose.quaternion.clone().multiply(turn),
  );
  sim.step({ ...emptyInput() });
  return sim;
}

function emptyInput() {
  return {
    steer: 0,
    throttle: 0,
    brake: 0,
    hop: false,
    boost: false,
    glide: false,
    pitch: 0,
    roll: 0,
    respawn: false,
    dash: 0,
    retro: false,
    slam: false,
    hopStyle: 0,
  };
}

describe('the landing guide', () => {
  const flat = track.count - 300; // the flat road home, no gap near

  it('shows nothing while the car is on a surface', () => {
    const sim = new Sim(track);
    sim.step(emptyInput());
    expect(landingGuide(sim, track, 5)).toBeNull();
  });

  it('reads zero degrees for a car that is level with the road below', () => {
    const guide = landingGuide(airborne(flat, 0, 0), track, flat);
    expect(guide?.degrees).toBeLessThan(2);
  });

  it('reads 180 degrees upside down and says to roll', () => {
    const guide = landingGuide(airborne(flat, 0, Math.PI), track, flat);
    expect(guide?.degrees).toBeGreaterThan(175);
    expect(['Q', 'E']).toContain(guide?.key);
  });

  it('names the key that turns the car back: roll right when tilted left, and the other way round', () => {
    // a rotation of +0.5 about the car's z axis tips its up to the left, so it needs to roll right (E)
    const left = { ...landingGuide(airborne(flat, 0, 0.5), track, flat) };
    expect(left?.degrees).toBeGreaterThan(25);
    expect(left?.degrees).toBeLessThan(32);
    const right = { ...landingGuide(airborne(flat, 0, -0.5), track, flat) };
    expect(new Set([left?.key, right?.key])).toEqual(new Set(['Q', 'E']));
    expect(left?.key).not.toBe(right?.key);
  });

  it('suggests a pitch key when the pitch is what is off', () => {
    const guide = { ...landingGuide(airborne(flat, 0.6, 0), track, flat) };
    expect(['W', 'S']).toContain(guide?.key);
    const other = { ...landingGuide(airborne(flat, -0.6, 0), track, flat) };
    expect(other?.key).not.toBe(guide?.key);
  });

  it('aims at the far side of an island gap: upside down is right when the next island is upside down', () => {
    const gap = track.gaps[1];
    if (!gap) throw new Error('no gap');
    const index = gap.first - 6; // about to hop the gap up to the underside
    const upright = landingGuide(airborne(index, 0, 0), track, index);
    expect(upright?.degrees).toBeGreaterThan(175);
    const flipped = landingGuide(airborne(index, 0, Math.PI), track, index);
    expect(flipped?.degrees).toBeLessThan(5);
  });

  it('the key it names really does turn the car toward the landing', () => {
    for (const [rx, rz] of [
      [0, 0.7],
      [0, -0.7],
      [0.6, 0],
      [-0.6, 0],
      [0, Math.PI - 0.3],
    ] as const) {
      const sim = airborne(flat, rx, rz);
      const before = { ...landingGuide(sim, track, flat) };
      const input = emptyInput();
      if (before.key === 'E') input.roll = 1;
      if (before.key === 'Q') input.roll = -1;
      if (before.key === 'W') input.pitch = 1;
      if (before.key === 'S') input.pitch = -1;
      for (let i = 0; i < 24; i++) sim.step(input);
      const after = landingGuide(sim, track, flat);
      expect(after?.degrees, `tilt ${rx}, ${rz}, key ${before.key}`).toBeLessThan(
        (before.degrees ?? 0) - 5,
      );
    }
  });
});
