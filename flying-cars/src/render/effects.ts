import { Quaternion, Scene, Vector3 } from 'three';
import {
  BOOST_PUFFS_PER_S,
  BURST_SPEED,
  HIT_PUFFS,
  RING_PUFFS,
  DASH_PUFFS,
  DASH_PUFF_SPEED,
  RETRO_PUFFS_PER_S,
  RETRO_PUFF_SPEED,
  SLAM_PUFFS_PER_S,
  SLAM_PUFF_SPEED,
  BOOST_PUFF_SPEED,
  GAS_DRAG,
  GAS_INHERIT,
  GAS_POOL,
  GLIDE_PUFFS_PER_S,
  GLIDE_PUFF_SPEED,
  HOP_PUFFS,
  HOP_PUFF_SPEED,
  JET_PUFFS_PER_S,
  JET_PUFF_SPEED,
} from '../util/constants';
import { ParticleSystem } from './particles';

/** Where a car is, for emitting from it: its pose and its velocity. */
export interface EmitterPose {
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
}

/** What the car is doing right now, for the continuous effects. */
export interface StreamState {
  boosting: boolean;
  gliding: boolean;
  /** The front jets are braking. */
  retro: boolean;
  /** The roof jets are slamming the car down. */
  slam: boolean;
  airborne: boolean;
  /** Air control, -1 to +1 each: pitch (+ nose down), roll (+ right), steer (+ right). */
  pitch: number;
  roll: number;
  steer: number;
}

type Range = number[];

type Vec3 = [number, number, number];
const DOWN: Vec3 = [0, -1, 0];
const UP: Vec3 = [0, 1, 0];
const BACK: Vec3 = [0, 0, 1];
const FORWARD: Vec3 = [0, 0, -1];
const LEFT: Vec3 = [-1, 0, 0];
const RIGHT: Vec3 = [1, 0, 0];
const MIDDLE: Vec3 = [0, 0.2, 0];
const R_HOP: Range = [0.45, 0.85];
const R_CUSHION: Range = [0.35, 0.7];
const R_BOOST: Range = [0.3, 0.55];
const R_GLIDE: Range = [0.4, 0.7];
const R_RETRO: Range = [0.25, 0.5];
const R_JET: Range = [0.25, 0.45];
const R_BURST: Range = [0.4, 0.8];
const R_DASH: Range = [0.3, 0.6];
const DASH_RIGHT: Vec3[] = [
  [0.95, 0.05, -1.5],
  [0.95, 0.05, 1.5],
];
const DASH_LEFT: Vec3[] = [
  [-0.95, 0.05, -1.5],
  [-0.95, 0.05, 1.5],
];

const GAS: [number, number, number] = [0.6, 0.95, 1.0]; // bright cyan-white, like cold compressed air
const LIME: [number, number, number] = [0.72, 1.0, 0.24]; // a ring
const RED: [number, number, number] = [1.0, 0.22, 0.4]; // a barrier
const HOT: [number, number, number] = [1.0, 0.7, 0.35]; // boost: warmer at the nozzle

// Nozzle positions and directions in the car's own frame (it faces -z, +x is right, +y is up).
const REAR_NOZZLES: [number, number, number][] = [
  [-0.55, 0.02, 2.05],
  [0.55, 0.02, 2.05],
];
const FRONT_NOZZLES: [number, number, number][] = [
  [-0.55, 0.02, -2.05],
  [0.55, 0.02, -2.05],
];
const ROOF_NOZZLES: [number, number, number][] = [
  [-0.6, 0.45, 0.3],
  [0.6, 0.45, 0.3],
];
const UNDER_NOZZLES: [number, number, number][] = [
  [-0.72, -0.3, 0.2],
  [0.72, -0.3, 0.2],
];

/** A cold-gas attitude jet: where it sits on the car, and which way the gas leaves. */
interface Jet {
  at: [number, number, number];
  dir: [number, number, number];
}
const NOSE_L: [number, number, number] = [-0.95, 0.1, -1.8];
const NOSE_R: [number, number, number] = [0.95, 0.1, -1.8];
const TAIL_L: [number, number, number] = [-0.95, 0.1, 1.8];
const TAIL_R: [number, number, number] = [0.95, 0.1, 1.8];

/** Per car, the leftover fraction of a particle not yet emitted, so low rates still come out evenly. */
class Accumulators {
  boost = 0;
  glide = 0;
  retro = 0;
  slam = 0;
  jet = 0;
}

const between = (range: Range): number =>
  (range[0] ?? 0) + Math.random() * ((range[1] ?? 0) - (range[0] ?? 0));

