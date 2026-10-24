import type { Pen } from '../builders';
import type { BankKey, ChargeDef, GapDef } from '../Track';
import type { RingDef } from '../hazards';
import { gapArc } from './hazardKit';

/** What a track definition collects as it is laid out piece by piece. */
export interface Layout {
  pen: Pen;
  banking: BankKey[];
  gaps: GapDef[];
  rings: RingDef[];
  charges: ChargeDef[];
}

/** How high a sky island hangs above the road it is reached from (it must top the apex of a high hop, 7.4 m, by a little). Only a high hop gets there (a plain hop tops out about 4.5 m). */
export const SKY_RISE = 8;
/** Length of the open air between islands. */
export const GAP_LENGTH = 45;

/** Rings are put at an exact height in the world when the road under them is rolling, where "above the road" means nothing. */
function worldRing(at: number, y: number): RingDef {
  return { at, w: 0, h: y, world: true };
}

/**
 * A gap in the road, level on both sides: a plain hop crosses it. Three rings mark the path of the hop,
 * taken 8 m before the edge. The pen goes straight through the gap, so the next island lines up with this one.
 */
export function flatGap(layout: Layout, length = GAP_LENGTH): void {
  const from = layout.pen.length;
  layout.gaps.push({ from, to: from + length, ledge: 'none' });
  layout.rings.push(...gapArc(from));
  layout.pen.straight(length);
}

/**
 * A gap up to an island that hangs upside down, 8 m higher: the road rolls over while it is missing.
 * Hop high (hold S), roll over in the air, and stick to the underside. Two rings mark the path.
 */
export function skyUp(layout: Layout, length = GAP_LENGTH, rise = SKY_RISE): void {
  const { pen } = layout;
  const from = pen.length;
  const base = pen.here().y;
  layout.banking.push({ s: from, deg: 0 }, { s: from + length, deg: 180 });
  layout.gaps.push({ from, to: from + length, ledge: 'none' });
  layout.rings.push(worldRing(from + 19, base + 5.2), worldRing(from + 38, base + rise - 0.5));
  pen.straight(length, rise);
}

/**
 * A gap down from an upside-down island to an upright one, 8 m lower: drive off the end, roll back over,
 * and land. Three rings mark the fall.
 */
export function skyDown(layout: Layout, length = GAP_LENGTH, drop = SKY_RISE): void {
  const { pen } = layout;
  const from = pen.length;
  const top = pen.here().y - 0.5; // where the car hangs, a little below the road it is stuck to
  // a charge strip on the underside, so the air for the landing is there
  layout.charges.push({ from: from - 80, to: from - 45, left: -4, right: 4 });
  layout.banking.push({ s: from, deg: 180 }, { s: from + length, deg: 0 });
  layout.gaps.push({ from, to: from + length, ledge: 'none' });
  layout.rings.push(
    worldRing(from + 15, top - 0.4),
    worldRing(from + 33, top - 2.0),
    worldRing(from + 50, Math.max(top - 4.8, top - drop + 1.5)),
  );
  pen.straight(length, -drop);
}
