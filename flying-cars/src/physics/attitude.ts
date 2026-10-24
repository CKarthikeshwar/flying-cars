import { Vector3 } from 'three';
import { AI_FLIP_DECEL, AI_FLIP_RATE_GAIN, AIR_SPIN_CAP } from '../util/constants';
import { clamp } from '../util/math';

/**
 * How hard to turn to close an angle `error` (rad) when already turning at `rate` (rad/s): aim for the fastest
 * turn that can still be stopped on time, and push or pull to match it. Gives -1 to +1.
 */
export function turnToward(error: number, rate: number): number {
  const wanted =
    Math.sign(error) * Math.min(AIR_SPIN_CAP * 0.9, Math.sqrt(2 * AI_FLIP_DECEL * Math.abs(error)));
  return clamp(AI_FLIP_RATE_GAIN * (wanted - rate), -1, 1);
}

/**
 * The roll and pitch that turn a car toward a landing surface. `up` is the surface's up in the car's own axes
 * (x right, y up, z back), `spin` the car's spin in the same axes. Writes into `out` (roll positive to the
 * right, pitch positive nose down). Upside down it only rolls, so it does not twist.
 */
export function attitudeCommand(
  up: Vector3,
  spin: Vector3,
  out: { roll: number; pitch: number },
): void {
  out.roll = turnToward(Math.atan2(up.x, up.y), -spin.z);
  out.pitch = up.y > 0 ? turnToward(Math.atan2(-up.z, up.y), -spin.x) : 0;
}
