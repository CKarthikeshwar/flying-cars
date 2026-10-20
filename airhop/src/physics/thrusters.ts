import type { Vector3 } from 'three';
import {
  AIR_MAX,
  AIR_SPIN_CAP,
  AIR_SPIN_DAMP,
  AIR_START,
  AIR_TORQUE_ALPHA,
  BOOST_FACTOR_SLOPE,
  BOOST_MIN_FACTOR,
} from '../util/constants';
import { clamp } from '../util/math';

/** The shared air tank. The value never leaves 0..AIR_MAX, whatever is added or spent. */
export class AirTank {
  value = AIR_START;

  reset(): void {
    this.value = AIR_START;
  }

  /** Adds air (a refill, a flip refund). Clamped to the tank size. */
  add(amount: number): void {
    this.value = clamp(this.value + amount, 0, AIR_MAX);
  }

  /** Burns air continuously. Clamped at empty. */
  burn(amount: number): void {
    this.value = clamp(this.value - amount, 0, AIR_MAX);
  }

  /** One-time cost. Returns false and spends nothing when there is not enough. */
  spend(cost: number): boolean {
    if (this.value < cost) return false;
    this.value = clamp(this.value - cost, 0, AIR_MAX);
    return true;
  }
}

/** Boost thrust shrinks as the tank empties, like a real pressure tank. */
export function boostThrustFactor(air: number): number {
  return BOOST_MIN_FACTOR + BOOST_FACTOR_SLOPE * (clamp(air, 0, AIR_MAX) / AIR_MAX);
}

/** Apex height of a hop from a standing start, ignoring drag: h = dv^2 / (2 g). */
export function hopApexHeight(deltaV: number, gravity: number): number {
  return (deltaV * deltaV) / (2 * gravity);
}

/**
 * One step of air control on the car's angular velocity, in the car's own axes
 * (x = right, y = up, z = back; the car faces -z).
 * Input signs: pitch +1 = nose down, roll +1 = roll right, yaw +1 = turn right.
 * Applies the spin-up, light damping, and the spin cap.
 */
export function stepSpin(
  omegaLocal: Vector3,
  pitch: number,
  roll: number,
  yaw: number,
  dt: number,
): void {
  // Nose down is a negative turn about +x, rolling right is negative about +z, turning right is negative about +y.
  omegaLocal.x -= pitch * AIR_TORQUE_ALPHA * dt;
  omegaLocal.z -= roll * AIR_TORQUE_ALPHA * dt;
  omegaLocal.y -= yaw * AIR_TORQUE_ALPHA * dt;
  omegaLocal.multiplyScalar(Math.exp(-AIR_SPIN_DAMP * dt));
  const speed = omegaLocal.length();
  if (speed > AIR_SPIN_CAP) omegaLocal.multiplyScalar(AIR_SPIN_CAP / speed);
}
