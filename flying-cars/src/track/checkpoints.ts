import type { Vector3 } from 'three';
import { GATE_ABOVE, GATE_BELOW, GATE_MARGIN } from '../util/constants';
import type { TrackFrame } from './Track';

/**
 * A checkpoint gate: a plane across the road at a fixed place on the spline. A car passes it by crossing
 * the plane going forward while inside the gate's box (across the road plus a margin, and not too far
 * above or below it), so a shortcut that never goes through the gate does not count.
 */
export interface Gate {
  /** Position in the gate list. Gate 0 is the start and finish line. */
  number: number;
  /** Index of the track sample the gate sits on. */
  index: number;
  frame: TrackFrame;
}

/**
 * `count` gates spaced evenly (by sample) around the loop, the first on the start line.
 * A gate is where a car respawns, so it must be somewhere safe: not over a gap, not on a steep stretch.
 * If `isBlocked` says a spot is no good, the gate slides back along the road until it is. If it cannot find
 * a good spot without crowding the gate before it (the inside of a long loop, say), it is left out.
 */
export function buildGates(
  frames: TrackFrame[],
  startIndex: number,
  count: number,
  isBlocked: (index: number) => boolean = () => false,
): Gate[] {
  const n = frames.length;
  const gates: Gate[] = [];
  let previous = 0; // offset from the start line of the last gate placed
  for (let g = 0; g < count; g++) {
    let offset = Math.round((g * n) / count);
    if (g > 0) {
      while (offset > previous + 20 && isBlocked((startIndex + offset) % n)) offset--;
      if (offset <= previous + 20 || isBlocked((startIndex + offset) % n)) continue; // no safe place: leave it out
    }
    previous = offset;
    const index = (startIndex + offset) % n;
    gates.push({ number: gates.length, index, frame: frames[index] as TrackFrame });
  }
  return gates;
}

/**
 * Whether the move from `prev` to `cur` crosses the gate going forward inside its box.
 * Returns how far along the move the crossing happened (0 to 1), or null.
 */
export function gateCrossing(
  gate: Gate,
  prev: Vector3,
  cur: Vector3,
  roadWidth: number,
): number | null {
  const f = gate.frame;
  const before =
    (prev.x - f.position.x) * f.tangent.x +
    (prev.y - f.position.y) * f.tangent.y +
    (prev.z - f.position.z) * f.tangent.z;
  const after =
    (cur.x - f.position.x) * f.tangent.x +
    (cur.y - f.position.y) * f.tangent.y +
    (cur.z - f.position.z) * f.tangent.z;
  if (!(before < 0 && after >= 0)) return null;

  const t = before / (before - after);
  const x = prev.x + (cur.x - prev.x) * t - f.position.x;
  const y = prev.y + (cur.y - prev.y) * t - f.position.y;
  const z = prev.z + (cur.z - prev.z) * t - f.position.z;
  const across = x * f.binormal.x + y * f.binormal.y + z * f.binormal.z;
  const height = x * f.up.x + y * f.up.y + z * f.up.z; // along the road normal, positive on the car's side
  if (Math.abs(across) > roadWidth / 2 + GATE_MARGIN) return null;
  if (height > GATE_ABOVE || height < -GATE_BELOW) return null;
  return t;
}
