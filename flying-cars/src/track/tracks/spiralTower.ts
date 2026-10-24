import { Pen } from '../builders';
import type { ChargeDef, GapDef, TrackDef } from '../Track';
import type { BarrierDef, RingDef, SlotDef } from '../hazards';
import { hurdle, slot } from './hazardKit';
import { flatGap, skyDown, skyUp, type Layout } from './islands';

/**
 * Spiral Tower: a flat run with a gap and a sky island, then a climbing spiral (one and a half turns, up 45 m)
 * with a ceiling near the top, a long fast descent with a wall and a last gap, and a flat turn back to the start.
 * About 2300 m round.
 */
export function spiralTowerDef(): TrackDef {
  const pen = new Pen();
  const layout: Layout = {
    pen,
    banking: [],
    gaps: [] as GapDef[],
    rings: [] as RingDef[],
    charges: [] as ChargeDef[],
  };
  const { banking, charges } = layout;

  // ---- First straight: start line at 40 m, a gap, a sky island, then a run to the spiral ----
  pen.straight(150);
  charges.push({ from: pen.length, to: pen.length + 40, left: -4, right: 4 });
  pen.straight(90);
  flatGap(layout, 45);
  pen.straight(120);
  charges.push({ from: pen.length, to: pen.length + 35, left: -4, right: 4 });
  pen.straight(50);
  skyUp(layout);
  pen.straight(130);
  skyDown(layout);
  pen.straight(130);

  // ---- The spiral: three half turns going up, with a ceiling in the last half turn ----
  pen.turn(540, 75, 'left', 45);
  const spiralEnd = pen.length;
  banking.push(
    { s: spiralEnd - 260, deg: 0 },
    { s: spiralEnd - 170, deg: 180 },
    { s: spiralEnd - 110, deg: 180 },
    { s: spiralEnd - 20, deg: 0 },
  );

  // ---- The descent: a wall, a charge strip and a last gap, all on the way down ----
  const descent = pen.length;
  banking.push(
    { s: descent + 20, deg: 0 },
    { s: descent + 120, deg: 90 },
    { s: descent + 190, deg: 90 },
    { s: descent + 290, deg: 0 },
  );
  charges.push({ from: descent + 330, to: descent + 370, left: -4, right: 4 });
  pen.straight(400, -45 * (400 / 540));
  layout.gaps.push({ from: pen.length, to: pen.length + 40, ledge: 'none' });
  pen.straight(40, -45 * (40 / 540));
  pen.straight(100, -45 * (100 / 540));
  pen.closeStadium();

  const barriers: BarrierDef[] = [hurdle(70)];
  const slots: SlotDef[] = [slot(400, 3)];

  return {
    name: 'Spiral Tower',
    points: pen.close(),
    banking: banking.sort((a, b) => a.s - b.s),
    start: 40,
    gaps: layout.gaps,
    charges,
    rings: layout.rings,
    barriers,
    slots,
  };
}
