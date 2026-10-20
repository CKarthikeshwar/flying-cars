import { Quaternion, Vector3 } from 'three';
import { RAPIER } from './world';
import {
  CAR_HALF_HEIGHT,
  CAR_HALF_LENGTH,
  CAR_HALF_WIDTH,
  CAR_MASS,
  CAR_SPAWN_HEIGHT,
} from '../util/constants';

/**
 * The car's rigid body and a few cached orientation vectors.
 * The car faces -z, its right is +x and its up is +y when the orientation is the identity.
 */
export class CarBody {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  readonly velocity = new Vector3();
  readonly up = new Vector3(0, 1, 0);
  readonly forward = new Vector3(0, 0, -1);
  readonly right = new Vector3(1, 0, 0);

  constructor(world: RAPIER.World) {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, CAR_SPAWN_HEIGHT, 0)
      .setCcdEnabled(true) // fast car, thin track: continuous collision stops tunneling
      .setCanSleep(false);
    this.body = world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(CAR_HALF_WIDTH, CAR_HALF_HEIGHT, CAR_HALF_LENGTH)
      .setMass(CAR_MASS)
      .setFriction(0) // drive, steering and sideways grip are our own forces
      .setRestitution(0);
    this.collider = world.createCollider(colliderDesc, this.body);
    this.refresh();
  }

  /** Reads the body into the cached vectors. Call once after every physics step. */
  refresh(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    const v = this.body.linvel();
    this.position.set(t.x, t.y, t.z);
    this.quaternion.set(r.x, r.y, r.z, r.w);
    this.velocity.set(v.x, v.y, v.z);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);
  }

  setVelocity(v: Vector3): void {
    this.body.setLinvel(v, true);
    this.velocity.copy(v);
  }

  scaleVelocity(factor: number): void {
    this.velocity.multiplyScalar(factor);
    this.body.setLinvel(this.velocity, true);
  }

  /** Puts the car back at rest, level, at a spawn position. */
  reset(x: number, y: number, z: number): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.refresh();
  }
}
