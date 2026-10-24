import { FLIP_TURN } from '../util/constants';

/**
 * Counts full pitch and roll turns while airborne by accumulating
 * theta += omega * dt about the car's own right axis (pitch) and forward axis (roll).
 * A turn counts once |theta| reaches 2 pi, then the counter keeps the overshoot.
 */
export class FlipCounter {
  pitchAngle = 0;
  rollAngle = 0;

  reset(): void {
    this.pitchAngle = 0;
    this.rollAngle = 0;
  }

  /** omegaRight and omegaForward are angular velocity components in the car's frame (rad/s). Returns new flips this step. */
  update(omegaRight: number, omegaForward: number, dt: number): number {
    this.pitchAngle += omegaRight * dt;
    this.rollAngle += omegaForward * dt;
    let flips = 0;
    while (Math.abs(this.pitchAngle) >= FLIP_TURN) {
      this.pitchAngle -= Math.sign(this.pitchAngle) * FLIP_TURN;
      flips++;
    }
    while (Math.abs(this.rollAngle) >= FLIP_TURN) {
      this.rollAngle -= Math.sign(this.rollAngle) * FLIP_TURN;
      flips++;
    }
    return flips;
  }
}
