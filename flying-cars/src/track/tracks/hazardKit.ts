import type { BarrierDef, RingDef, SlotDef } from '../hazards';
import { BARRIER_HURDLE_HEIGHT } from '../../util/constants';

/** Height of a ring only a high hop (hold S while hopping) or a glide can reach. */
const HIGH_RING = 8;
/** The road is 16 m wide; a hurdle spans all of it, with a margin past the edge lights. */
const HURDLE_EDGE = 9;

/**
 * Three rings along the arc of a hop taken 8 m before a gap, for any speed from 45 to 60 m/s: low, near the top
 * and low again. Hop on the marker and the rings fall on the path; hop late or early and you miss some.
 */
export function gapArc(from: number): RingDef[] {
  return [
    { at: from + 19, w: 0, h: 3.6 },
    { at: from + 42, w: 0, h: 4.0 },
    { at: from + 65, w: 0, h: 3.0 },
  ];
}

/** A ring high above the road: a plain hop falls short, a high hop or a glide reaches it. */
export function highRing(at: number, w = 0): RingDef {
  return { at, w, h: HIGH_RING };
}

/** A low barrier across the whole road. Hop it, or lose speed and 2 s. */
export function hurdle(at: number): BarrierDef {
  return { at, left: -HURDLE_EDGE, right: HURDLE_EDGE, height: BARRIER_HURDLE_HEIGHT };
}

/** A tall wall across the whole road with a 7 m opening: steer, or dash, through it. */
export function slot(at: number, centre: number, width = 7): SlotDef {
  return { at, centre, width };
}
