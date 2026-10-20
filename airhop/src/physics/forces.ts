import { Vector3 } from 'three';
import {
  A_MAX,
  BOOST_ACCEL,
  CAR_MASS,
  DRAG_C,
  GRAVITY,
  GRIP_TAU,
  STEER_RATE_MAX,
  STEER_V_REF,
  SUCTION_SIGMA,
  SURFACE_RANGE,
} from '../util/constants';
import { clamp } from '../util/math';
import { boostThrustFactor } from './thrusters';

const lateral = new Vector3();

/** Weight, always along -y. "Down" changes with the surface, but gravity does not. */
export function addGravity(out: Vector3): Vector3 {
  out.y -= CAR_MASS * GRAVITY;
  return out;
}

/** F_s(d) = sigma m g (1 - d / r_s) for 0 <= d < r_s, else 0. Pulls toward the surface. */
export function suctionMagnitude(distance: number): number {
  if (distance < 0 || distance >= SURFACE_RANGE) return 0;
  return SUCTION_SIGMA * CAR_MASS * GRAVITY * (1 - distance / SURFACE_RANGE);
}

/** Adds suction along -n (n points from the surface to the car). */
export function addSuction(out: Vector3, normal: Vector3, distance: number): Vector3 {
  const f = suctionMagnitude(distance);
  out.x -= normal.x * f;
  out.y -= normal.y * f;
  out.z -= normal.z * f;
  return out;
}

/**
 * Drive direction: the forward vector projected onto the surface and normalised,
 * so the car drives along the surface, not into it. Falls back to `fallback` when forward is
 * parallel to the normal (nose pressed into the surface).
 */
export function surfaceTangent(
  out: Vector3,
  forward: Vector3,
  normal: Vector3,
  fallback: Vector3,
): Vector3 {
  const d = forward.dot(normal);
  out.set(forward.x - d * normal.x, forward.y - d * normal.y, forward.z - d * normal.z);
  if (out.lengthSq() < 1e-8) {
    const e = fallback.dot(normal);
    out.set(fallback.x - e * normal.x, fallback.y - e * normal.y, fallback.z - e * normal.z);
  }
  return out.normalize();
}

/** Throttle thrust along the tangent plus the sideways grip term that removes sliding. */
export function addDriveAndGrip(
  out: Vector3,
  tangent: Vector3,
  normal: Vector3,
  velocity: Vector3,
  throttle: number,
): Vector3 {
  const vt = velocity.dot(tangent);
  const vn = velocity.dot(normal);
  lateral.set(
    velocity.x - vt * tangent.x - vn * normal.x,
    velocity.y - vt * tangent.y - vn * normal.y,
    velocity.z - vt * tangent.z - vn * normal.z,
  );
  const thrust = CAR_MASS * A_MAX * throttle;
  const grip = CAR_MASS / GRIP_TAU;
  out.x += thrust * tangent.x - grip * lateral.x;
  out.y += thrust * tangent.y - grip * lateral.y;
  out.z += thrust * tangent.z - grip * lateral.z;
  return out;
}

/** Quadratic drag, -c_d |v| v, scaled by `factor` (1 on a surface, less in the air). */
export function addDrag(out: Vector3, velocity: Vector3, factor: number): Vector3 {
  const k = DRAG_C * factor * velocity.length();
  out.x -= k * velocity.x;
  out.y -= k * velocity.y;
  out.z -= k * velocity.z;
  return out;
}

/** Boost thrust along the car's heading, weaker as the tank empties. */
export function addBoost(out: Vector3, forward: Vector3, air: number): Vector3 {
  const f = CAR_MASS * BOOST_ACCEL * boostThrustFactor(air);
  out.x += forward.x * f;
  out.y += forward.y * f;
  out.z += forward.z * f;
  return out;
}

/**
 * Yaw rate about the surface normal, rad/s, positive turning left (counter-clockwise from above).
 * You cannot turn at a standstill, and turning saturates at speed. Signed speed so reversing
 * steers the way a real car does.
 */
export function yawRate(steer: number, signedSpeed: number): number {
  return -steer * STEER_RATE_MAX * clamp(signedSpeed / STEER_V_REF, -1, 1);
}
