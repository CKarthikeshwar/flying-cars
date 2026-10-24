import type { Vector3 } from 'three';
import { LAND_CRASH_ANGLE, LAND_PERFECT_ANGLE, LAND_SAFE_SPEED } from '../util/constants';
import { angleBetweenUnit } from '../util/math';

export type LandingKind = 'perfect' | 'rough' | 'crash';

/**
 * Classifies a landing from the angle between the car's up and the surface normal (rad)
 * and the speed into the surface (m/s).
 *   crash:   angle over 60 degrees
 *   perfect: angle under 30 degrees and impact speed under 8 m/s
 *   rough:   everything else
 */
export function classifyLanding(angle: number, impactSpeed: number): LandingKind {
  if (angle > LAND_CRASH_ANGLE) return 'crash';
  if (angle < LAND_PERFECT_ANGLE && impactSpeed < LAND_SAFE_SPEED) return 'perfect';
  return 'rough';
}

/** alpha = arccos(up . n) */
export function landingAngle(up: Vector3, normal: Vector3): number {
  return angleBetweenUnit(up, normal);
}

/** v_n = -v . n, the speed into the surface. Zero when moving away from it. */
export function impactSpeed(velocity: Vector3, normal: Vector3): number {
  return Math.max(0, -velocity.dot(normal));
}
