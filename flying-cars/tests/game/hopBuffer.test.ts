import { beforeAll, describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { Race } from '../../src/game/Race';
import { createInput } from '../../src/physics/Input';
import { initPhysics } from '../../src/physics/world';
import type { Track } from '../../src/track/Track';
import { createTrack } from '../../src/track/tracks';
import { HOP_BUFFER_AT, HOP_BUFFER_WINDOW } from '../../src/util/constants';

beforeAll(async () => {
  await initPhysics();
});

const track = createTrack('warm-up') as Track;

/** A race with the player sitting on the road `metres` before the first gap, ready to drive. */
function setup(metres: number, gapNumber = 0) {
  const race = new Race(track, {});
  const input = createInput();
  while (race.state === 'countdown') race.step(input);
  const gap = track.gaps[gapNumber]!;
  const index = gap.first - Math.round(metres / track.spacing);
  const frame = track.frames[index]!;
  const basis = new Matrix4().makeBasis(frame.binormal, frame.up, frame.tangent.clone().negate());
  const quat = new Quaternion().setFromRotationMatrix(basis);
  const position = frame.position.clone().addScaledVector(frame.up, 0.6);
  race.player.sim.placeCar(position, quat);
  race.player.startAt(track);
  race.step(input); // settle
  return { race, input, gap };
}

/** How far the player is from the gap edge, along the road, metres. */
function distanceTo(race: Race, gapFirst: number): number {
  const frame = track.frames[gapFirst]!;
  return new Vector3().copy(frame.position).sub(race.player.sim.car.position).dot(frame.tangent);
}

describe('holding an early jump', () => {
  it('a tap well before the gap is held, then the hop happens near the edge', () => {
    const { race, input, gap } = setup(HOP_BUFFER_WINDOW - 8);
    const player = race.player;
    input.throttle = 1;
    input.boost = true;
    let hopped = -1;
    for (let i = 0; i < 1500 && hopped < 0; i++) {
      input.hop = i === 2; // one tap, right at the start
      race.step(input);
      if (player.sim.events.some((e) => e.type === 'hop')) hopped = i;
    }
    expect(hopped, 'the hop happened').toBeGreaterThan(5); // not at the tap
    const distance = distanceTo(race, gap.first);
    // by the time it hopped, it was close to the edge (it has moved a little since)
    expect(distance).toBeLessThan(HOP_BUFFER_AT + 3);
    expect(distance).toBeGreaterThan(-6);
  });

  it('only one hop comes out of one tap', () => {
    const { race, input } = setup(HOP_BUFFER_WINDOW - 8);
    input.throttle = 1;
    input.boost = true;
    let hops = 0;
    for (let i = 0; i < 400; i++) {
      input.hop = i === 2;
      race.step(input);
      hops += race.player.sim.events.filter((e) => e.type === 'hop').length;
    }
    expect(hops).toBeLessThanOrEqual(1);
  });

  it('a tap far from any gap hops straight away', () => {
    const { race, input } = setup(HOP_BUFFER_WINDOW + 150);
    input.throttle = 1;
    let hopped = -1;
    for (let i = 0; i < 40 && hopped < 0; i++) {
      input.hop = i === 2;
      race.step(input);
      if (race.player.sim.events.some((e) => e.type === 'hop')) hopped = i;
    }
    expect(hopped).toBe(2);
  });

  it('a held tap is dropped if the car leaves the road', () => {
    const { race, input } = setup(HOP_BUFFER_WINDOW - 8);
    input.throttle = 1;
    input.hop = true;
    race.step(input);
    expect(race.player.hopQueued).toBe(true);
    race.player.sim.attached = false;
    input.hop = false;
    race.step(input);
    expect(race.player.hopQueued).toBe(false);
  });
});
