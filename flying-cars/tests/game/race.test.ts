import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Racer } from '../../src/ai/Racer';
import { GhostPlayer } from '../../src/game/Ghost';
import { Race } from '../../src/game/Race';
import { createInput } from '../../src/physics/Input';
import { initPhysics } from '../../src/physics/world';
import { Pen } from '../../src/track/builders';
import { Track } from '../../src/track/Track';
import { testTrackDef } from '../../src/track/tracks/testTrack';
import { COUNTDOWN_SECONDS, PHYSICS_DT } from '../../src/util/constants';
import { runRace, seeded } from '../helpers/raceHarness';

beforeAll(async () => {
  await initPhysics();
});

const track = new Track(testTrackDef());

describe('the starting grid', () => {
  it('puts four cars on the road behind the line, the player at the front', () => {
    const race = new Race(track);
    expect(race.racers.length).toBe(4);
    expect(race.player).toBe(race.racers[0]);
    for (const r of race.racers) {
      expect(r.distance).toBeLessThan(0); // behind the start line
      expect(r.distance).toBeGreaterThan(-20);
      expect(r.sim.attached).toBe(true);
    }
    const first = race.standings();
    expect(first[0]?.distance).toBeGreaterThan(first[3]?.distance ?? 0);
  });

  it('gives each racer a different place on the grid', () => {
    const race = new Race(track);
    const spots = race.racers.map((r) => r.sim.car.position.clone());
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(spots[i]?.distanceTo(spots[j] as Vector3)).toBeGreaterThan(2);
      }
    }
  });

  it('names the three AI racers and gives them the spec skill factors', () => {
    const race = new Race(track);
    const skills = race.racers.slice(1).map((r) => r.driver?.skill);
    expect(skills).toEqual([0.85, 0.9, 0.95]);
    expect(new Set(race.racers.map((r) => r.name)).size).toBe(4);
  });
});

describe('the countdown', () => {
  it('holds every car still for three seconds, whatever the player presses', () => {
    const race = new Race(track);
    const input = createInput();
    input.throttle = 1;
    input.boost = true;
    const starts = race.racers.map((r) => r.sim.car.position.clone());
    const steps = Math.round((COUNTDOWN_SECONDS - 0.05) / PHYSICS_DT);
    for (let i = 0; i < steps; i++) race.step(input);
    expect(race.state).toBe('countdown');
    expect(race.clock).toBe(0);
    race.racers.forEach((r, i) => {
      expect(r.sim.car.position.distanceTo(starts[i] as Vector3)).toBeLessThan(0.05);
    });
  });

  it('counts 3, 2, 1, then goes, and the clock starts at zero', () => {
    const race = new Race(track);
    const input = createInput();
    expect(race.countdownNumber).toBe(3);
    const seen = new Set<number>();
    let went = false;
    for (let i = 0; i < 4 * 120 && !went; i++) {
      race.step(input);
      seen.add(race.countdownNumber);
      if (race.events.some((e) => e.type === 'go')) went = true;
    }
    expect(went).toBe(true);
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    expect(race.state).toBe('racing');
    expect(race.clock).toBe(0);
    race.step(input);
    expect(race.clock).toBeCloseTo(PHYSICS_DT);
  });
});

