import { Vector3 } from 'three';
import {
  A_MAX,
  BOOST_ACCEL,
  CAR_MASS,
  DRAG_C,
  GRAVITY,
  GLUE_RATE,
  GRIP_TAU,
  RETRO_DECEL,
  SLAM_ACCEL,
  RIDE_BUMP_DISTANCE,
  RIDE_BUMP_FACTOR,
  RIDE_DAMPING_RATIO,
  RIDE_HEIGHT,
  RIDE_STIFFNESS,
  STEER_RATE_MAX,
  STEER_V_REF,
  SUCTION_SIGMA,
  SURFACE_RANGE,
} from '../util/constants';
import { clamp } from '../util/math';
import { boostThrustFactor } from './thrusters';

const lateral = new Vector3();

/**
 * Weight, always along -y. "Down" changes with the surface, but gravity does not.
 * On a surface pass the unit `sideways` direction (across the road, in the surface plane): the wheels
 * hold the car against gravity in that direction, so a car on a banked wall does not creep down it.
 * Gravity along the direction of travel is still felt, so climbs slow the car and drops speed it up.
 * `scale` weakens gravity, for gliding.
 */
export function addGravity(out: Vector3, sideways: Vector3 | null, scale = 1): Vector3 {
  const w = CAR_MASS * GRAVITY * scale;
  if (sideways === null) {
    out.y -= w;
  } else {
    const along = -w * sideways.y; // weight (0, -w, 0) dotted with the sideways direction
    out.x -= along * sideways.x;
    out.y -= w + along * sideways.y;
    out.z -= along * sideways.z;
  }
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
 * The ride spring and damper, F = k (h0 - d) - c v_n along the normal. It holds the car at ride height
 * (the spec's fix for jitter) and is the only thing that carries the car's weight: the car's box does not
 * collide with the track. Inside the bump stop distance an extra stiff spring stops hard landings.
 * It only pushes, never pulls.
 */
export function addRideSpring(
  out: Vector3,
  normal: Vector3,
  distance: number,
  normalSpeed: number,
): Vector3 {
  if (distance >= RIDE_HEIGHT) return out;
  const k = RIDE_STIFFNESS * CAR_MASS * GRAVITY;
  const c = 2 * RIDE_DAMPING_RATIO * Math.sqrt(k * CAR_MASS);
  const bump =
    distance < RIDE_BUMP_DISTANCE ? RIDE_BUMP_FACTOR * k * (RIDE_BUMP_DISTANCE - distance) : 0;
  const f = Math.max(0, k * (RIDE_HEIGHT - distance) + bump - c * normalSpeed);
  out.x += normal.x * f;
  out.y += normal.y * f;
  out.z += normal.z * f;
  return out;
}

/**
 * On a ceiling (a surface whose normal points down) the car's weight pulls it away from the surface, and suction,
 * which weakens with distance, gives out about a metre from it. This takes the weight's pull away from the surface
 * out, in proportion to how far upside down the surface is, so a ceiling holds a car as well as a floor.
 */
export function addCeilingHold(out: Vector3, normal: Vector3): Vector3 {
  const away = Math.max(0, -normal.y);
  if (away === 0) return out;
  const f = CAR_MASS * GRAVITY * away;
  out.x -= normal.x * f;
  out.y -= normal.y * f;
  out.z -= normal.z * f;
  return out;
}

/**
 * Holds the car to a surface it is drifting away from: a force toward the surface, in proportion to the speed
 * away. Suction alone gives out at about a metre from a ceiling (it weakens with distance while weight does not),
 * so a car that bounces on landing there would otherwise just float away.
 */
export function addGlue(out: Vector3, normal: Vector3, awayRate: number): Vector3 {
  if (awayRate <= 0) return out;
  const f = GLUE_RATE * CAR_MASS * awayRate;
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
  gripScale = 1,
): Vector3 {
  const vt = velocity.dot(tangent);
  const vn = velocity.dot(normal);
  lateral.set(
    velocity.x - vt * tangent.x - vn * normal.x,
    velocity.y - vt * tangent.y - vn * normal.y,
    velocity.z - vt * tangent.z - vn * normal.z,
  );
  const thrust = CAR_MASS * A_MAX * throttle;
  const grip = (CAR_MASS / GRIP_TAU) * gripScale;
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

/** The front jets: extra braking against the direction of travel along the road. */
export function addRetro(out: Vector3, tangent: Vector3): Vector3 {
  const f = CAR_MASS * RETRO_DECEL;
  out.x -= tangent.x * f;
  out.y -= tangent.y * f;
  out.z -= tangent.z * f;
  return out;
}

/** The slam jet: a push along the unit vector `toward`, which points at the surface the car is to be pulled to. */
export function addSlam(out: Vector3, toward: Vector3): Vector3 {
  const f = CAR_MASS * SLAM_ACCEL;
  out.x += toward.x * f;
  out.y += toward.y * f;
  out.z += toward.z * f;
  return out;
}
