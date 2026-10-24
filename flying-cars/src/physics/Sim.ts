import { Quaternion, Vector3 } from 'three';
import { RAPIER, addFlatGround, addTrackCollider, createWorld } from './world';
import type { Track } from '../track/Track';
import { CarBody } from './CarBody';
import { SurfaceSensor } from './surface';
import { AirTank, stepSpin } from './thrusters';
import { FlipCounter } from './flips';
import { classifyLanding, impactSpeed, landingAngle, type LandingKind } from './landing';
import {
  addBoost,
  addCeilingHold,
  addDrag,
  addDriveAndGrip,
  addRetro,
  addSlam,
  addGlue,
  addGravity,
  addRideSpring,
  addSuction,
  surfaceTangent,
  yawRate,
} from './forces';
import { createInput, type Input } from './Input';
import { attitudeCommand } from './attitude';
import { smoothFactor } from '../util/math';
import {
  AIR_DRAG_FACTOR,
  ALIGN_MAX_FEEDFORWARD,
  ALIGN_RATE,
  ATT_RATE,
  BOOST_RATE,
  CAR_MASS,
  CAR_SPAWN_HEIGHT,
  CUSHION_COST,
  CUSHION_CUT,
  CUSHION_RANGE,
  DASH_COOLDOWN,
  DASH_COST,
  DASH_DV,
  DASH_GRIP_SCALE,
  DASH_GRIP_TIME,
  FALL_RESPAWN_SPEED,
  FLIP_REFUND,
  GLIDE_GRAVITY_SCALE,
  GLIDE_RATE,
  GLIDE_TURN_RATE,
  HOP_COOLDOWN,
  HOP_COST,
  HOP_DV,
  HOP_HIGH_COST,
  HOP_HIGH_DV,
  HOP_LONG_COST,
  HOP_LONG_DV,
  HOP_LONG_LEAN,
  LAND_PERFECT_BOOST,
  LAND_PERFECT_REFUND,
  LAND_ROUGH_SPEED_MULT,
  PHYSICS_DT,
  REGEN_RATE,
  RETRO_MIN_SPEED,
  RETRO_RATE,
  RIDE_RATE_JUMP,
  RIDE_RATE_SMOOTHING,
  RESPAWN_DELAY,
  RESPAWN_PENALTY,
  SLAM_MAX_SPEED,
  SLAM_MIN_DISTANCE,
  SLAM_RANGE,
  SLAM_RATE,
  SLAM_SOFT_TIME,
  STRIP_RATE,
  SUCTION_LOCKOUT,
  TRACK_FALL_MARGIN,
} from '../util/constants';

export type SimEvent =
  | { type: 'hop' }
  | { type: 'hopRefused' }
  | { type: 'cushion' }
  | { type: 'dash'; direction: number }
  | { type: 'flip'; count: number }
  | { type: 'landing'; kind: LandingKind; angleDeg: number; impactSpeed: number }
  | { type: 'respawn'; reason: 'key' | 'crash' | 'fell' };

export interface LandingReport {
  kind: LandingKind;
  angleDeg: number;
  impactSpeed: number;
}

const IDLE: Input = createInput();

/**
 * One car on one world, advanced in fixed steps. Knows nothing about rendering or the DOM,
 * so it can be driven headless from tests.
 *
 * Each step: read the surface, work out attached or airborne, handle hop and cushion,
 * add forces and set spin, then let Rapier step the world.
 */
export class Sim {
  readonly world: RAPIER.World;
  readonly track: Track | null;
  readonly car: CarBody;
  readonly sensor = new SurfaceSensor();
  readonly air = new AirTank();
  readonly flips = new FlipCounter();

  /** Events from the most recent step. Cleared at the start of the next one. */
  readonly events: SimEvent[] = [];

