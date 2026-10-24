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
  SHAKE_FREQUENCY,
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
  private readonly partial = new Quaternion();
  private readonly camera: PerspectiveCamera;
  /** How fast the camera up vector turns toward the car up, 1/s. */
  upRate = CAM_UP_RATE;
  private shake = 0;
  /** A steady low rumble (while boosting), set every frame. */
  private rumble = 0;
  private shakeClock = 0;
  /** The player's camera shake setting: 0 is none, 1 is the normal amount, 2 is double. */
  shakeScale = 1;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
  }

  /** Sets the steady rumble for this frame (0 for none). It follows the shake setting. */
  setRumble(amount: number): void {
    this.rumble = amount * this.shakeScale;
  }

  /** Adds a burst of camera shake that decays on its own. */
  addShake(amount: number): void {
    this.shake = Math.max(this.shake, amount * this.shakeScale);
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
    // (A separate output quaternion: slerpQuaternions overwrites its own output before it reads qb.)
    this.turn.setFromUnitVectors(this.up, this.carUp);
    this.partial.slerpQuaternions(IDENTITY, this.turn, smoothFactor(this.upRate, frameTime));
    this.up.applyQuaternion(this.partial).normalize();

    // Heading: velocity along the surface plane when moving, otherwise the car's nose.
    projectOnPlane(this.source, velocity, this.up);
    if (this.source.length() < MIN_HEADING_SPEED)
      projectOnPlane(this.source, this.carForward, this.up);
    if (this.source.lengthSq() > 1e-6) {
      this.source.normalize();
      this.heading.lerp(this.source, smoothFactor(CAM_HEADING_RATE, frameTime));
      projectOnPlane(this.heading, this.heading, this.up).normalize();
    }

    this.target
      .copy(position)
      .addScaledVector(this.heading, -CAM_DISTANCE)
      .addScaledVector(this.up, CAM_HEIGHT);

    // The wobble is a pair of sine waves at unrelated rates, so it feels like a shudder rather than static,
    // and looks the same at any frame rate.
    const strength = this.shake + this.rumble;
    if (strength > 0.001) {
      this.shakeClock += frameTime * SHAKE_FREQUENCY;
      this.right.crossVectors(this.heading, this.up);
      this.target.addScaledVector(
        this.right,
        strength * (Math.sin(this.shakeClock) * 0.6 + Math.sin(this.shakeClock * 2.3 + 1.7) * 0.4),
      );
      this.target.addScaledVector(
        this.up,
        strength *
          (Math.sin(this.shakeClock * 1.7 + 0.6) * 0.6 + Math.sin(this.shakeClock * 3.1) * 0.4),
      );
    }
    if (this.shake > 0.001) this.shake *= Math.exp(-SHAKE_DECAY * frameTime);
    else this.shake = 0;

    this.camera.position.copy(this.target);
    this.camera.up.copy(this.up);
    this.target
      .copy(position)
      .addScaledVector(this.heading, CAM_LOOK_AHEAD)
      .addScaledVector(this.up, 0.5);
    this.camera.lookAt(this.target);

    const fov = FOV_MIN + (FOV_MAX - FOV_MIN) * clamp(speed / FOV_FULL_SPEED, 0, 1);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
