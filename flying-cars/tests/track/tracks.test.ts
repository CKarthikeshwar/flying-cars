import { describe, expect, it } from 'vitest';
import { Pen } from '../../src/track/builders';
import { Track } from '../../src/track/Track';
import { TRACK_LIST, createTrack, trackNames } from '../../src/track/tracks';
import { TRACK_LEDGE_STRIPS, TRACK_STRIPS, TRACK_WIDTH } from '../../src/util/constants';

const built = TRACK_LIST.map((info) => ({ info, track: createTrack(info.id) as Track }));

describe('the track list', () => {
  it('has three tracks, easiest first, and the hidden test track opens by name', () => {
    expect(TRACK_LIST.map((t) => t.name)).toEqual(['Warm-up', 'Spiral Tower', 'Gap Run']);
    expect(trackNames()).toContain('test');
    expect(createTrack('nonsense')).toBeNull();
  });

  it('gives every track a name that matches its list entry', () => {
    for (const { info, track } of built) expect(track.name).toBe(info.name);
  });
});

describe.each(built)('$info.name', ({ info, track }) => {
  it('closes into a lap of a sensible length with a gate every 100 m or so', () => {
    expect(track.length).toBeGreaterThan(1500);
    expect(track.length).toBeLessThan(2800);
    // a gate is left out where there is no safe spot for one (inside a loop), so there can be a few fewer
    expect(track.gates.length).toBeLessThanOrEqual(Math.round(track.length / 100));
    expect(track.gates.length).toBeGreaterThan(Math.round(track.length / 100) * 0.7);
  });

  it('has a clean road frame at every sample, and no sudden turns or twists', () => {
    const n = track.count;
    for (let i = 0; i < n; i++) {
      const f = track.frames[i];
      const g = track.frames[(i + 1) % n];
      if (!f || !g) throw new Error('missing frame');
      expect(Math.abs(f.up.dot(f.tangent))).toBeLessThan(1e-6);
      expect(Math.abs(f.binormal.length() - 1)).toBeLessThan(1e-6);
      expect(f.position.distanceTo(g.position)).toBeLessThan(1.3);
      // (the road rolls over inside an island gap, where there is no road to ride, a little faster than anywhere else)
      expect(Math.acos(Math.min(1, f.up.dot(g.up)))).toBeLessThan(track.gapAt(i) ? 0.12 : 0.1);
      expect(Math.acos(Math.min(1, f.tangent.dot(g.tangent)))).toBeLessThan(0.1);
    }
  });

  it('never runs through itself: parts far apart along the road stay clear in space', () => {
    const n = track.count;
    let closest = Infinity;
    for (let i = 0; i < n; i += 2) {
      for (let j = i + 1; j < n; j += 2) {
        if (Math.min(j - i, n - (j - i)) * track.spacing < 60) continue;
        const a = track.frames[i];
        const b = track.frames[j];
        if (!a || !b) continue;
        closest = Math.min(closest, a.position.distanceTo(b.position));
      }
    }
    expect(closest).toBeGreaterThan(TRACK_WIDTH + 2);
  });

  it('has a wall section, a ceiling section and a gap that rewards a hop', () => {
    const wall = track.frames.filter((f) => Math.abs(f.up.y) < 0.1 && Math.abs(f.tangent.y) < 0.4);
    const ceiling = track.frames.filter((f) => f.up.y < -0.99);
    expect(wall.length).toBeGreaterThan(30); // at least 30 m of road standing on its side
    expect(ceiling.length).toBeGreaterThan(30); // at least 30 m of ceiling
    expect(track.gaps.length).toBeGreaterThanOrEqual(1);
    expect(track.hopMarkers.length).toBeGreaterThanOrEqual(track.gaps.length);
    expect(info.features).toContain('gap');
  });

  it('has charge strips, each placed before a gap so the air is there when it is needed', () => {
    expect(track.charges.length).toBeGreaterThanOrEqual(1);
    for (const gap of track.gaps) {
      const before = track.charges.some((c) => {
        const distance = (gap.first - c.last + track.count) % track.count;
        return distance > 0 && distance < 120 / track.spacing;
      });
      expect(before, `a charge strip within 120 m before the gap at ${gap.first}`).toBe(true);
    }
  });

  it('starts on a straight, flat stretch, with the start line 40 m in', () => {
    expect(track.lapDistance(track.startIndex)).toBe(0);
    const start = track.frames[track.startIndex];
    expect(start?.up.y).toBeGreaterThan(0.99);
    expect(Math.abs(start?.tangent.y ?? 1)).toBeLessThan(0.05);
    // the grid behind the line (up to 20 m back) must be flat road, not a gap or a wall
    for (let back = 0; back <= 25; back++) {
      const f = track.frames[(track.startIndex - back + track.count) % track.count];
      expect(f?.up.y).toBeGreaterThan(0.99);
      expect(track.gapAt(track.startIndex - back)).toBeNull();
    }
  });

  it('is level at the finish line, with no roll', () => {
    const start = track.frames[track.startIndex];
    expect(start && Math.abs(start.binormal.y)).toBeLessThan(0.01);
  });
});