  /** Seconds of simulated time. */
  time = 0;
  /** Seconds added to the race clock by crashes and respawns. */
  penalty = 0;
  /** True while close enough to a surface, with suction not locked out. */
  attached = true;
  boosting = false;
  /** True while gliding: Space held in the air, spending air to fall slowly and steer. */
  gliding = false;
  /** True while the front jets are braking hard. */
  retroing = false;
  /** True while the slam jet is pulling the car toward a surface. */
  slamming = false;
  /**
   * Flip assist, set by the race for the player near an island gap: the up of the road it is heading for. While it
   * is on and the player is not rolling or pitching, the car turns itself toward it. Any key press takes over.
   */
  assistOn = false;
  readonly assistUp = new Vector3(0, 1, 0);
  /** Also set by the race: the landing is well above the car, so a plain hop is made a high one. */
  assistHigh = false;
  /** Set by the track when the car is over a charge strip. */
  onChargeStrip = false;
  /** Seconds until a crashed car respawns. Zero when not crashed. */
  crashTimer = 0;
  lastLanding: LandingReport | null = null;

  /** Below this height the car has fallen off the track and respawns. */
  private readonly fallLimit: number;
  private readonly spawnPosition = new Vector3(0, CAR_SPAWN_HEIGHT, 0);
  private readonly spawnQuaternion = new Quaternion();
  private hopCooldown = 0;
  private suctionLock = 0;
  private cushionUsed = false;
  private dashCooldown = 0;
  private dashGrip = 0;
  private slamSoft = 0;
  private readonly toward = new Vector3();
  private readonly assistFrame = new Vector3();
  private readonly assist = { roll: 0, pitch: 0 };

  // Pose before and after the latest step, so rendering can interpolate between them.
  private readonly prevPos = new Vector3();
  private readonly prevQuat = new Quaternion();
  private readonly curPos = new Vector3();
  private readonly curQuat = new Quaternion();

  // Scratch objects. The physics step allocates none of its own.
  private readonly force = new Vector3();
  private readonly tangent = new Vector3();
  private readonly omega = new Vector3();
  private readonly cross = new Vector3();
  private readonly sideways = new Vector3();
  private readonly prevNormal = new Vector3();
  private readonly normalSpin = new Vector3();
  private hasPrevNormal = false;
  private prevDistance = 0;
  private hasPrevDistance = false;
  private awayRate = 0;
  private readonly invQuat = new Quaternion();
  private readonly impulse = new Vector3();
  private readonly angvel = { x: 0, y: 0, z: 0 };
  private readonly forceOut = { x: 0, y: 0, z: 0 };

  /** With no track the car drives on an endless flat floor, the Milestone 1 sandbox. */
  constructor(track: Track | null = null) {
    this.track = track;
    this.world = createWorld();
    if (track) {
      const mesh = track.colliderData();
      addTrackCollider(this.world, mesh.vertices, mesh.indices);
      const pose = track.spawnPose();
      this.spawnPosition.copy(pose.position);
      this.spawnQuaternion.copy(pose.quaternion);
      this.fallLimit = track.minY - TRACK_FALL_MARGIN;
    } else {
      addFlatGround(this.world);
      this.fallLimit = -Infinity;
    }
    this.car = new CarBody(this.world);
    this.car.reset(this.spawnPosition, this.spawnQuaternion);
    // Rapier builds its ray-cast structure on the first step. Step once now so the very first
    // surface check can see the ground (otherwise the car "lands" on step 1 and gets a speed bonus).
    this.world.step();
    this.car.refresh();
    this.snapshot();
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
  }

  /** Current speed in m/s. */
  get speed(): number {
    return this.car.velocity.length();
  }

  get crashed(): boolean {
    return this.crashTimer > 0;
  }

  /** Frees the Rapier world. Rapier lives in WebAssembly memory, which the garbage collector does not reclaim. */
  dispose(): void {
    this.world.free();
  }

  /** Sets where a respawn (key press, crash or fall) puts the car, for example the last checkpoint passed. */
  setSpawn(position: Vector3, quaternion: Quaternion): void {
    this.spawnPosition.copy(position);
    this.spawnQuaternion.copy(quaternion);
  }

