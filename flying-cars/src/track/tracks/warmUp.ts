import { Pen } from '../builders';
import type { ChargeDef, GapDef, TrackDef } from '../Track';
import type { BarrierDef, RingDef, SlotDef } from '../hazards';
import { hurdle, slot } from './hazardKit';
import { flatGap, skyDown, skyUp, type Layout } from './islands';

/**
 * Warm-up: wide, gentle curves and long straights. One small gap to hop (the first island), one wall, one
 * ceiling, and at the end a sky island to learn the flip on: hop high, roll over, stick to the underside, then
 * drive off the end and roll back to land. About 2300 m round.
 */
export function warmUpDef(): TrackDef {
  const pen = new Pen();
  const layout: Layout = {
    pen,
    banking: [],
    gaps: [] as GapDef[],
    rings: [] as RingDef[],
    charges: [] as ChargeDef[],
  };
  const { banking, charges } = layout;

  // ---- First straight: run-up and start line (40 m), a charge strip, then the first gap and a long island ----
  pen.straight(150);
  charges.push({ from: 150, to: 190, left: -4, right: 4 });
  pen.straight(80);
  flatGap(layout, 40);
  pen.straight(330);
  pen.turn(40, 220, 'right');
  pen.turn(40, 220, 'left');
  pen.straight(170);

  // ---- The first turn: wide and flat ----
  pen.turn(180, 110, 'left');

  // ---- Second straight, back toward the start: the wall, then a short ceiling ----
  pen.straight(40);
  const wall = pen.length;
  banking.push(
    { s: wall, deg: 0 },
    { s: wall + 110, deg: 90 },
    { s: wall + 190, deg: 90 },
    { s: wall + 300, deg: 0 },
  );
  pen.straight(330);
  const ceiling = pen.length;
  banking.push(
    { s: ceiling, deg: 0 },
    { s: ceiling + 130, deg: 180 },
    { s: ceiling + 190, deg: 180 },
    { s: ceiling + 320, deg: 0 },
  );
  pen.straight(340);

  // ---- The sky island: a run-up, up and over, along the underside, and down ----
  pen.straight(30);
  charges.push({ from: pen.length, to: pen.length + 35, left: -4, right: 4 });
  pen.straight(40);
  skyUp(layout);
  pen.straight(130);
  skyDown(layout);
  pen.closeStadium();

  const barriers: BarrierDef[] = [hurdle(70)];
  const slots: SlotDef[] = [slot(450, -3)];

  return {
    name: 'Warm-up',
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
