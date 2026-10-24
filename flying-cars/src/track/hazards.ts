import { Vector3 } from 'three';
import {
  BARRIER_CAR_HALF_HEIGHT,
  BARRIER_CAR_HALF_WIDTH,
  BARRIER_HURDLE_HEIGHT,
  BARRIER_WALL_HEIGHT,
  RING_RADIUS,
} from '../util/constants';
import type { TrackFrame } from './Track';

/** A ring to fly through, placed by distance along the track and where it hangs over the road. */
export interface RingDef {
  /** Distance along the track from the first control point. */
  at: number;
  /** Metres to the right of the centre line. */
  w: number;
  /** Metres above the road, along its up. With `world`, the height in the world instead (where the road is rolling). */
  h: number;
  world?: boolean;
}

/** A barrier across part of the road: low enough to hop (a hurdle) or a tall wall (see SlotDef). */
export interface BarrierDef {
  at: number;
  /** The blocked part of the road, in metres to the right of the centre line. */
  left: number;
  right: number;
  /** Metres above the road. */
  height: number;
}

/** A slot wall: full width and tall, except for an opening. */
export interface SlotDef {
  at: number;
  /** Centre of the opening, metres to the right of the centre line. */
  centre: number;
  /** Width of the opening. */
  width: number;
}

export interface Ring {
  index: number;
  w: number;
  h: number;
  /** Centre of the ring in the world. */
  position: Vector3;
  /** Which way the ring faces: along the road. */
  normal: Vector3;
}

export interface Barrier {
  index: number;
  left: number;
  right: number;
  height: number;
  /** For one side of a slot wall: where the opening is, so the AI can line up with it. */
  slot: { centre: number; width: number } | null;
}

/** Turns a ring definition into world space on a road frame. */
export function makeRing(frame: TrackFrame, index: number, def: RingDef): Ring {
  const position = frame.position.clone().addScaledVector(frame.binormal, def.w);
  if (def.world) position.y = def.h;
  else position.addScaledVector(frame.up, def.h);
  return { index, w: def.w, h: def.h, position, normal: frame.tangent.clone() };
}

/** The walls of a slot wall, either side of the opening. The road is `roadWidth` wide. */
export function slotBarriers(def: SlotDef, index: number, roadWidth: number): Barrier[] {
  const half = roadWidth / 2;
  const open = { centre: def.centre, width: def.width };
  const lo = def.centre - def.width / 2;
  const hi = def.centre + def.width / 2;
  const out: Barrier[] = [];
  // the walls reach past the road edge so there is no way round them
  if (lo > -half)
    out.push({ index, left: -half - 2, right: lo, height: BARRIER_WALL_HEIGHT, slot: open });
  if (hi < half)
    out.push({ index, left: hi, right: half + 2, height: BARRIER_WALL_HEIGHT, slot: open });
  return out;
}

/** Whether a barrier is low enough to hop: the AI hops those. */
export function isHurdle(b: { height: number }): boolean {
  return b.height <= BARRIER_HURDLE_HEIGHT + 0.5;
}

/**
 * Whether a move from `prev` to `cur` flies through the ring, going along the road. Returns how far along the
 * move it happened (0 to 1), or null.
 */
export function ringPass(ring: Ring, prev: Vector3, cur: Vector3): number | null {
  const n = ring.normal;
  const p = ring.position;
  const before = (prev.x - p.x) * n.x + (prev.y - p.y) * n.y + (prev.z - p.z) * n.z;
  const after = (cur.x - p.x) * n.x + (cur.y - p.y) * n.y + (cur.z - p.z) * n.z;
  if (!(before < 0 && after >= 0)) return null;
  const t = before / (before - after);
  const x = prev.x + (cur.x - prev.x) * t - p.x;
  const y = prev.y + (cur.y - prev.y) * t - p.y;
  const z = prev.z + (cur.z - prev.z) * t - p.z;
  return Math.hypot(x, y, z) <= RING_RADIUS ? t : null;
}

/** Whether a move from `prev` to `cur` runs into the barrier standing on `frame`. */
export function barrierHit(
  barrier: Barrier,
  frame: TrackFrame,
  prev: Vector3,
  cur: Vector3,
): boolean {
  const t = frame.tangent;
  const p = frame.position;
  const before = (prev.x - p.x) * t.x + (prev.y - p.y) * t.y + (prev.z - p.z) * t.z;
  const after = (cur.x - p.x) * t.x + (cur.y - p.y) * t.y + (cur.z - p.z) * t.z;
  if (!(before < 0 && after >= 0)) return false;
  const k = before / (before - after);
  const x = prev.x + (cur.x - prev.x) * k - p.x;
  const y = prev.y + (cur.y - prev.y) * k - p.y;
  const z = prev.z + (cur.z - prev.z) * k - p.z;
  const across = x * frame.binormal.x + y * frame.binormal.y + z * frame.binormal.z;
  const height = x * frame.up.x + y * frame.up.y + z * frame.up.z;
  if (across + BARRIER_CAR_HALF_WIDTH <= barrier.left) return false;
  if (across - BARRIER_CAR_HALF_WIDTH >= barrier.right) return false;
  return height - BARRIER_CAR_HALF_HEIGHT < barrier.height && height > -2;
}