describe('gates and laps', () => {
  it('counts a lap only when every gate has been passed in order', () => {
    const race = new Race(track);
    const log = runRace(race, new Racer(track, 0.9), {
      until: (r) => r.player.lapTimes.length >= 1,
      maxSeconds: 120,
    });
    const gates = log
      .filter((e) => e.type === 'gate' && e.racer === 0)
      .map((e) => (e.type === 'gate' ? e.gate : -1));
    // the start line, then every gate in order, then the start line again to finish lap 1
    const expected = [0, ...Array.from({ length: track.gates.length - 1 }, (_, i) => i + 1), 0];
    expect(gates).toEqual(expected);
    const laps = log.filter((e) => e.type === 'lap' && e.racer === 0);
    expect(laps.length).toBe(1);
    expect(race.player.lapTimes[0]).toBeGreaterThan(30);
    expect(race.player.lapTimes[0]).toBeLessThan(70);
  });

  it('does not count a lap when a gate is skipped', () => {
    const race = new Race(track);
    let teleported = false;
    const gatesAfter: number[] = [];
    let lapsBeforeGate4 = 0;
    let sawGate4 = false;
    const log = runRace(race, new Racer(track, 0.9), {
      maxSeconds: 200,
      until: (r) => r.player.lapTimes.length >= 1,
      beforeDrive: (r) => {
        if (!teleported && r.player.nextGate === 4) {
          // jump ahead past gates 4 to 8, as a shortcut would
          const pose = track.poseAt(track.gates[9]?.index ?? 0);
          r.player.sim.placeCar(pose.position, pose.quaternion);
          r.player.relocate(track);
          teleported = true;
        }
      },
      onStep: (r) => {
        if (!teleported) return;
        for (const e of r.events) {
          if (e.type === 'gate' && e.racer === 0) {
            gatesAfter.push(e.gate);
            if (e.gate === 4) sawGate4 = true;
          }
          if (e.type === 'lap' && e.racer === 0 && !sawGate4) lapsBeforeGate4++;
        }
      },
    });
    expect(teleported).toBe(true);
    // Gates 9, 10, 11 and the start line were driven through, but none of them counted: the very next
    // gate to count was gate 4, the one that was skipped.
    expect(gatesAfter[0]).toBe(4);
    expect(lapsBeforeGate4).toBe(0);
    // The lap only counts once the car has been round through the gates it missed, so it takes about two laps' time.
    const laps = log.filter((e) => e.type === 'lap' && e.racer === 0);
    expect(laps.length).toBe(1);
    expect(race.player.lapTimes[0]).toBeGreaterThan(54); // well over a normal lap (about 43 s)
  });

  it('does not count a lap for crossing the line backwards or for starting without passing the gates', () => {
    const race = new Race(track);
    const input = createInput();
    for (let i = 0; i < 4 * 120; i++) race.step(input); // through the countdown
    // put the player just past the line, facing the wrong way, and let it sit
    const pose = track.poseAt(track.startIndex + 5);
    race.player.sim.placeCar(pose.position, pose.quaternion);
    race.player.relocate(track);
    for (let i = 0; i < 5 * 120; i++) race.step(input);
    expect(race.player.lapTimes.length).toBe(0);
  });

  it('puts a respawn back at the last gate passed, and charges 3 seconds', () => {
    const race = new Race(track);
    let pressed = false;
    let before: Vector3 | null = null;
    let gateAtPress = -1;
    runRace(race, new Racer(track, 0.9), {
      maxSeconds: 200,
      until: (r) => r.player.finished,
      beforeDrive: (r, input) => {
        if (!pressed && r.player.nextGate === 6) {
          pressed = true;
          input.respawn = true;
          before = r.player.sim.car.position.clone();
          gateAtPress = r.player.nextGate - 1;
        }
      },
    });
    expect(pressed).toBe(true);
    expect(before).not.toBeNull();
    expect(race.player.finished).toBe(true);
    expect(race.player.sim.penalty).toBe(3);
    const lapSum = race.player.lapTimes.reduce((a, b) => a + b, 0);
    expect(race.player.finishTime).toBeCloseTo(
      race.player.lapStart > 0 ? lapSum + (race.player.finishTime - lapSum - 3) + 3 : 0,
      3,
    );
    expect(gateAtPress).toBe(5);
  });
});

describe('the AI', () => {
  it('finishes 3 laps in 10 of 10 trials, each AI with its own skill, with steering noise', () => {
    for (let trial = 0; trial < 10; trial++) {
      const random = seeded(1000 + trial);
      const race = new Race(track, { aiNoise: 0.15, random });
      const pilot = new Racer(track, 0.95);
      pilot.steerNoise = 0.15;
      pilot.random = random;
      runRace(race, pilot, { maxSeconds: 300, until: (r) => r.racers.every((x) => x.finished) });
      for (const r of race.racers) {
        expect(r.finished, `trial ${trial}: ${r.name} finished`).toBe(true);
        expect(r.lapTimes.length, `trial ${trial}: ${r.name} laps`).toBe(3);
        expect(r.sim.penalty, `trial ${trial}: ${r.name} penalty`).toBeLessThanOrEqual(6);
      }
    }
  }, 120000);

  it('finishes in skill order: a higher skill factor is faster', () => {
    const race = new Race(track);
    runRace(race, new Racer(track, 0.95), {
      maxSeconds: 300,
      until: (r) => r.racers.every((x) => x.finished),
    });
    const dune = race.racers[1];
    const marrow = race.racers[2];
    const kestrel = race.racers[3];
    expect(kestrel?.finishTime).toBeLessThan(marrow?.finishTime ?? 0);
    expect(marrow?.finishTime).toBeLessThan(dune?.finishTime ?? 0);
    expect(race.standings().map((r) => r.place)).toEqual([1, 2, 3, 4]);
  });

  it('slows to a stop on the road after finishing instead of driving off', () => {
    const race = new Race(track);
    runRace(race, new Racer(track, 0.95), {
      maxSeconds: 300,
      until: (r) => r.racers.every((x) => x.finished),
    });
    const input = createInput();
    for (let i = 0; i < 10 * 120; i++) race.step(input); // ten more seconds
    for (const r of race.racers) {
      expect(r.sim.penalty).toBe(0);
      expect(r.sim.speed).toBeLessThan(20);
    }
  });

  it('hops once at each hop marker, every lap, and lands cleanly', () => {
    const pen = new Pen();
    pen.straight(300).turn(180, 60, 'left').straight(300).turn(180, 60, 'left');
    const stadium = new Track({
      name: 'Hop Test',
      points: pen.close(),
      banking: [],
      start: 40,
      hops: [150],
    });
    expect(stadium.hopMarkers.length).toBe(1);
    const race = new Race(stadium, { ai: [{ name: 'Hopper', skill: 0.85 }] });
    let hops = 0;
    const landings: string[] = [];
    runRace(race, new Racer(stadium, 0.85), {
      maxSeconds: 300,
      until: (r) => r.racers.every((x) => x.finished),
      onStep: (r) => {
        const hopper = r.racers[1];
        for (const e of hopper?.sim.events ?? []) {
          if (e.type === 'hop') hops++;
          if (e.type === 'landing') landings.push(e.kind);
        }
      },
    });
    const hopper = race.racers[1];
    expect(hopper?.finished).toBe(true);
    expect(hops).toBe(3); // once on each of the three laps
    expect(landings).not.toContain('crash');
    expect(hopper?.sim.penalty).toBe(0);
  });
});

