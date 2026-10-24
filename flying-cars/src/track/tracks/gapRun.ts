import { Pen } from '../builders';
import type { ChargeDef, GapDef, TrackDef } from '../Track';
import type { BarrierDef, RingDef, SlotDef } from '../hazards';
import { hurdle, slot } from './hazardKit';
import { flatGap, skyDown, skyUp, type Layout } from './islands';

/**
 * Gap Run: a chain of three islands on the first straight, each gap a little wider, then a banked wall turn,
 * a loop and a ceiling, and a sky island on the last straight. Every gap has a charge strip before it, so you
 * arrive with air to spare. About 2500 m round.
 */
export function gapRunDef(): TrackDef {
  const pen = new Pen();
  const layout: Layout = {
    pen,
    banking: [],
    gaps: [] as GapDef[],
    rings: [] as RingDef[],
    charges: [] as ChargeDef[],
  };
  const { banking, charges } = layout;

  // ---- First straight: three gaps, each with a charge strip before it and a long island after ----
  pen.straight(170);
  charges.push({ from: 170, to: 205, left: -4, right: 4 });
  pen.straight(50);
  flatGap(layout, 40);
  pen.straight(110);
  charges.push({ from: pen.length, to: pen.length + 35, left: -4, right: 4 });
  pen.straight(50);
  flatGap(layout, 45);
  pen.straight(110);
  charges.push({ from: pen.length, to: pen.length + 35, left: -4, right: 4 });
  pen.straight(50);
  flatGap(layout, 50);
  pen.straight(130);

  // ---- The first turn is a wall: banked to 90 degrees ----
  const turn = pen.length;
  banking.push(
    { s: turn, deg: 0 },
    { s: turn + 70, deg: 90 },
    { s: turn + 165, deg: 90 },
    { s: turn + 245, deg: 0 },
  );
  pen.turn(180, 90, 'left');

  // ---- Second straight: a loop, then a ceiling, then a sky island ----
  pen.straight(60);
  pen.loop(30, 22, 'left');
  const ceiling = pen.length;
  banking.push(
    { s: ceiling + 20, deg: 0 },
    { s: ceiling + 130, deg: 180 },
    { s: ceiling + 190, deg: 180 },
    { s: ceiling + 300, deg: 0 },
  );
  pen.straight(310);
  charges.push({ from: pen.length, to: pen.length + 35, left: -4, right: 4 });
  pen.straight(85);
  skyUp(layout);
  pen.straight(130);
  skyDown(layout);
  pen.closeStadium();

  const barriers: BarrierDef[] = [hurdle(80)];
  const slots: SlotDef[] = [slot(1650, -3)];

  return {
    name: 'Gap Run',
    points: pen.close(),
    banking,
    start: 40,
    gaps: layout.gaps,
    charges,
    rings: layout.rings,
    barriers,
    slots,
  };
}