  /** Puts the car back at the spawn point, at rest and level. */
  respawn(reason: 'key' | 'crash' | 'fell' = 'key'): void {
    this.placeCar(this.spawnPosition, this.spawnQuaternion);
    this.events.push({ type: 'respawn', reason });
  }

  /** Puts the car at rest at any pose, with all its state cleared. Used by respawn and by tests. */
  placeCar(position: Vector3, quaternion: Quaternion): void {
    this.car.reset(position, quaternion);
    this.sensor.forget();
    this.attached = true;
    this.boosting = false;
    this.hopCooldown = 0;
    this.suctionLock = 0;
    this.cushionUsed = false;
    this.dashCooldown = 0;
    this.dashGrip = 0;
    this.slamSoft = 0;
    this.retroing = false;
    this.slamming = false;
    this.crashTimer = 0;
    this.hasPrevNormal = false;
    this.hasPrevDistance = false;
    this.flips.reset();
    this.snapshot();
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
  }

  /** The car's spin about its own axes in rad/s (x pitch, y yaw, z roll), written into `out`. */
  localSpin(out: Vector3): Vector3 {
    const w = this.car.body.angvel();
    this.invQuat.copy(this.car.quaternion).invert();
    return out.set(w.x, w.y, w.z).applyQuaternion(this.invQuat);
  }

  /** Flying through a ring: refills the air and adds speed along the way the car is moving. */
  ringBoost(air: number, dv: number): void {
    this.air.add(air);
    if (this.car.velocity.lengthSq() > 1) this.toward.copy(this.car.velocity).normalize();
    else this.toward.copy(this.car.forward);
    this.addVelocityChange(this.toward, dv);
  }

  /** Running into a barrier: the car keeps a fraction of its speed and the race clock gets a penalty. */
  hitBarrier(speedMult: number, penalty: number): void {
    this.car.scaleVelocity(speedMult);
    this.penalty += penalty;
  }

  /** Pose between the previous and current step, for smooth rendering. alpha is 0..1. */
  getRenderPose(alpha: number, outPos: Vector3, outQuat: Quaternion): void {
    outPos.lerpVectors(this.prevPos, this.curPos, alpha);
    outQuat.slerpQuaternions(this.prevQuat, this.curQuat, alpha);
  }

  step(request: Input): void {
    const dt = PHYSICS_DT;
    const car = this.car;
    this.events.length = 0;
    this.time += dt;
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);