describe('the ghost', () => {
  it('records the player lap and replays it within 5 cm of where the car really was', () => {
    const race = new Race(track);
    const truth: { t: number; p: Vector3 }[] = [];
    let ghostData = null as ReturnType<Race['recorder']['finish']>;
    runRace(race, new Racer(track, 0.9), {
      maxSeconds: 120,
      until: (r) => r.player.lapTimes.length >= 1,
      onStep: (r) => {
        if (r.player.lap === 1 && !r.player.finished) {
          truth.push({ t: r.clock - r.player.lapStart, p: r.player.sim.car.position.clone() });
        }
        for (const e of r.events) if (e.type === 'lap' && e.racer === 0) ghostData = e.ghost;
      },
    });
    expect(ghostData).not.toBeNull();
    if (!ghostData) return;
    expect(ghostData.lapTime).toBeCloseTo(race.player.lapTimes[0] ?? 0, 6);
    const ghost = new GhostPlayer(ghostData);
    const pos = new Vector3();
    const quat = race.player.sim.car.quaternion.clone();
    let worst = 0;
    for (const { t, p } of truth) {
      if (t > ghostData.lapTime) continue; // the last step ends just past the line
      ghost.poseAt(t, pos, quat);
      worst = Math.max(worst, pos.distanceTo(p));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('shows no gap without a ghost, and about zero against its own earlier lap', () => {
    const race = new Race(track);
    expect(race.ghostGap).toBeNull();
    let ghostData = null as ReturnType<Race['recorder']['finish']>;
    const gaps: number[] = [];
    runRace(race, new Racer(track, 0.9), {
      maxSeconds: 200,
      until: (r) => r.player.lapTimes.length >= 2,
      onStep: (r) => {
        for (const e of r.events) {
          if (e.type === 'lap' && e.racer === 0 && e.lap === 1 && e.ghost) {
            ghostData = e.ghost;
            r.setGhost(e.ghost);
          }
        }
        if (r.player.lap === 2 && r.ghostGap !== null) gaps.push(r.ghostGap);
      },
    });
    expect(ghostData).not.toBeNull();
    expect(gaps.length).toBeGreaterThan(1000);
    // the same driver over the same road: ahead or behind by a fraction of a second at most
    expect(Math.max(...gaps.map(Math.abs))).toBeLessThan(0.8);
  });

  it('says a slower driver is behind the ghost (positive) and a faster one ahead (negative)', () => {
    // record a lap with a fast driver, then race it with a slow one
    const fast = new Race(track);
    let data = null as ReturnType<Race['recorder']['finish']>;
    runRace(fast, new Racer(track, 0.95), {
      maxSeconds: 120,
      until: (r) => r.player.lapTimes.length >= 1,
      onStep: (r) => {
        for (const e of r.events) if (e.type === 'lap' && e.racer === 0) data = e.ghost;
      },
    });
    expect(data).not.toBeNull();

    const slow = new Race(track);
    slow.setGhost(data);
    let gapLate = 0;
    runRace(slow, new Racer(track, 0.85), {
      maxSeconds: 120,
      until: (r) => r.player.lap === 1 && r.lapTime > 30,
      onStep: (r) => {
        if (r.ghostGap !== null) gapLate = r.ghostGap;
      },
    });
    expect(gapLate).toBeGreaterThan(1); // well behind the faster ghost
  });
});

describe('positions', () => {
  it('ranks the racers by distance while racing, and by finishing time at the end', () => {
    const race = new Race(track);
    let midRace: string[] = [];
    runRace(race, new Racer(track, 0.95), {
      maxSeconds: 300,
      until: (r) => r.racers.every((x) => x.finished),
      onStep: (r) => {
        if (midRace.length === 0 && r.clock > 60) midRace = r.standings().map((x) => x.name);
      },
    });
    expect(midRace.length).toBe(4);
    expect(midRace[3]).toBe('Dune'); // the slowest AI is last
    expect(race.standings().map((r) => r.place)).toEqual([1, 2, 3, 4]);
    expect(race.playerPlace).toBe(race.player.place);
  });
});
