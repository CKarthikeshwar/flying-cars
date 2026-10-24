import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { TRACK_STRIPS } from '../util/constants';
import type { Track, TrackFrame } from '../track/Track';

const BODY = 0x0d141c;
const EDGE_LEFT = new Color(0x19e3ff); // cyan on the left, as in ART_DIRECTION.md
const EDGE_RIGHT = new Color(0xff7a1a); // orange on the right
const DASH = new Color(0x5c7284);
const RUNG = new Color(0x1c8da0);
const START_LINE = new Color(0xeaf1f5);
const CHARGE = new Color(0xb8ff3c); // lime: charge strips and the line to hop from
const CHARGE_DIM = new Color(0x4a6a14);
const LANDING = new Color(0x19e3ff);
const WARNING = new Color(0xff2e63); // red: the drop beside a ledge

const LIGHT_LIFT = 0.04; // m above the surface, to stay clear of the road
const EDGE_INSET = 0.15; // m from the road edge to the light strip
const EDGE_WIDTH = 0.4; // m
const DASH_WIDTH = 0.24; // m
const DASH_LENGTH = 3; // samples
const DASH_PERIOD = 8; // samples
const RUNG_PERIOD = 10; // samples
const RUNG_HALF_LENGTH = 0.08; // m

/** Collects coloured quads into one geometry, so all the road markings are a single draw call. */
class QuadBuilder {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, color: Color): void {
    const base = this.positions.length / 3;
    for (const p of [a, b, c, d]) {
      this.positions.push(p.x, p.y, p.z);
      this.colors.push(color.r, color.g, color.b);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    g.setIndex(this.indices);
    return g;
  }
}

/** The road for a track: a dark slab, with glowing edge lights, a dashed centre line and cross rungs on top. */
export function buildTrackMesh(track: Track): Group {
  const group = new Group();

  // The body: the same slab the physics uses, flat shaded.
  const slab = track.colliderData();
  const body = new BufferGeometry();
  body.setAttribute('position', new BufferAttribute(slab.vertices, 3));
  body.setIndex(new BufferAttribute(slab.indices, 1));
  const flat = body.toNonIndexed();
  flat.computeVertexNormals();
  const bodyMesh = new Mesh(
    flat,
    new MeshStandardMaterial({
      color: BODY,
      roughness: 0.6,
      metalness: 0.25,
      // push the body back a little so the markings on top never z-fight with it
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  group.add(bodyMesh);

  // Markings on top of the road, lifted slightly along the road normal.
  const q = new QuadBuilder();
  const n = track.count;
  const hw = track.width * 0.5;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const d = new Vector3();
  const at = (out: Vector3, f: TrackFrame, w: number): Vector3 =>
    out.copy(f.position).addScaledVector(f.binormal, w).addScaledVector(f.up, LIGHT_LIFT);
  const frame = (i: number): TrackFrame => track.frames[((i % n) + n) % n] as TrackFrame;

  const strips = TRACK_STRIPS;
  const stripWidth = track.width / strips;
  const quad = (f0: TrackFrame, f1: TrackFrame, w0: number, w1: number, color: Color): void => {
    q.quad(at(a, f0, w0), at(b, f0, w1), at(c, f1, w1), at(d, f1, w0), color);
  };

  for (let i = 0; i < n; i++) {
    const f0 = frame(i);
    const f1 = frame(i + 1);
    const [loI, hiI] = track.stripRange(i);
    const [loJ, hiJ] = track.stripRange(i + 1);

    // edge lights, left cyan and right orange, wherever the road reaches the edge
    if (loI === 0 && loJ === 0 && hiI > 0 && hiJ > 0) {
      quad(f0, f1, -hw + EDGE_INSET, -hw + EDGE_INSET + EDGE_WIDTH, EDGE_LEFT);
    }
    if (hiI === strips && hiJ === strips) {
      quad(f0, f1, hw - EDGE_INSET - EDGE_WIDTH, hw - EDGE_INSET, EDGE_RIGHT);
    }
    // inside a gap, a red line along the inner edge of the ledge warns of the drop
    if (track.gapAt(i) && track.gapAt(i + 1)) {
      if (hiI === loI) {
        // an island gap: nothing here to mark
      } else if (loI > 0) {
        const edge = -hw + loI * stripWidth;
        quad(f0, f1, edge + EDGE_INSET, edge + EDGE_INSET + EDGE_WIDTH, WARNING);
      } else if (hiI < strips) {
        const edge = -hw + hiI * stripWidth;
        quad(f0, f1, edge - EDGE_INSET - EDGE_WIDTH, edge - EDGE_INSET, WARNING);
      }
    }

    // dashed centre line, where there is road under it
    if (i % DASH_PERIOD < DASH_LENGTH && track.roadAt(i, 0) && track.roadAt(i + 1, 0)) {
      quad(f0, f1, -DASH_WIDTH / 2, DASH_WIDTH / 2, DASH);
    }

    // thin rungs across the road, for a sense of speed
    if (i % RUNG_PERIOD === 0 && !track.gapAt(i)) {
      const w = hw - EDGE_INSET - EDGE_WIDTH - 0.3;
      const t = f0.tangent;
      at(a, f0, -w).addScaledVector(t, -RUNG_HALF_LENGTH);
      at(b, f0, w).addScaledVector(t, -RUNG_HALF_LENGTH);
      at(c, f0, w).addScaledVector(t, RUNG_HALF_LENGTH);
      at(d, f0, -w).addScaledVector(t, RUNG_HALF_LENGTH);
      q.quad(a, b, c, d, RUNG);
    }
  }

  // Charge strips: dim lime with bright bars across, so they read as arrows pointing the way.
  for (const strip of track.charges) {
    for (let k = 0; ; k++) {
      const i = (strip.first + k) % n;
      if ((i - strip.first + n) % n > (strip.last - strip.first + n) % n) break;
      quad(frame(i), frame(i + 1), strip.left, strip.right, k % 4 < 2 ? CHARGE : CHARGE_DIM);
    }
  }

  // Either side of a gap: a lime line to hop from, and a cyan one to land beyond.
  for (const gap of track.gaps) {
    quad(frame(gap.first - 3), frame(gap.first - 1), -hw, hw, CHARGE);
    quad(frame(gap.last + 1), frame(gap.last + 3), -hw, hw, LANDING);
  }

  // The start and finish line: a white strip across the whole road, two samples deep.
  quad(frame(track.startIndex), frame(track.startIndex + 2), -hw, hw, START_LINE);

  const markings = new Mesh(q.build(), new MeshBasicMaterial({ vertexColors: true }));
  group.add(markings);
  return group;
}
