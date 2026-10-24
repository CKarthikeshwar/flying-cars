import { Vector3 } from 'three';
import { RAPIER } from './world';
import type { CarBody } from './CarBody';
import { CUSHION_RANGE, NORMAL_SMOOTH_RATE, SLAM_RANGE, SURFACE_RANGE } from '../util/constants';
import { smoothFactor } from '../util/math';

/** How far (metres) to the side the retry rays start. */
const RETRY_OFFSET = 0.04;

/** How far we look for a surface: far enough for the cushion assist (3 m). Attachment itself needs < SURFACE_RANGE. */
const SENSE_RANGE = Math.max(SURFACE_RANGE, CUSHION_RANGE);

/**
 * Finds the surface under the car. Casts one ray along the car's down direction; if it misses,
 * casts a fan of six more (forward, back, left, right, up, down-forward) and takes the closest hit.
 * The normal is smoothed over a few frames so the car does not twitch at seams.
 */
export class SurfaceSensor {
  /** True when a surface was found within SENSE_RANGE this step. */
  found = false;
  /** Distance from the car's centre to the hit, along the ray. Infinity when nothing was hit. */
  distance = Infinity;
  /** Raw unit normal of the closest hit, pointing from the surface to the car. */
  readonly normal = new Vector3(0, 1, 0);
  /** Normal smoothed over time. Use this for driving. */
  readonly smoothNormal = new Vector3(0, 1, 0);

  /** Result of the last probe(): distance and unit normal of the surface far below the car, for the slam jet. */
  reachDistance = Infinity;
  readonly reachNormal = new Vector3(0, 1, 0);

  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly dir = new Vector3();
  private readonly fan = [
    new Vector3(0, 0, -1), // forward
    new Vector3(0, 0, 1), // back
    new Vector3(-1, 0, 0), // left
    new Vector3(1, 0, 0), // right
    new Vector3(0, 1, 0), // up
    new Vector3(0, -1, -1).normalize(), // down-forward
  ];
  private hadSurface = false;

  /** Forget the smoothing history. Call after the car is moved somewhere else, so the first reading is used as it is. */
  forget(): void {
    this.hadSurface = false;
  }

  /** True when the car is close enough to a surface to count as attached. */
  get nearSurface(): boolean {
    return this.found && this.distance < SURFACE_RANGE;
  }

  update(world: RAPIER.World, car: CarBody, dt: number): void {
    this.found = false;
    this.distance = Infinity;

    // The main ray points along the car's down direction (-up).
    this.dir.copy(car.up).negate();
    this.cast(world, car, this.dir, 0);
    // A ray that lands exactly on the seam between two triangles can slip through and come out of the
    // underside of the road, reading a whole slab thickness too far. The centre line of the road is a seam,
    // so a car driving down it meets this. Two more rays a hair to each side catch it: a leaked ray always
    // reads farther, so the closest hit of the three is the road.
    this.cast(world, car, this.dir, RETRY_OFFSET);
    this.cast(world, car, this.dir, -RETRY_OFFSET);
    if (!this.found) {
      for (const local of this.fan) {
        this.dir.copy(local).applyQuaternion(car.quaternion);
        this.cast(world, car, this.dir);
      }
    }

    if (this.found) {
      if (this.hadSurface) {
        this.smoothNormal.lerp(this.normal, smoothFactor(NORMAL_SMOOTH_RATE, dt)).normalize();
      } else {
        this.smoothNormal.copy(this.normal); // first contact: no history to smooth against
      }
    }
    this.hadSurface = this.found;
  }

  /** One long ray along the car's down direction. Sets reachDistance (Infinity when nothing is within SLAM_RANGE). */
  probe(world: RAPIER.World, car: CarBody): void {
    this.dir.copy(car.up).negate();
    this.ray.origin.x = car.position.x;
    this.ray.origin.y = car.position.y;
    this.ray.origin.z = car.position.z;
    this.ray.dir.x = this.dir.x;
    this.ray.dir.y = this.dir.y;
    this.ray.dir.z = this.dir.z;
    const hit = world.castRayAndGetNormal(
      this.ray,
      SLAM_RANGE,
      true,
      undefined,
      undefined,
      car.collider,
    );
    if (hit) {
      this.reachDistance = hit.timeOfImpact;
      this.reachNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    } else {
      this.reachDistance = Infinity;
    }
  }

  /** Casts along `dir` and keeps the hit if it is the closest so far. */
  private cast(world: RAPIER.World, car: CarBody, dir: Vector3, shift = 0): void {
    // shift moves the ray start sideways, along the car's right
    this.ray.origin.x = car.position.x + car.right.x * shift;
    this.ray.origin.y = car.position.y + car.right.y * shift;
    this.ray.origin.z = car.position.z + car.right.z * shift;
    this.ray.dir.x = dir.x;
    this.ray.dir.y = dir.y;
    this.ray.dir.z = dir.z;
    const hit = world.castRayAndGetNormal(
      this.ray,
      SENSE_RANGE,
      true,
      undefined,
      undefined,
      car.collider,
    );
    if (hit && hit.timeOfImpact < this.distance) {
      this.found = true;
      this.distance = hit.timeOfImpact;
      this.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    }
  }
}
