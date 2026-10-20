import { Quaternion, Vector3 } from 'three';
import { RAPIER, addFlatGround, createWorld } from './world';
import { CarBody } from './CarBody';
import { SurfaceSensor } from './surface';
import { AirTank, stepSpin } from './thrusters';
import { FlipCounter } from './flips';
import { classifyLanding, impactSpeed, landingAngle, type LandingKind } from './landing';
import {
  addBoost,
  addDrag,
  addDriveAndGrip,
  addGravity,
  addSuction,
  surfaceTangent,
  yawRate,
} from './forces';
import { createInput, type Input } from './Input';
import {
  AIR_DRAG_FACTOR,
  ALIGN_RATE,
  ATT_RATE,
  BOOST_RATE,
  CAR_MASS,
  CAR_SPAWN_HEIGHT,
  CUSHION_COST,
  CUSHION_CUT,
  CUSHION_RANGE,
  FLIP_REFUND,
  HOP_COOLDOWN,
  HOP_COST,
  HOP_DV,
  LAND_PERFECT_BOOST,
  LAND_PERFECT_REFUND,
  LAND_ROUGH_SPEED_MULT,
  PHYSICS_DT,
  REGEN_RATE,
  RESPAWN_DELAY,
  RESPAWN_PENALTY,
  STRIP_RATE,
  SUCTION_LOCKOUT,
} from '../util/constants';

export type SimEvent =
  | { type: 'hop' }
  | { type: 'hopRefused' }
  | { type: 'cushion' }
  | { type: 'flip'; count: number }
  | { type: 'landing'; kind: LandingKind; angleDeg: number; impactSpeed: number }
  | { type: 'respawn' };

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
  /** Set by the track when the car is over a charge strip. */
  onChargeStrip = false;
  /** Seconds until a crashed car respawns. Zero when not crashed. */
  crashTimer = 0;
  lastLanding: LandingReport | null = null;

  private hopCooldown = 0;
  private suctionLock = 0;
  private cushionUsed = false;

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
  private readonly invQuat = new Quaternion();
  private readonly impulse = new Vector3();
  private readonly angvel = { x: 0, y: 0, z: 0 };
  private readonly forceOut = { x: 0, y: 0, z: 0 };

  constructor() {
    this.world = createWorld();
    addFlatGround(this.world);
    this.car = new CarBody(this.world);
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

  /** Puts the car back at the spawn point, at rest and level. */
  respawn(): void {
    this.car.reset(0, CAR_SPAWN_HEIGHT, 0);
    this.attached = true;
    this.boosting = false;
    this.hopCooldown = 0;
    this.suctionLock = 0;
    this.cushionUsed = false;
    this.crashTimer = 0;
    this.flips.reset();
    this.snapshot();
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
    this.events.push({ type: 'respawn' });
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
        this.respawn();
        return;
      }
      input = IDLE; // a crashed car coasts until it respawns
    } else if (request.respawn) {
      this.penalty += RESPAWN_PENALTY;
      this.respawn();
      return;
    }

    this.sensor.update(this.world, car, dt);
    this.hopCooldown = Math.max(0, this.hopCooldown - dt);
    this.suctionLock = Math.max(0, this.suctionLock - dt);

    const normal = this.sensor.smoothNormal;
    const velocity = car.velocity;
    let attached = this.sensor.nearSurface && this.suctionLock === 0;

    if (attached && !this.attached) this.land(normal);
    else if (!attached && this.attached) this.takeOff();

    // ---- Hop (on a surface) and cushion (descending near one) ----
    if (input.hop) {
      if (attached) {
        if (this.hopCooldown === 0) {
          if (this.air.spend(HOP_COST)) {
            this.addVelocityChange(normal, HOP_DV);
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

    // ---- Forces ----
    const f = this.force.set(0, 0, 0);
    addGravity(f);
    let dragFactor = AIR_DRAG_FACTOR;
    if (attached) {
      surfaceTangent(this.tangent, car.forward, normal, car.right);
      addSuction(f, normal, this.sensor.distance);
      addDriveAndGrip(f, this.tangent, normal, velocity, input.throttle - input.brake);
      dragFactor = 1;
      this.air.add(REGEN_RATE * dt);
      if (this.onChargeStrip) this.air.add(STRIP_RATE * dt);
    }
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
      this.cross.crossVectors(car.up, normal).multiplyScalar(ALIGN_RATE);
      this.setAngularVelocity(
        normal.x * w + this.cross.x,
        normal.y * w + this.cross.y,
        normal.z * w + this.cross.z,
      );
    } else {
      this.airControl(input, dt);
    }

    this.attached = attached;
    this.world.step();
    car.refresh();
    this.snapshot();
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

    const wanted = input.pitch !== 0 || input.roll !== 0 || input.steer !== 0;
    const controlling = wanted && this.air.value > 0;
    if (controlling) this.air.burn(ATT_RATE * dt);
    stepSpin(
      this.omega,
      controlling ? input.pitch : 0,
      controlling ? input.roll : 0,
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
    const speed = impactSpeed(car.velocity, normal);
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