/**
 * The visible compressed-air effects. Gas vents under the car when it hops, streams out the back when it
 * boosts, leaks under it while it glides, and puffs from small jets at the corners while it tilts in the air.
 * All of it is a fixed pool of soft points, so nothing is allocated per frame.
 */
export class Effects {
  readonly gas = new ParticleSystem(GAS_POOL, true, 1.3);
  private readonly accumulators = new Map<number, Accumulators>();
  private readonly world = new Vector3();
  private readonly push = new Vector3();
  private readonly scatter: Vec3 = [0, 0, 0];

  constructor(scene: Scene) {
    scene.add(this.gas.points);
  }

  /** The burst of gas under the car as it hops off the surface. */
  hop(pose: EmitterPose): void {
    for (const nozzle of UNDER_NOZZLES) {
      for (let k = 0; k < HOP_PUFFS; k++)
        this.emit(pose, nozzle, DOWN, HOP_PUFF_SPEED, 0.5, 2.4, R_HOP, GAS);
    }
  }

  /** The burst out of the side opposite to a dash. `direction` is +1 for a dash to the right, -1 to the left. */
  dash(pose: EmitterPose, direction: number): void {
    const side = -Math.sign(direction); // gas leaves on the opposite side
    const at = side > 0 ? DASH_RIGHT : DASH_LEFT;
    const dir = side > 0 ? RIGHT : LEFT;
    for (let z = 0; z < at.length; z++) {
      for (let k = 0; k < DASH_PUFFS; k++)
        this.emit(pose, at[z] as Vec3, dir, DASH_PUFF_SPEED, 0.45, 2.2, R_DASH, GAS);
    }
  }

  /** A ring of lime gas around the car as it flies through a ring. */
  ring(pose: EmitterPose): void {
    this.burst(pose, RING_PUFFS, LIME);
  }

  /** A burst of red gas from the car as it hits a barrier. */
  hit(pose: EmitterPose): void {
    this.burst(pose, HIT_PUFFS, RED);
  }

  /** A shorter burst for the cushion that softens a landing. */
  cushion(pose: EmitterPose): void {
    for (const nozzle of UNDER_NOZZLES) {
      for (let k = 0; k < HOP_PUFFS * 0.6; k++)
        this.emit(pose, nozzle, DOWN, HOP_PUFF_SPEED, 0.4, 2.0, R_CUSHION, GAS);
    }
  }

  /** Continuous effects for one car, called every frame. `id` tells cars apart so each keeps its own rhythm. */
  stream(id: number, pose: EmitterPose, state: StreamState, dt: number): void {
    let a = this.accumulators.get(id);
    if (!a) {
      a = new Accumulators();
      this.accumulators.set(id, a);
    }

    if (state.boosting) {
      a.boost += BOOST_PUFFS_PER_S * dt;
      for (; a.boost >= 1; a.boost -= 1) {
        for (const nozzle of REAR_NOZZLES)
          this.emit(pose, nozzle, BACK, BOOST_PUFF_SPEED, 0.4, 1.7, R_BOOST, HOT);
      }
    } else {
      a.boost = 0;
    }

    if (state.gliding) {
      a.glide += GLIDE_PUFFS_PER_S * dt;
      for (; a.glide >= 1; a.glide -= 1) {
        for (const nozzle of UNDER_NOZZLES)
          this.emit(pose, nozzle, DOWN, GLIDE_PUFF_SPEED, 0.35, 1.5, R_GLIDE, GAS);
      }
    } else {
      a.glide = 0;
    }

    if (state.retro) {
      a.retro += RETRO_PUFFS_PER_S * dt;
      for (; a.retro >= 1; a.retro -= 1) {
        for (const nozzle of FRONT_NOZZLES)
          this.emit(pose, nozzle, FORWARD, RETRO_PUFF_SPEED, 0.35, 1.6, R_RETRO, GAS);
      }
    } else {
      a.retro = 0;
    }

    if (state.slam) {
      a.slam += SLAM_PUFFS_PER_S * dt;
      for (; a.slam >= 1; a.slam -= 1) {
        for (const nozzle of ROOF_NOZZLES)
          this.emit(pose, nozzle, UP, SLAM_PUFF_SPEED, 0.35, 1.6, R_RETRO, GAS);
      }
    } else {
      a.slam = 0;
    }

    if (state.airborne && (state.pitch !== 0 || state.roll !== 0 || state.steer !== 0)) {
      a.jet += JET_PUFFS_PER_S * dt;
      const jets = jetsFor(state.pitch, state.roll, state.steer);
      for (; a.jet >= 1; a.jet -= 1) {
        for (const jet of jets)
          this.emit(pose, jet.at, jet.dir, JET_PUFF_SPEED, 0.25, 1.1, R_JET, GAS);
      }
    } else {
      a.jet = 0;
    }
  }

