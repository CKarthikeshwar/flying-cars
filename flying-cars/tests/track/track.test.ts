import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Track, bankingAt } from '../../src/track/Track';
import { Pen } from '../../src/track/builders';
import { singleLoopTrackDef, testTrackDef } from '../../src/track/tracks/testTrack';
import { TRACK_SAMPLE_SPACING, TRACK_STRIPS, TRACK_WIDTH } from '../../src/util/constants';

const track = new Track(testTrackDef());

describe('track frames', () => {
  it('has about one sample per metre', () => {
    expect(track.count).toBeGreaterThan(track.length / (TRACK_SAMPLE_SPACING * 1.05));
    expect(track.count).toBeLessThan(track.length / (TRACK_SAMPLE_SPACING * 0.95));
  });

  it('has an up vector perpendicular to the tangent, and a unit binormal, at every sample (1e-6)', () => {
    for (const f of track.frames) {
      expect(Math.abs(f.up.dot(f.tangent))).toBeLessThan(1e-6);
      expect(Math.abs(f.up.length() - 1)).toBeLessThan(1e-6);
      expect(Math.abs(f.tangent.length() - 1)).toBeLessThan(1e-6);
      expect(Math.abs(f.binormal.length() - 1)).toBeLessThan(1e-6);
      expect(Math.abs(f.binormal.dot(f.tangent))).toBeLessThan(1e-6);
      expect(Math.abs(f.binormal.dot(f.up))).toBeLessThan(1e-6);
    }
  });

  it('is a right-handed frame: B = T x U', () => {
    for (const f of track.frames) {
      const b = new Vector3().crossVectors(f.tangent, f.up);
      expect(b.distanceTo(f.binormal)).toBeLessThan(1e-6);
    }
  });

  it('closes smoothly: the road does not jump or twist at the finish line', () => {
    const n = track.count;
    for (let i = 0; i < n; i++) {
      const a = track.frames[i];
      const b = track.frames[(i + 1) % n];
      if (!a || !b) throw new Error('missing frame');
      expect(a.position.distanceTo(b.position)).toBeLessThan(1.3);
      expect(Math.acos(Math.min(1, a.up.dot(b.up)))).toBeLessThan(0.1); // under 5.7 degrees per metre
      expect(Math.acos(Math.min(1, a.tangent.dot(b.tangent)))).toBeLessThan(0.1);
    }
  });

  it('keeps every flat, unbanked stretch free of roll (upright, or upside down at the top of a loop), even after a loop', () => {
    const keys = testTrackDef().banking;
    let checked = 0;
    for (const f of track.frames) {
      if (Math.abs(f.tangent.y) < 0.4 && bankingAt(keys, f.s, track.length) === 0) {
        expect(Math.abs(f.binormal.y)).toBeLessThan(1e-6); // no roll: the sideways direction is horizontal
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it('only has to spread a modest twist, and only inside the loops', () => {
    expect(track.closingTwist).toBeGreaterThan(0.1); // each loop does leave a twist behind
    expect(track.closingTwist).toBeLessThan(0.7);
  });

  it('spreads a large closing twist along the track instead of leaving a jump at the finish', () => {
    const twisted = new Track(singleLoopTrackDef());
    expect(Math.abs(twisted.closingTwist)).toBeGreaterThan(0.3); // a shift of 18 m on a 28 m loop leaves about 0.64
    const n = twisted.count;
    for (let i = 0; i < n; i++) {
      const a = twisted.frames[i];
      const b = twisted.frames[(i + 1) % n];
      if (!a || !b) throw new Error('missing frame');
      expect(Math.acos(Math.min(1, a.up.dot(b.up)))).toBeLessThan(0.08);
      expect(Math.abs(a.up.dot(a.tangent))).toBeLessThan(1e-6);
      expect(Math.abs(a.binormal.length() - 1)).toBeLessThan(1e-6);
    }
  });

  it('is flat on the straight, 90 degrees on the wall and upside down on the ceiling', () => {
    const at = (s: number) => track.frames[Math.round(s / (track.length / track.count))];
    expect(at(10)?.up.y).toBeGreaterThan(0.999);
    expect(Math.abs(at(130)?.up.y ?? 1)).toBeLessThan(0.02); // wall: up is horizontal
    const ceiling = track.frames.filter((f) => f.up.y < -0.999);
    expect(ceiling.length).toBeGreaterThan(40); // at least 40 m of ceiling
  });

  it('never runs through itself (separate parts stay more than a road width apart)', () => {
    const n = track.count;
    const ds = track.length / n;
    let closest = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const along = Math.min(j - i, n - (j - i)) * ds;
        if (along < 45) continue; // neighbours on the same stretch of road
        const a = track.frames[i];
        const b = track.frames[j];
        if (!a || !b) continue;
        closest = Math.min(closest, a.position.distanceTo(b.position));
      }
    }
    expect(closest).toBeGreaterThan(TRACK_WIDTH + 1);
  });
});

describe('banking', () => {
  const keys = [
    { s: 10, deg: 0 },
    { s: 20, deg: 90 },
    { s: 30, deg: 90 },
    { s: 40, deg: 0 },
  ];

  it('eases between keys and holds between equal keys', () => {
    expect(bankingAt(keys, 10, 100)).toBeCloseTo(0);
    expect(bankingAt(keys, 15, 100)).toBeCloseTo(Math.PI / 4);
    expect(bankingAt(keys, 25, 100)).toBeCloseTo(Math.PI / 2);
    expect(bankingAt(keys, 40, 100)).toBeCloseTo(0);
  });

  it('is flat before the first key and after the last, and wraps', () => {
    expect(bankingAt(keys, 5, 100)).toBeCloseTo(0);
    expect(bankingAt(keys, 70, 100)).toBeCloseTo(0);
    expect(bankingAt(keys, 125, 100)).toBeCloseTo(bankingAt(keys, 25, 100));
  });
});

describe('Pen', () => {
  it('refuses to close a track that does not come back to its start', () => {
    const pen = new Pen();
    pen.straight(100).turn(180, 30, 'left').straight(90);
    expect(() => pen.close()).toThrow(/does not close/);
  });

  it('closes a simple stadium', () => {
    const pen = new Pen();
    pen.straight(100).turn(180, 30, 'left').straight(100).turn(180, 30, 'left');
    expect(pen.close().length).toBeGreaterThan(20);
  });
});

describe('collider mesh', () => {
  const mesh = track.colliderData();

  const perSample = TRACK_STRIPS + 3;
  const trianglesPerSample = 2 * TRACK_STRIPS + 6; // the top in strips, the bottom, and two sides

  it('is a closed slab with every index valid', () => {
    expect(mesh.vertices.length).toBe(track.count * perSample * 3);
    expect(mesh.indices.length).toBe(track.count * trianglesPerSample * 3);
    for (const i of mesh.indices) expect(i).toBeLessThan(track.count * perSample);
  });

  it('has top facets near the centre line that follow the road even where it rolls steeply (within 8 degrees)', () => {
    const v = mesh.vertices;
    const pt = (i: number) => new Vector3(v[i * 3] ?? 0, v[i * 3 + 1] ?? 0, v[i * 3 + 2] ?? 0);
    let worst = 0;
    for (let i = 0; i < track.count; i++) {
      const f = track.frames[i];
      if (!f) continue;
      // Away from the centre a twisting road's true normal tilts by atan(distance x roll rate), so only the
      // strips either side of the centre line are held to the road's up vector.
      for (const k of [TRACK_STRIPS / 2 - 1, TRACK_STRIPS / 2]) {
        const t = (i * trianglesPerSample + k * 2) * 3; // the two top triangles of this strip
        for (const tri of [t, t + 3]) {
          const a = pt(mesh.indices[tri] ?? 0);
          const b = pt(mesh.indices[tri + 1] ?? 0);
          const c = pt(mesh.indices[tri + 2] ?? 0);
          const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
          worst = Math.max(worst, Math.acos(Math.min(1, n.dot(f.up))));
        }
      }
    }
    expect(worst).toBeLessThan((8 * Math.PI) / 180);
  });

  it('has every triangle facing outward, so ray casts read the right normal', () => {
    const v = mesh.vertices;
    const pt = (i: number) => new Vector3(v[i * 3] ?? 0, v[i * 3 + 1] ?? 0, v[i * 3 + 2] ?? 0);
    // Per sample the triangles are: the top strips (2 each), the bottom (2), the left side (2), the right side (2).
    const kinds = [
      ...Array.from({ length: 2 * TRACK_STRIPS }, () => 'top'),
      'bottom',
      'bottom',
      'left',
      'left',
      'right',
      'right',
    ];
    for (let i = 0; i < track.count; i++) {
      const f = track.frames[i];
      if (!f) throw new Error('missing frame');
      kinds.forEach((kind, k) => {
        const t = (i * trianglesPerSample + k) * 3;
        const a = pt(mesh.indices[t] ?? 0);
        const b = pt(mesh.indices[t + 1] ?? 0);
        const c = pt(mesh.indices[t + 2] ?? 0);
        const n = b.clone().sub(a).cross(c.clone().sub(a));
        expect(n.length()).toBeGreaterThan(1e-6); // no degenerate triangles
        n.normalize();
        // Faces on a twisting road tilt by up to atan(half width x roll rate), well under 60 degrees.
        if (kind === 'top') expect(n.dot(f.up)).toBeGreaterThan(0.5);
        if (kind === 'bottom') expect(n.dot(f.up)).toBeLessThan(-0.5);
        if (kind === 'left') expect(n.dot(f.binormal)).toBeLessThan(-0.5);
        if (kind === 'right') expect(n.dot(f.binormal)).toBeGreaterThan(0.5);
      });
    }
  });

  it('is at least 0.5 m thick everywhere', () => {
    const v = mesh.vertices;
    for (let i = 0; i < track.count; i++) {
      const at = (k: number) =>
        new Vector3(
          v[(i * perSample + k) * 3] ?? 0,
          v[(i * perSample + k) * 3 + 1] ?? 0,
          v[(i * perSample + k) * 3 + 2] ?? 0,
        );
      const top = at(0); // top left
      const bottom = at(TRACK_STRIPS + 1); // bottom left
      expect(top.distanceTo(bottom)).toBeGreaterThanOrEqual(0.5);
    }
  });
});