describe('gaps', () => {
  const { track } = built[2] as (typeof built)[number]; // Gap Run: three gaps in a row
  const gap = track.gaps[0];
  if (!gap) throw new Error('no gap');
  const mid = Math.round((gap.first + gap.last) / 2);

  it('leaves nothing at all inside an island gap', () => {
    expect(gap.ledge).toBe('none');
    expect(track.stripRange(mid)).toEqual([0, 0]);
    const hw = track.width / 2;
    for (const w of [-hw + 1, 0, hw - 1]) expect(track.roadAt(mid, w)).toBe(false);
    expect(track.roadAt(track.startIndex, 0)).toBe(true);
    expect(track.ledgeCentre(mid)).toBeNull();
  });

  /** Triangles whose corners are all on the two samples. */
  const trianglesBetween = (a: number, b: number, topOnly: boolean): number => {
    const mesh = track.colliderData();
    const perSample = TRACK_STRIPS + 3;
    let count = 0;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const verts = [mesh.indices[t] ?? 0, mesh.indices[t + 1] ?? 0, mesh.indices[t + 2] ?? 0];
      const ok = verts.every((v) => {
        const s = Math.floor(v / perSample);
        return (s === a || s === b) && (!topOnly || v % perSample <= TRACK_STRIPS);
      });
      if (ok) count++;
    }
    return count;
  };

  it('makes the collision mesh a hole: no triangles across the gap, a whole road elsewhere', () => {
    expect(trianglesBetween(mid, mid + 1, false)).toBe(0);
    expect(trianglesBetween(track.startIndex, track.startIndex + 1, true)).toBe(2 * TRACK_STRIPS);
  });

  it('leaves the end of each island open: no face across the road for a car to run into', () => {
    expect(trianglesBetween(gap.first - 1, gap.first, false)).toBe(0);
    expect(trianglesBetween(gap.last, gap.last + 1, false)).toBe(0);
    // and the slab thins to a knife edge there, so there is no wall at all
    const full = track.colliderData();
    const perSample = TRACK_STRIPS + 3;
    const depth = (sample: number): number => {
      const top = sample * perSample;
      const bottom = top + TRACK_STRIPS + 1;
      const v = full.vertices;
      return Math.hypot(
        (v[top * 3] ?? 0) - (v[bottom * 3] ?? 0),
        (v[top * 3 + 1] ?? 0) - (v[bottom * 3 + 1] ?? 0),
        (v[top * 3 + 2] ?? 0) - (v[bottom * 3 + 2] ?? 0),
      );
    };
    expect(depth(gap.first - 1)).toBeLessThan(0.45);
    expect(depth(gap.first - 12)).toBeGreaterThan(0.95);
  });

  it('keeps each gap between 40 and 50 m: a hop crosses it at racing speed', () => {
    for (const { track: t } of built) {
      for (const g of t.gaps) {
        const length = ((g.last - g.first + t.count) % t.count) * t.spacing;
        expect(length).toBeGreaterThanOrEqual(39);
        expect(length).toBeLessThanOrEqual(51);
      }
    }
  });

  it('puts a hop marker a little before each gap', () => {
    for (const { track: t } of built) {
      for (const g of t.gaps) {
        const gapStart = t.lapDistance(g.first);
        const marker = t.hopMarkers.find((m) => Math.abs(m - (gapStart - 8)) < 2);
        expect(marker, `a marker 8 m before the gap at ${g.first}`).toBeDefined();
      }
    }
  });

  it('has an upside-down island and a way back down on every track', () => {
    for (const { track: t } of built) {
      const flipped = t.gaps.filter((g) => (t.frames[g.last + 4]?.up.y ?? 1) < -0.99);
      expect(flipped.length, `${t.name}: gaps that land upside down`).toBeGreaterThanOrEqual(1);
      const back = t.gaps.filter(
        (g) =>
          (t.frames[g.first - 4]?.up.y ?? 1) < -0.99 && (t.frames[g.last + 4]?.up.y ?? -1) > 0.99,
      );
      expect(
        back.length,
        `${t.name}: gaps that land upright from upside down`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('ledge gaps (still supported by the track code)', () => {
  const pen = new Pen();
  pen.straight(220);
  pen.turn(180, 60, 'left');
  pen.straight(100);
  pen.closeStadium();
  const track = new Track({
    name: 'Ledge',
    points: pen.close(),
    banking: [],
    gaps: [{ from: 100, to: 130, ledge: 'right' }],
  });
  const mid = Math.round(115 / track.spacing);

  it('leaves only a ledge inside the hole, on the side the track data says', () => {
    const [lo, hi] = track.stripRange(mid);
    expect(hi).toBe(TRACK_STRIPS);
    expect(hi - lo).toBe(TRACK_LEDGE_STRIPS);
    expect(track.roadAt(mid, 0)).toBe(false);
    expect(track.roadAt(mid, track.width / 2 - 1)).toBe(true);
    expect(track.ledgeCentre(mid)).toBeCloseTo(
      track.width / 2 - (TRACK_LEDGE_STRIPS * track.width) / TRACK_STRIPS / 2,
    );
  });
});

describe('charge strips', () => {
  const { track } = built[0] as (typeof built)[number];
  const strip = track.charges[0];
  if (!strip) throw new Error('no charge strip');
  const mid = Math.round((strip.first + strip.last) / 2);

  it('covers the stretch and width the track data says, and nothing else', () => {
    expect(track.chargeAt(mid, 0)).toBe(true);
    expect(track.chargeAt(mid, strip.left)).toBe(true);
    expect(track.chargeAt(mid, strip.right + 0.5)).toBe(false); // beside it
    expect(track.chargeAt(strip.first - 3, 0)).toBe(false); // before it
    expect(track.chargeAt(strip.last + 3, 0)).toBe(false); // after it
  });
});

describe('Pen climbing', () => {
  it('eases into a climb and out of it, so the slope starts and ends at zero', () => {
    const { track } = built[1] as (typeof built)[number]; // Spiral Tower
    let top = -Infinity;
    for (const f of track.frames) top = Math.max(top, f.position.y);
    expect(top).toBeGreaterThan(44);
    expect(top).toBeLessThan(46);
    // flat at the start line, so a car can start there
    const start = track.frames[track.startIndex];
    expect(start && Math.abs(start.tangent.y)).toBeLessThan(0.02);
    // never steeper than 15 percent
    for (let i = 0; i < track.count; i++) {
      if (track.gapAt(i)) continue; // (the islands step up and down inside their gaps)
      expect(Math.abs(track.frames[i]?.tangent.y ?? 1)).toBeLessThan(0.16);
    }
  });
});