  /** Moves everything on. `pixelsPerMetre` is how big one metre at distance one looks on screen. */
  update(dt: number, pixelsPerMetre: number): void {
    this.gas.setViewScale(pixelsPerMetre);
    this.gas.update(dt, GAS_DRAG, 0);
  }

  /** Removes every particle, for example when a new race starts. */
  clear(): void {
    this.gas.pool.life.fill(0);
    this.accumulators.clear();
  }

  /** Gas thrown out in every direction from the middle of the car. */
  private burst(pose: EmitterPose, count: number, color: [number, number, number]): void {
    const dir = this.scatter;
    for (let k = 0; k < count; k++) {
      dir[0] = Math.random() - 0.5;
      dir[1] = Math.random() - 0.5;
      dir[2] = Math.random() - 0.5;
      this.emit(pose, MIDDLE, dir, BURST_SPEED, 0.5, 2.6, R_BURST, color);
    }
  }

  private emit(
    pose: EmitterPose,
    at: [number, number, number],
    dir: [number, number, number],
    speed: Range,
    size0: number,
    size1: number,
    life: Range,
    color: [number, number, number],
  ): void {
    this.emitTo(this.gas, pose, at, dir, speed, size0, size1, life, color, GAS_INHERIT);
  }

  private emitTo(
    system: ParticleSystem,
    pose: EmitterPose,
    at: [number, number, number],
    dir: [number, number, number],
    speed: Range,
    size0: number,
    size1: number,
    life: Range,
    color: [number, number, number],
    inherit: number,
  ): void {
    // position: the nozzle in the car's frame, turned into the world
    this.world.set(at[0], at[1], at[2]).applyQuaternion(pose.quaternion).add(pose.position);
    // velocity: the exhaust direction in the world, spread into a cone, plus some of the car's own velocity
    this.push
      .set(
        dir[0] + (Math.random() - 0.5) * 0.5,
        dir[1] + (Math.random() - 0.5) * 0.5,
        dir[2] + (Math.random() - 0.5) * 0.5,
      )
      .normalize()
      .applyQuaternion(pose.quaternion)
      .multiplyScalar(between(speed))
      .addScaledVector(pose.velocity, inherit);
    system.pool.spawn(
      this.world.x,
      this.world.y,
      this.world.z,
      this.push.x,
      this.push.y,
      this.push.z,
      between(life),
      size0,
      size1,
      color[0] * (0.9 + Math.random() * 0.1),
      color[1] * (0.9 + Math.random() * 0.1),
      color[2] * (0.9 + Math.random() * 0.1),
    );
  }

  dispose(): void {
    this.gas.dispose();
  }
}

const JET_NOSE_DOWN: Jet[] = [
  { at: NOSE_L, dir: UP },
  { at: NOSE_R, dir: UP },
];
const JET_NOSE_UP: Jet[] = [
  { at: NOSE_L, dir: DOWN },
  { at: NOSE_R, dir: DOWN },
];
const JET_ROLL_RIGHT: Jet[] = [
  { at: NOSE_R, dir: UP },
  { at: TAIL_R, dir: UP },
];
const JET_ROLL_LEFT: Jet[] = [
  { at: NOSE_L, dir: UP },
  { at: TAIL_L, dir: UP },
];
const JET_TURN_RIGHT: Jet[] = [
  { at: NOSE_L, dir: LEFT },
  { at: TAIL_R, dir: RIGHT },
];
const JET_TURN_LEFT: Jet[] = [
  { at: NOSE_R, dir: RIGHT },
  { at: TAIL_L, dir: LEFT },
];

const jetCache: (Jet[] | undefined)[] = [];

/**
 * The jets that fire for a given air control. Each pushes the car one way by throwing gas the other way:
 * nose down is gas up at the nose, a roll to the right is gas up on the right, and a turn to the right is gas
 * out to the left at the nose and out to the right at the tail.
 */
export function jetsFor(pitch: number, roll: number, steer: number): Jet[] {
  // 27 combinations of the three controls: each list is built once, then reused
  const key = (Math.sign(pitch) + 1) * 9 + (Math.sign(roll) + 1) * 3 + (Math.sign(steer) + 1);
  const cached = jetCache[key];
  if (cached) return cached;
  const jets: Jet[] = [];
  if (pitch > 0) jets.push(...JET_NOSE_DOWN);
  else if (pitch < 0) jets.push(...JET_NOSE_UP);
  if (roll > 0) jets.push(...JET_ROLL_RIGHT);
  else if (roll < 0) jets.push(...JET_ROLL_LEFT);
  if (steer > 0) jets.push(...JET_TURN_RIGHT);
  else if (steer < 0) jets.push(...JET_TURN_LEFT);
  jetCache[key] = jets;
  return jets;
}
