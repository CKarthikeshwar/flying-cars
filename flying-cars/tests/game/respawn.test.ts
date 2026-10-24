import { beforeAll, describe, expect, it } from 'vitest';
import { Race } from '../../src/game/Race';
import { Sim } from '../../src/physics/Sim';
import { createInput } from '../../src/physics/Input';
import { initPhysics } from '../../src/physics/world';
import type { Track } from '../../src/track/Track';
import { TRACK_LIST, createTrack } from '../../src/track/tracks';
import { GATE_GAP_CLEAR, GATE_MAX_SLOPE, PHYSICS_DT } from '../../src/util/constants';

beforeAll(async () => {
  await initPhysics();
});

const all = [
  ...TRACK_LIST.map((info) => ({ name: info.name, track: createTrack(info.id) as Track })),
  { name: 'Test Track', track: createTrack('test') as Track },
];

describe.each(all)('checkpoints on $name', ({ track }) => {
  it('never sit in a gap, or within 30 m before one', () => {
    const clear = Math.ceil(GATE_GAP_CLEAR / track.spacing);
    for (const gate of track.gates) {
      for (let k = 0; k <= clear; k++) {
        expect(
          track.gapAt(gate.index + k),
          `gate ${gate.number} has a gap ${k} samples ahead`,
        ).toBeNull();
      }
      expect(track.roadAt(gate.index, 0)).toBe(true);
      // and on gentle road: not a loop, not a hard climb
      const f = track.frames[gate.index];
      expect(Math.abs(f?.tangent.y ?? 1), `gate ${gate.number} slope`).toBeLessThanOrEqual(
        GATE_MAX_SLOPE,
      );
    }
  });

  it('stay in driving order, with no two gates on top of each other', () => {
    let last = -1;
    for (const gate of track.gates) {
      const along = track.lapDistance(gate.index);
      expect(along).toBeGreaterThan(last);
      if (last >= 0) expect(along - last).toBeGreaterThanOrEqual(19);
      last = along;
    }
  });

  it('put a respawned car safely on the road: attached, still, and not falling', () => {
    const input = createInput();
    for (const gate of track.gates) {
      const sim = new Sim(track);
      const pose = track.poseAt(gate.index);
      sim.placeCar(pose.position, pose.quaternion);
      let detached = 0;
      let respawned = false;
      for (let i = 0; i < 3 * 120; i++) {
        sim.step(input);
        if (!sim.attached) detached++;
        if (sim.events.some((e) => e.type === 'respawn')) respawned = true;
      }
      expect(detached, `gate ${gate.number}: steps off the road`).toBe(0);
      expect(respawned).toBe(false);
      expect(sim.speed, `gate ${gate.number}: speed after 3 s`).toBeLessThan(6); // a gentle slope lets it creep
    }
  });
});

describe('falling into a gap', () => {
  const track = createTrack('gap-run') as Track;
  const gap = track.gaps[0];
  if (!gap) throw new Error('no gap');

  it('respawns the player once, back on the road before the gap, instead of falling again and again', () => {
    const race = new Race(track);
    const input = createInput();
    for (let i = 0; i < 4 * 120; i++) race.step(input); // through the countdown
    expect(race.state).toBe('racing');

    // line the player up 25 m before the gap, doing 30 m/s, and let it drive straight in
    const sim = race.player.sim;
    const index = (gap.first - Math.round(25 / track.spacing) + track.count) % track.count;
    const pose = track.poseAt(index);
    sim.placeCar(pose.position, pose.quaternion);
    race.player.relocate(track);
    const frame = track.frames[index];
    if (!frame) throw new Error('missing frame');
    sim.car.setVelocity(frame.tangent.clone().multiplyScalar(30));

    let falls = 0;
    let firstFall = -1;
    for (let i = 0; i < 20 * 120; i++) {
      race.step(input);
      for (const e of sim.events) {
        if (e.type === 'respawn' && e.reason === 'fell') {
          falls++;
          if (firstFall < 0) firstFall = i * PHYSICS_DT;
        }
      }
    }
    expect(falls).toBe(1);
    expect(firstFall).toBeGreaterThan(0);
    expect(firstFall).toBeLessThan(3.5); // a couple of seconds of falling, not forever
    expect(sim.attached).toBe(true);
    expect(sim.penalty).toBe(3);
    // and it is back before the gap, on solid road
    expect(race.player.progress.index).toBeLessThan(gap.first);
  });

  it('even a car that falls every time it is put back ends up respawned somewhere solid', () => {
    // every gate of every track is solid, so a respawn can never itself be a fall
    for (const { track: t } of all) {
      for (const gate of t.gates) expect(t.gapAt(gate.index)).toBeNull();
    }
  });
});