    let input = request;
    if (this.crashTimer > 0) {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) {
        this.respawn('crash');
        return;
      }
      input = IDLE; // a crashed car coasts until it respawns
    } else if (request.respawn) {
      this.penalty += RESPAWN_PENALTY;
      this.respawn('key');
      return;
    }

    this.sensor.update(this.world, car, dt);
    this.hopCooldown = Math.max(0, this.hopCooldown - dt);
    this.suctionLock = Math.max(0, this.suctionLock - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.dashGrip = Math.max(0, this.dashGrip - dt);
    this.slamSoft = Math.max(0, this.slamSoft - dt);

    const normal = this.sensor.smoothNormal;
    const velocity = car.velocity;

    // How fast the car is moving away from the road, measured as the change in distance to it. On a road
    // whose slope changes (a ramp, a loop, a twist) the car's speed against the road normal is not a real
    // approach speed, and damping it throws the car off the road. The change in distance is relative to the road.
    if (this.sensor.found && this.hasPrevDistance) {
      const raw = (this.sensor.distance - this.prevDistance) / dt;
      // A jump in the reading (the sensor switching from a slanted ray to the straight one, as when it first
      // meets an island's edge) is not the car moving: it would kick the damper. Trust the real speed then.
      const real = velocity.dot(normal);
      const trusted = Math.abs(raw - real) > RIDE_RATE_JUMP ? real : raw;
      this.awayRate += (trusted - this.awayRate) * smoothFactor(RIDE_RATE_SMOOTHING, dt);
    } else {
      this.awayRate = velocity.dot(normal);
    }
    this.prevDistance = this.sensor.distance;
    this.hasPrevDistance = this.sensor.found;
    let attached = this.sensor.nearSurface && this.suctionLock === 0;

    if (attached && !this.attached) this.land(normal);
    else if (!attached && this.attached) this.takeOff();

    // ---- Hop (on a surface) and cushion (descending near one) ----
    if (input.hop) {
      if (attached) {
        if (this.hopCooldown === 0) {
          const style = input.hopStyle === 0 && this.assistHigh ? -1 : input.hopStyle;
          const cost = HOP_COST * (style > 0 ? HOP_LONG_COST : style < 0 ? HOP_HIGH_COST : 1);
          if (this.air.spend(cost)) {
            if (style > 0) {
              // a long hop leans the jump forward along the road
              surfaceTangent(this.tangent, car.forward, normal, car.right);
              this.toward.copy(normal).addScaledVector(this.tangent, HOP_LONG_LEAN).normalize();
              this.addVelocityChange(this.toward, HOP_DV * HOP_LONG_DV);
            } else {
              this.addVelocityChange(normal, HOP_DV * (style < 0 ? HOP_HIGH_DV : 1));
            }
            this.hopCooldown = HOP_COOLDOWN;
            this.suctionLock = SUCTION_LOCKOUT;
            attached = false;
            this.takeOff();
            this.events.push({ type: 'hop' });
          } else {
            this.events.push({ type: 'hopRefused' });
          }
        }
      } else if (!this.cushionUsed && this.sensor.found && this.sensor.distance < CUSHION_RANGE) {
        const vn = velocity.dot(normal); // negative while descending
        if (vn < 0 && this.air.spend(CUSHION_COST)) {
          this.addVelocityChange(normal, -vn * CUSHION_CUT);
          this.cushionUsed = true;
          this.events.push({ type: 'cushion' });
        }
      }
    }

    // ---- Side dash: a sideways jet, on a surface or in the air ----
    if (input.dash !== 0 && this.dashCooldown === 0 && this.air.spend(DASH_COST)) {
      if (attached) {
        surfaceTangent(this.tangent, car.forward, normal, car.right);
        this.sideways.crossVectors(normal, this.tangent); // across the road, to the left
        this.toward.copy(this.sideways).multiplyScalar(-input.dash);
        this.dashGrip = DASH_GRIP_TIME;
      } else {
        this.toward.copy(car.right).multiplyScalar(input.dash);
      }
      this.addVelocityChange(this.toward, DASH_DV);
      this.dashCooldown = DASH_COOLDOWN;
      this.events.push({ type: 'dash', direction: Math.sign(input.dash) });
    }

    // ---- Forces ----
    const f = this.force.set(0, 0, 0);
    let dragFactor = AIR_DRAG_FACTOR;
    if (attached) {
      surfaceTangent(this.tangent, car.forward, normal, car.right);
      this.sideways.crossVectors(normal, this.tangent); // across the road, in the surface plane
      addGravity(f, this.sideways);
      addSuction(f, normal, this.sensor.distance);
      addRideSpring(f, normal, this.sensor.distance, this.awayRate);
      addGlue(f, normal, this.awayRate);
      addCeilingHold(f, normal);
      addDriveAndGrip(
        f,
        this.tangent,
        normal,
        velocity,
        input.throttle - input.brake,
        this.dashGrip > 0 ? DASH_GRIP_SCALE : 1,
      );
      dragFactor = 1;
      this.air.add(REGEN_RATE * dt);
      if (this.onChargeStrip) this.air.add(STRIP_RATE * dt);
    }
    // The front jets brake hard while S is held and there is speed to lose.
    this.retroing =
      attached &&
      input.retro &&
      velocity.dot(this.tangent) > RETRO_MIN_SPEED &&
      this.air.spend(RETRO_RATE * dt);
    if (this.retroing) addRetro(f, this.tangent);

    // The slam jet pulls an airborne car to the nearest surface, stopping short of it and past a top speed.
    this.slamming = false;
    if (!attached && input.slam) {
      this.sensor.probe(this.world, car);
      const reach = this.sensor.reachDistance;
      const into = -velocity.dot(this.sensor.reachNormal); // speed toward that surface
      if (
        reach > SLAM_MIN_DISTANCE &&
        reach < SLAM_RANGE &&
        into < SLAM_MAX_SPEED &&
        this.air.spend(SLAM_RATE * dt)
      ) {
        this.toward.copy(this.sensor.reachNormal).negate();
        addSlam(f, this.toward);
        this.slamming = true;
      }
    }
    if (this.slamming) this.slamSoft = SLAM_SOFT_TIME;

    // Gliding (hold Space in the air) weakens gravity and costs air each step.
    this.gliding = !attached && !this.slamming && input.glide && this.air.spend(GLIDE_RATE * dt);
    if (!attached) addGravity(f, null, this.gliding ? GLIDE_GRAVITY_SCALE : 1);
    addDrag(f, velocity, dragFactor);

    // Boosting costs air each step, so it needs enough air to pay for the step.
    this.boosting = input.boost && this.air.spend(BOOST_RATE * dt);
    if (this.boosting) addBoost(f, car.forward, this.air.value);
    this.forceOut.x = f.x;
    this.forceOut.y = f.y;
    this.forceOut.z = f.z;
    car.body.resetForces(true);
    car.body.addForce(this.forceOut, true);

    // ---- Spin: steering and self-levelling on a surface, air control in the air ----
    if (attached) {
      const w = yawRate(input.steer, velocity.dot(this.tangent));
      // Level onto the surface, plus the rate the surface itself is turning (feed-forward), so the car
      // keeps up with a road that rolls or curves instead of lagging behind it.
      this.cross.crossVectors(car.up, normal).multiplyScalar(ALIGN_RATE);
      if (this.hasPrevNormal) {
        this.normalSpin.crossVectors(this.prevNormal, normal).multiplyScalar(1 / dt);
        const spin = this.normalSpin.length();
        if (spin > ALIGN_MAX_FEEDFORWARD)
          this.normalSpin.multiplyScalar(ALIGN_MAX_FEEDFORWARD / spin);
        this.cross.add(this.normalSpin);
      }
      this.prevNormal.copy(normal);
      this.hasPrevNormal = true;
      this.setAngularVelocity(
        normal.x * w + this.cross.x,
        normal.y * w + this.cross.y,
        normal.z * w + this.cross.z,
      );
    } else {
      this.hasPrevNormal = false;
      this.airControl(input, dt);
    }

    if (this.gliding) this.glideTurn(dt);

    this.attached = attached;
    this.world.step();
    car.refresh();
    this.snapshot();

    // Falling fast with nothing underneath means off the track (a gap missed, an edge). Do not wait for the
    // very bottom: a long fall feels like falling forever. A glide falls slowly, so it never trips this.
    const freeFall = !attached && this.track !== null && car.velocity.y < -FALL_RESPAWN_SPEED;
    if (freeFall || car.position.y < this.fallLimit) {
      this.penalty += RESPAWN_PENALTY; // fell off the track
      this.respawn('fell');
    }
  }

  /**
   * While gliding the direction of flight swings toward the way the car points, in the horizontal plane,
   * at up to GLIDE_TURN_RATE. Speed is kept. Yaw the car with A and D, hold Space, and you steer through the air.
   */
  private glideTurn(dt: number): void {
    const v = this.car.velocity;
    const f = this.car.forward;
    const speed = Math.hypot(v.x, v.z);
    const heading = Math.hypot(f.x, f.z);
    if (speed < 1 || heading < 0.3) return; // not moving sideways, or the nose is pointing straight up or down
    const current = Math.atan2(v.x, v.z);
    const wanted = Math.atan2(f.x, f.z);
    let diff = wanted - current;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const step = Math.max(-GLIDE_TURN_RATE * dt, Math.min(GLIDE_TURN_RATE * dt, diff));
    const angle = current + step;
    this.impulse.set(Math.sin(angle) * speed, v.y, Math.cos(angle) * speed);
    this.car.setVelocity(this.impulse);
  }

  /** Applies a velocity change of `dv` along the unit vector `dir` and keeps the cached velocity in step. */
  private addVelocityChange(dir: Vector3, dv: number): void {
    this.impulse.copy(dir).multiplyScalar(CAR_MASS * dv);
    this.car.body.applyImpulse(this.impulse, true);
    this.car.velocity.addScaledVector(dir, dv);
  }

  private setAngularVelocity(x: number, y: number, z: number): void {
    this.angvel.x = x;
    this.angvel.y = y;
    this.angvel.z = z;
    this.car.body.setAngvel(this.angvel, true);
  }

  private airControl(input: Input, dt: number): void {
    const car = this.car;
    const w = car.body.angvel();
    this.invQuat.copy(car.quaternion).invert();
    this.omega.set(w.x, w.y, w.z).applyQuaternion(this.invQuat); // into the car's own axes

    let pitch = input.pitch;
    let roll = input.roll;
    if (this.assistOn && pitch === 0 && roll === 0) {
      this.assistFrame.copy(this.assistUp).applyQuaternion(this.invQuat); // the landing's up, in the car's axes
      attitudeCommand(this.assistFrame, this.omega, this.assist);
      pitch = this.assist.pitch;
      roll = this.assist.roll;
    }
    const wanted = pitch !== 0 || roll !== 0 || input.steer !== 0;
    const controlling = wanted && this.air.value > 0;
    if (controlling) this.air.burn(ATT_RATE * dt);
    stepSpin(
      this.omega,
      controlling ? pitch : 0,
      controlling ? roll : 0,
      controlling ? input.steer : 0,
      dt,
    );

    const count = this.flips.update(this.omega.x, this.omega.z, dt);
    if (count > 0) {
      this.air.add(FLIP_REFUND * count);
      this.events.push({ type: 'flip', count });
    }

    this.omega.applyQuaternion(car.quaternion); // back to world axes
    this.setAngularVelocity(this.omega.x, this.omega.y, this.omega.z);
  }

  /** The step where the car goes from airborne to attached: judge the landing. */
  private land(normal: Vector3): void {
    const car = this.car;
    const angle = landingAngle(car.up, normal);
    // A landing right after a slam is soft: the jet was braking the fall as well as pulling the car in.
    const speed = this.slamSoft > 0 ? 0 : impactSpeed(car.velocity, normal);
    const kind = classifyLanding(angle, speed);
    const report = { kind, angleDeg: (angle * 180) / Math.PI, impactSpeed: speed };
    this.lastLanding = report;
    this.events.push({ type: 'landing', ...report });

    if (kind === 'perfect') {
      this.air.add(LAND_PERFECT_REFUND);
      surfaceTangent(this.tangent, car.forward, normal, car.right);
      this.addVelocityChange(this.tangent, LAND_PERFECT_BOOST);
    } else if (kind === 'rough') {
      car.scaleVelocity(LAND_ROUGH_SPEED_MULT);
    } else {
      this.crashTimer = RESPAWN_DELAY;
      this.penalty += RESPAWN_PENALTY;
    }
    this.flips.reset();
    this.cushionUsed = false;
  }

  private takeOff(): void {
    this.flips.reset();
    this.cushionUsed = false;
  }

  private snapshot(): void {
    this.curPos.copy(this.car.position);
    this.curQuat.copy(this.car.quaternion);
  }
}
