import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import {
  CAM_DISTANCE,
  CAM_HEADING_RATE,
  CAM_HEIGHT,
  CAM_LOOK_AHEAD,
  CAM_UP_RATE,
  FOV_FULL_SPEED,
  FOV_MAX,
  FOV_MIN,
  SHAKE_DECAY,
} from '../util/constants';
import { clamp, projectOnPlane, smoothFactor } from '../util/math';

const IDENTITY = new Quaternion();
/** Below this speed along the surface the camera follows the car's nose instead of its velocity. */
const MIN_HEADING_SPEED = 3;

/**
 * Chase camera behind and above the car, along the car's own up direction.
 * The camera's up vector turns slowly toward the car's up (spherical interpolation), because a fast
 * turn makes wall and ceiling driving sickening. The heading follows the velocity rather than the
 * nose, so a flip does not swing the view around.
 */
export class ChaseCamera {
  private readonly up = new Vector3(0, 1, 0);
  private readonly heading = new Vector3(0, 0, -1);
  private readonly carUp = new Vector3();
  private readonly carForward = new Vector3();
  private readonly source = new Vector3();
  private readonly right = new Vector3();
  private readonly target = new Vector3();
  private readonly turn = new Quaternion();
  private readonly camera: PerspectiveCamera;
  private shake = 0;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
  }

  /** Adds a burst of camera shake that decays on its own. */
  addShake(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  update(
    frameTime: number,
    position: Vector3,
    quaternion: Quaternion,
    velocity: Vector3,
    speed: number,
  ): void {
    this.carUp.set(0, 1, 0).applyQuaternion(quaternion);
    this.carForward.set(0, 0, -1).applyQuaternion(quaternion);

    // Turn the camera's up toward the car's up, a fraction of the way each frame.
    this.turn.setFromUnitVectors(this.up, this.carUp);
    this.turn.slerpQuaternions(IDENTITY, this.turn, smoothFactor(CAM_UP_RATE, frameTime));
    this.up.applyQuaternion(this.turn).normalize();

    // Heading: velocity along the surface plane when moving, otherwise the car's nose.
    projectOnPlane(this.source, velocity, this.up);
    if (this.source.length() < MIN_HEADING_SPEED) projectOnPlane(this.source, this.carForward, this.up);
    if (this.source.lengthSq() > 1e-6) {
      this.source.normalize();
      this.heading.lerp(this.source, smoothFactor(CAM_HEADING_RATE, frameTime));
      projectOnPlane(this.heading, this.heading, this.up).normalize();
    }

    this.target.copy(position).addScaledVector(this.heading, -CAM_DISTANCE).addScaledVector(this.up, CAM_HEIGHT);

    if (this.shake > 0.001) {
      this.right.crossVectors(this.heading, this.up);
      this.target.addScaledVector(this.right, (Math.random() - 0.5) * this.shake);
      this.target.addScaledVector(this.up, (Math.random() - 0.5) * this.shake);
      this.shake *= Math.exp(-SHAKE_DECAY * frameTime);
    } else {
      this.shake = 0;
    }

    this.camera.position.copy(this.target);
    this.camera.up.copy(this.up);
    this.target.copy(position).addScaledVector(this.heading, CAM_LOOK_AHEAD).addScaledVector(this.up, 0.5);
    this.camera.lookAt(this.target);

    const fov = FOV_MIN + (FOV_MAX - FOV_MIN) * clamp(speed / FOV_FULL_SPEED, 0, 1);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
