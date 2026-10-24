import { Vector3 } from 'three';

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Frame-rate independent smoothing factor for "move this fraction toward the target". */
export function smoothFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** out = v - (v . n) n. Removes the component of v along the unit vector n. */
export function projectOnPlane(out: Vector3, v: Vector3, n: Vector3): Vector3 {
  const d = v.dot(n);
  return out.set(v.x - d * n.x, v.y - d * n.y, v.z - d * n.z);
}

/** Angle in radians between two unit vectors, safe against rounding past +-1. */
export function angleBetweenUnit(a: Vector3, b: Vector3): number {
  return Math.acos(clamp(a.dot(b), -1, 1));
}
