import { beforeAll, describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { Race } from '../../src/game/Race';
import { createInput } from '../../src/physics/Input';
import { initPhysics } from '../../src/physics/world';
import { Track } from '../../src/track/Track';
import {
  barrierHit,
  makeRing,
  ringPass,
  slotBarriers,
  type Barrier,
} from '../../src/track/hazards';
import { TRACK_LIST, createTrack } from '../../src/track/tracks';
import {
  BARRIER_HOP_LEAD,
  BARRIER_PENALTY,
  BARRIER_SPEED_MULT,
  RING_AIR,
  RING_BOOST,
  RING_RADIUS,
} from '../../src/util/constants';

beforeAll(async () => {
  await initPhysics();
});

/** A dead straight road along -z, 16 m wide. */
function straight(extra: Partial<ConstructorParameters<typeof Track>[0]> = {}): Track {
  const points = [
    new Vector3(0, 0, 0),
    new Vector3(0, 0, -150),
    new Vector3(0, 0, -300),
    new Vector3(-100, 0, -330),
    new Vector3(-200, 0, -300),
    new Vector3(-200, 0, -150),
    new Vector3(-200, 0, 0),
    new Vector3(-100, 0, 30),
  ];
  return new Track({ name: 'T', points, banking: [], start: 0, ...extra });
}

describe('rings', () => {
  const track = straight({ rings: [{ at: 100, w: 2, h: 4 }] });
  const ring = track.rings[0];
  if (!ring) throw new Error('no ring');

  it('sit above the road where they were put', () => {
    const frame = track.frames[ring.index];
    if (!frame) throw new Error('no frame');
    const offset = ring.position.clone().sub(frame.position);
    expect(offset.dot(frame.binormal)).toBeCloseTo(2, 5);
    expect(offset.dot(frame.up)).toBeCloseTo(4, 5);
    expect(ring.normal.dot(frame.tangent)).toBeCloseTo(1, 5);
  });

  it('are passed by flying through the middle along the road', () => {
    const t = ring.normal;
    const before = ring.position.clone().addScaledVector(t, -1);
    const after = ring.position.clone().addScaledVector(t, 1);
    expect(ringPass(ring, before, after)).toBeCloseTo(0.5, 5);
    // off the centre but inside the radius
    const side = new Vector3(RING_RADIUS * 0.8, 0, 0);
    expect(ringPass(ring, before.clone().add(side), after.clone().add(side))).not.toBeNull();
  });

  it('are missed by going wide, by going the wrong way, and by stopping short', () => {
    const t = ring.normal;
    const wide = new Vector3(RING_RADIUS * 1.2, 0, 0);
    const before = ring.position.clone().addScaledVector(t, -1);
    const after = ring.position.clone().addScaledVector(t, 1);
    expect(ringPass(ring, before.clone().add(wide), after.clone().add(wide))).toBeNull();
    expect(ringPass(ring, after, before)).toBeNull();
    expect(ringPass(ring, before.clone().addScaledVector(t, -5), before)).toBeNull();
  });

  it('can be built straight from a frame', () => {
    const frame = track.frames[10];
    if (!frame) throw new Error('no frame');
    const r = makeRing(frame, 10, { at: 10, w: 0, h: 5 });
    expect(r.position.distanceTo(frame.position.clone().addScaledVector(frame.up, 5))).toBeCloseTo(
      0,
      5,
    );
  });
});

describe('barriers', () => {
  const track = straight();
  const frame = track.frames[100];
  if (!frame) throw new Error('no frame');
  const hurdle = { index: 100, left: -9, right: 9, height: 1.1, slot: null };

  /** A move across the barrier's plane at a lateral position and a height above the road. */
  const crossAt = (barrier: Barrier, across: number, height: number): boolean => {
    const at = frame.position
      .clone()
      .addScaledVector(frame.binormal, across)
      .addScaledVector(frame.up, height);
    const before = at.clone().addScaledVector(frame.tangent, -0.3);
    const after = at.clone().addScaledVector(frame.tangent, 0.3);
    return barrierHit(barrier, frame, before, after);
  };

  it('a hurdle stops a car on the road and lets a hopping car over', () => {
    expect(crossAt(hurdle, 0, 0.44)).toBe(true);
    expect(crossAt(hurdle, 6, 0.44)).toBe(true);
    expect(crossAt(hurdle, 0, 1.2)).toBe(true); // body still dips into it
    expect(crossAt(hurdle, 0, 1.6)).toBe(false);
  });

  it('only counts crossing it going forward', () => {
    const before = frame.position.clone().addScaledVector(frame.up, 0.44);
    const a = before.clone().addScaledVector(frame.tangent, 0.3);
    const b = before.clone().addScaledVector(frame.tangent, -0.3);
    expect(barrierHit(hurdle, frame, a, b)).toBe(false);
  });

  it('a slot wall has an opening a car fits through, and walls either side of it', () => {
    const walls = slotBarriers({ at: 100, centre: 3, width: 7 }, 100, 16);
    expect(walls.length).toBe(2);
    const hits = (across: number): boolean => walls.some((w) => crossAt(w, across, 0.44));
    expect(hits(3)).toBe(false); // the middle of the opening
    expect(hits(3 + 2.4)).toBe(false); // the car edge is still inside
    expect(hits(3 + 3)).toBe(true); // clipping the wall
    expect(hits(-4)).toBe(true);
    expect(hits(-7.9)).toBe(true); // even tight against the road edge
    expect(crossAt(walls[0] as Barrier, -4, 6)).toBe(true); // too tall to hop
  });

  it('a slot at the road edge only has one wall', () => {
    expect(slotBarriers({ at: 0, centre: -6, width: 4 }, 0, 16).length).toBe(1);
  });
});

describe('a track with hazards', () => {
  const track = straight({
    rings: [
      { at: 150, w: 0, h: 3 },
      { at: 60, w: 0, h: 3 },
    ],
    barriers: [{ at: 120, left: -9, right: 9, height: 1.1 }],
    slots: [{ at: 200, centre: 3, width: 7 }],
  });

  it('keeps rings and barriers in driving order', () => {
    expect(track.rings.map((r) => r.index)).toEqual([60, 150]);
    expect(track.barriers.map((b) => b.index)).toEqual([120, 200, 200]);
  });

  it('asks the AI to hop a hurdle but not a slot wall', () => {
    const markers = track.hopMarkers.map((m) => Math.round(m));
    expect(markers).toEqual([120 - BARRIER_HOP_LEAD]);
  });

  it('knows where the next opening is', () => {
    const next = track.slotAhead(150, 60);
    expect(next?.centre).toBe(3);
    expect(next?.distance).toBeCloseTo(50 * track.spacing, 3);
    expect(track.slotAhead(50, 60)).toBeNull(); // too far
    expect(track.slotAhead(220, 60)).toBeNull(); // already past
  });
});

describe('hazards in a race', () => {
  const track = straight({
    rings: [{ at: 150, w: 0, h: 3 }],
    barriers: [{ at: 120, left: -9, right: 9, height: 1.1 }],
  });

  /** A race with the player on the road at sample `index`, doing `speed` along it, the countdown over. */
  function raceAt(index: number, speed: number, heightAbove = 0): Race {
    const race = new Race(track);
    const idle = createInput();
    for (let i = 0; i < 4 * 120; i++) race.step(idle);
    const sim = race.player.sim;
    const pose = track.poseAt(index, 0);
    const frame = track.frames[index];
    if (!frame) throw new Error('no frame');
    sim.placeCar(
      pose.position.addScaledVector(frame.up, heightAbove),
      pose.quaternion as Quaternion,
    );
    sim.car.setVelocity(frame.tangent.clone().multiplyScalar(speed));
    race.player.relocate(track);
    return race;
  }

  const runFor = (race: Race, seconds: number, hopAt: number | null = null) => {
    const input = createInput();
    const events: string[] = [];
    for (let i = 0; i < seconds * 120; i++) {
      input.throttle = 0;
      input.hop = hopAt !== null && i === Math.round(hopAt * 120);
      race.step(input);
      for (const e of race.events) if (!('racer' in e) || e.racer === 0) events.push(e.type);
    }
    return events;
  };

  it('running into a hurdle costs its penalty and most of the speed', () => {
    const race = raceAt(85, 40);
    const before = race.player.sim.penalty;
    const events = runFor(race, 1.5);
    expect(events).toContain('hit');
    expect(events.filter((e) => e === 'hit').length).toBe(1);
    expect(race.player.sim.penalty - before).toBe(BARRIER_PENALTY);
    expect(race.player.sim.speed).toBeLessThan(40 * BARRIER_SPEED_MULT + 1);
  });

  it('hopping it clears it with no penalty', () => {
    const race = raceAt(85, 40);
    const before = race.player.sim.penalty;
    // 35 m to go at 40 m/s: hop with 0.2 s to spare
    const events = runFor(race, 1.5, 0.65);
    expect(events).not.toContain('hit');
    expect(race.player.sim.penalty).toBe(before);
  });

  it('flying through a ring refills air and adds speed, once, until the next lap', () => {
    const race = raceAt(140, 40, 2.6);
    race.player.sim.air.value = 10;
    const events = runFor(race, 0.5);
    expect(events.filter((e) => e === 'ring').length).toBe(1);
    expect(race.player.sim.air.value).toBeGreaterThan(10 + RING_AIR - 8);
    expect(race.player.sim.speed).toBeGreaterThan(40 + RING_BOOST - 5);
    expect(race.player.ringsTaken.size).toBe(1);

    // going back and through it again in the same lap gives nothing
    const again = raceAt(140, 40, 2.6);
    again.player.ringsTaken.add(0);
    again.player.sim.air.value = 10;
    expect(runFor(again, 0.5)).not.toContain('ring');
  });

  it('driving along the road under a ring does not collect it', () => {
    const race = raceAt(140, 40, 0);
    expect(runFor(race, 0.5)).not.toContain('ring');
  });
});

describe('every track', () => {
  for (const info of TRACK_LIST) {
    const track = createTrack(info.id) as Track;

    it(`${info.name} has its hazards on flat, straight road and well clear of gaps`, () => {
      expect(track.rings.length).toBeGreaterThanOrEqual(4);
      expect(track.barriers.some((b) => b.height < 2)).toBe(true);
      expect(track.barriers.some((b) => b.slot !== null)).toBe(true);
      for (const b of track.barriers) {
        expect(track.normalRate[b.index], `barrier at ${b.index} normal rate`).toBeLessThan(0.006);
        expect(track.curvature[b.index], `barrier at ${b.index} curvature`).toBeLessThan(0.006);
        for (let k = -20; k <= 20; k++) {
          expect(track.gapAt(b.index + k), `barrier at ${b.index} near a gap`).toBeNull();
        }
      }
    });

    it(`${info.name} leaves room after a hop to line up with a slot wall`, () => {
      const hops = track.hopMarkers.map((m) =>
        Math.round((m + track.startIndex * track.spacing) / track.spacing),
      );
      const slots = track.barriers.filter((b) => b.slot !== null).map((b) => b.index);
      for (const slot of slots) {
        for (const hop of hops) {
          const distance = (slot - hop + track.count) % track.count;
          // a hop flies about 100 m, so a slot closer than 110 m after one would be met in the air
          expect(
            distance > 110 || distance === 0 || distance > track.count - 5,
            `slot at ${slot} comes ${distance} m after a hop at ${hop}`,
          ).toBe(true);
        }
      }
    });
  }
});
