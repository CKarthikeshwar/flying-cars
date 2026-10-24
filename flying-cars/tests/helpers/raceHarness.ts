import { Racer } from '../../src/ai/Racer';
import { Race, type RaceEvent } from '../../src/game/Race';
import { createInput, type Input } from '../../src/physics/Input';

/** A tiny seeded random source, so trials differ from each other but every run is the same. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Runs a race headless with the player driven by an AI. Calls `onStep` after every step, and stops when
 * `until` says so or after `maxSeconds` of race time. Returns every race event.
 */
export function runRace(
  race: Race,
  pilot: Racer,
  options: {
    maxSeconds?: number;
    until?: (race: Race) => boolean;
    onStep?: (race: Race, input: Input) => void;
    beforeDrive?: (race: Race, input: Input) => void;
  } = {},
): RaceEvent[] {
  const input = createInput();
  const log: RaceEvent[] = [];
  pilot.reset(race.player.sim);
  const maxClock = options.maxSeconds ?? 400;
  while (race.state === 'countdown' || race.clock < maxClock) {
    input.steer = input.throttle = input.brake = input.pitch = input.roll = 0;
    input.hop = input.boost = input.respawn = false;
    if (race.state !== 'countdown' && !race.player.finished) {
      options.beforeDrive?.(race, input);
      pilot.drive(race.player.sim, input);
    }
    race.step(input);
    log.push(...race.events);
    options.onStep?.(race, input);
    if (options.until?.(race)) break;
  }
  return log;
}
