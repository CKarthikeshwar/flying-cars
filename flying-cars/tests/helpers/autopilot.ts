import { Vector3 } from 'three';
import type { Sim } from '../../src/physics/Sim';
import type { Input } from '../../src/physics/Input';
import type { Track } from '../../src/track/Track';
import { clamp } from '../../src/util/math';

/**
 * A minimal driver for tests: steers at a point on the centre line ahead of the car and holds a target speed.
 * It is the seed of the Milestone 3 AI, kept here so physics tests can drive a whole lap.
 */
export class Autopilot {
  /** Index of the track sample nearest the car. */
  index = 0;
  targetSpeed: number;
  private readonly track: Track;
  private readonly sim: Sim;
  private readonly delta = new Vector3();

  constructor(track: Track, sim: Sim, targetSpeed: number) {
    this.track = track;
    this.sim = sim;
    this.targetSpeed = targetSpeed;
  }

  /** Distance along the track of the nearest sample, metres. */
  get progress(): number {
    return this.track.frames[this.index]?.s ?? 0;
  }

  drive(input: Input): void {
    const { track, sim } = this;
    const n = track.count;
    const car = sim.car;

    // Find the nearest sample, searching a window around the last one.
    let best = Infinity;
    let bestIndex = this.index;
    for (let k = -15; k <= 40; k++) {
      const i = (this.index + k + n) % n;
      const d = car.position.distanceToSquared((track.frames[i] as { position: Vector3 }).position);
      if (d < best) {
        best = d;
        bestIndex = i;
      }
    }
    this.index = bestIndex;

    const lookahead = 8 + 0.25 * sim.speed;
    const target = track.frames[(this.index + Math.round(lookahead)) % n] as { position: Vector3 };
    this.delta.copy(target.position).sub(car.position);
    const f = this.delta.dot(car.forward);
    const r = this.delta.dot(car.right);
    input.steer = clamp(Math.atan2(r, f) * 2.5, -1, 1);
    input.throttle = sim.speed < this.targetSpeed ? 1 : 0;
    input.brake = sim.speed > this.targetSpeed + 3 ? 1 : 0;
  }
}
