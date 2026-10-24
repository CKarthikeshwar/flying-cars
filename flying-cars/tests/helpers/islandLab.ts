import { Pen } from '../../src/track/builders';
import type { BankKey, GapDef, TrackDef } from '../../src/track/Track';

/** Sizes for the lab, so tests can talk about them. */
export interface LabOptions {
  gap: number;
  island: number;
  rise: number;
}

/**
 * A test track: three islands in a row. A flat island, a flat island after a gap, an upside-down island above
 * it after a second gap, and an upright one again after a third. Then a long flat road home.
 */
export function islandLabDef(o: Partial<LabOptions> = {}): TrackDef {
  const gap = o.gap ?? 45;
  const island = o.island ?? 120;
  const rise = o.rise ?? 5;
  const pen = new Pen();
  const banking: BankKey[] = [];
  const gaps: GapDef[] = [];

  pen.straight(150);
  gaps.push({ from: pen.length, to: pen.length + gap, ledge: 'none' });
  pen.straight(gap); // gap 1: flat
  pen.straight(island);

  const g2 = pen.length;
  gaps.push({ from: g2, to: g2 + gap, ledge: 'none' });
  banking.push({ s: g2, deg: 0 }, { s: g2 + gap, deg: 180 });
  pen.straight(gap, rise); // gap 2: up, and over onto the underside
  pen.straight(island);

  const g3 = pen.length;
  gaps.push({ from: g3, to: g3 + gap, ledge: 'none' });
  banking.push({ s: g3, deg: 180 }, { s: g3 + gap, deg: 0 });
  pen.straight(gap, -rise); // gap 3: down, and back over to the top
  pen.straight(island);

  pen.straight(100);
  pen.turn(180, 100, 'left');
  pen.straight(100);
  pen.closeStadium();

  return { name: 'Island Lab', points: pen.close(), banking, start: 40, gaps };
}
