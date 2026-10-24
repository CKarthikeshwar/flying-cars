import { CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from 'three';
import {
  GATE_COUNT_SPACING,
  RIDE_HEIGHT,
  BARRIER_HOP_LEAD,
  GAP_HOP_LEAD,
  GATE_GAP_CLEAR,
  GATE_MAX_SLOPE,
  TRACK_LEDGE_STRIPS,
  TRACK_TAPER_SAMPLES,
  TRACK_STRIPS,
  TRACK_FLAT_SLOPE,
  TRACK_SAMPLE_SPACING,
  TRACK_THICKNESS,
  TRACK_WIDTH,
} from '../util/constants';
import { buildGates, type Gate } from './checkpoints';
import {
  isHurdle,
  makeRing,
  slotBarriers,
  type Barrier,
  type BarrierDef,
  type Ring,
  type RingDef,
  type SlotDef,
} from './hazards';

const DEG = Math.PI / 180;

/** A banking keyframe: at `s` metres along the track the road is rolled by `deg` about its direction of travel. */
export interface BankKey {
  s: number;
  deg: number;
}

/** A stretch of road with a hole in it. Only a narrow ledge on one side stays, so a gap can be driven, slowly, or hopped. */
export interface GapDef {
  /** Distance along the track (from the first control point) where the hole starts and ends. */
  from: number;
  to: number;
  /** The side the ledge stays on, or 'none' for an island gap: nothing is left of the road between the islands. */
  ledge: 'left' | 'right' | 'none';
}

/** A charge strip: driving over it refills the air tank quickly. */
export interface ChargeDef {
  /** Distance along the track (from the first control point) where the strip starts and ends. */
  from: number;
  to: number;
  /** The strip covers this range across the road, in metres to the right of the centre line. */
  left: number;
  right: number;
}

/** A gap in sample terms. */
export interface GapRange {
  /** First and last sample of the hole, inclusive. */
  first: number;
  last: number;
  ledge: 'left' | 'right' | 'none';
}

/** A charge strip in sample terms. */
export interface ChargeRange {
  first: number;
  last: number;
  left: number;
  right: number;
}

/** What a track data file provides: a closed loop of control points and where the road rolls. */
export interface TrackDef {
  name: string;
  width?: number;
  thickness?: number;
  /** Control points of a closed spline, in world space. */
  points: Vector3[];
  /** Keyframes sorted by `s`. Between keys the roll eases in and out. The last key wraps to the first. */
  banking: BankKey[];
  /** Distance along the track (metres from the first control point) of the start and finish line. Default 0. */
  start?: number;
  /** Distances along the track (from the first control point) at which the AI should hop, for gaps and corners that reward one. */
  hops?: number[];
  /** Number of checkpoint gates, the start line included. Default: one every 100 m. */
  gateCount?: number;
  /** Holes in the road. The AI hops each one, 8 m before it starts. */
  gaps?: GapDef[];
  /** Strips that refill the air tank. */
  charges?: ChargeDef[];
  /** Rings hanging over the road: fly through one for air and a push. */
  rings?: RingDef[];
  /** Low barriers across the road to hop, or any barrier that blocks part of it. */
  barriers?: BarrierDef[];
  /** Tall walls across the road with one opening to steer or dash through. */
  slots?: SlotDef[];
}

/** The coordinate frame of the road at one sample. */
export interface TrackFrame {
  /** Distance along the track from the start, metres. */
  s: number;
  position: Vector3;
  /** Unit tangent T, the direction of travel. */
  tangent: Vector3;
  /** Unit road normal U, pointing from the road toward the car. On a ceiling it points down. */
  up: Vector3;
  /** Unit binormal B = T x U, pointing to the car's right. */
  binormal: Vector3;
}

/** The triangle data for a Rapier trimesh collider. */
export interface MeshData {
  vertices: Float32Array;
  indices: Uint32Array;
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** The signed angle from x to y about the unit axis a, for vectors perpendicular to a. */
function signedAngle(x: Vector3, y: Vector3, a: Vector3): number {
  const cx = x.y * y.z - x.z * y.y;
  const cy = x.z * y.x - x.x * y.z;
  const cz = x.x * y.y - x.y * y.x;
  return Math.atan2(a.x * cx + a.y * cy + a.z * cz, x.dot(y));
}

/**
 * Banking angle (radians) at distance s, easing between keyframes with a smoothstep.
 * The keys wrap around: after the last key the roll eases back toward the first key at the end of the loop.
 */
export function bankingAt(keys: BankKey[], s: number, length: number): number {
  const first = keys[0];
  if (!first) return 0;
  let x = ((s % length) + length) % length;
  if (x < first.s) x += length; // before the first key we are in the closing segment
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i];
    if (!a) continue;
    const b = keys[i + 1] ?? { s: first.s + length, deg: first.deg };
    if (x >= a.s && x <= b.s) {
      const span = b.s - a.s;
      const t = span > 1e-9 ? smoothstep((x - a.s) / span) : 1;
      return (a.deg + (b.deg - a.deg) * t) * DEG;
    }
  }
  return first.deg * DEG;
}

/**
 * A closed track: a Catmull-Rom spline, a road frame at every sample (up vector by parallel transport,
 * the closing twist spread evenly along the loop, then banking), and a slab mesh for collision.
 * Knows nothing about rendering, so it can be tested without a browser.
 */
export class Track {
  readonly name: string;
  readonly width: number;
  readonly thickness: number;
  readonly length: number;
  readonly frames: TrackFrame[];
  readonly minY: number;
  /** Metres between samples. */
  readonly spacing: number;
  /** Index of the sample at the start and finish line. */
  readonly startIndex: number;
  /** Checkpoint gates in driving order. Gate 0 is the start and finish line. */
  readonly gates: Gate[];
  /** Distances (metres from the start line) where the AI should hop. */
  readonly hopMarkers: number[];
  /** Curvature of the centre line at each sample, radians per metre. */
  readonly curvature: Float64Array;
  /** How fast the road's up vector turns at each sample, radians per metre (loops, rolls and curves all count). */
  readonly normalRate: Float64Array;
  /** Holes in the road, in driving order. */
  readonly gaps: GapRange[];
  /** Charge strips. */
  readonly charges: ChargeRange[];
  /** Rings to fly through, in driving order. */
  readonly rings: Ring[];
  /** Barriers, in driving order. */
  readonly barriers: Barrier[];
  /** The largest leftover twist (radians) parallel transport had to have spread out along a stretch of road. */
  closingTwist = 0;

  private readonly banking: BankKey[];
  /** How much of the full thickness the slab has at each sample: it thins to a knife edge where an island ends. */
  private readonly taper: Float64Array;
  private meshCache: MeshData | null = null;

  constructor(def: TrackDef) {
    this.name = def.name;
    this.width = def.width ?? TRACK_WIDTH;
    this.thickness = def.thickness ?? TRACK_THICKNESS;
    this.banking = def.banking;

    const curve = new CatmullRomCurve3(def.points, true, 'centripetal');
    curve.arcLengthDivisions = Math.max(200, def.points.length * 40);
    curve.updateArcLengths();
    this.length = curve.getLength();

    const count = Math.max(8, Math.round(this.length / TRACK_SAMPLE_SPACING));
    const positions: Vector3[] = [];
    const tangents: Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const u = i / count;
      positions.push(curve.getPointAt(u));
      tangents.push(curve.getTangentAt(u).normalize());
    }

    const ups = this.buildUps(tangents);

    // Banking: roll the up vector about the tangent.
    this.frames = [];
    let minY = Infinity;
    for (let i = 0; i < count; i++) {
      const t = tangents[i] as Vector3;
      const s = (i / count) * this.length;
      const up = (ups[i] as Vector3).applyAxisAngle(t, bankingAt(this.banking, s, this.length));
      up.addScaledVector(t, -up.dot(t)).normalize();
      const binormal = new Vector3().crossVectors(t, up).normalize();
      const position = positions[i] as Vector3;
      this.frames.push({ s, position, tangent: t, up, binormal });
      minY = Math.min(
        minY,
        position.y - this.width * 0.5 * Math.abs(binormal.y) - this.thickness * Math.abs(up.y),
      );
    }
    this.minY = minY;

    this.spacing = this.length / count;
    this.startIndex = Math.round((def.start ?? 0) / this.spacing) % count;
    const gateCount = Math.max(2, def.gateCount ?? Math.round(this.length / GATE_COUNT_SPACING));
    const startS = this.startIndex * this.spacing;
    const indexAt = (distance: number): number =>
      ((Math.round(distance / this.spacing) % count) + count) % count;
    this.gaps = (def.gaps ?? []).map((g) => ({
      first: indexAt(g.from),
      last: indexAt(g.to),
      ledge: g.ledge,
    }));
    // Where an island ends the slab thins to nothing over a few metres, so there is no vertical face to fly
    // into: a car arriving under an upside-down island meets the surface, not a wall.
    this.taper = new Float64Array(count).fill(1);
    for (const g of this.gaps) {
      if (g.ledge !== 'none') continue;
      for (let k = 0; k < TRACK_TAPER_SAMPLES; k++) {
        const fraction = (k + 1) / (TRACK_TAPER_SAMPLES + 1);
        for (const at of [g.first - 1 - k, g.last + 1 + k]) {
          const i = ((at % count) + count) % count;
          this.taper[i] = Math.min(this.taper[i] ?? 1, fraction);
        }
      }
    }
    this.charges = (def.charges ?? []).map((c) => ({
      first: indexAt(c.from),
      last: indexAt(c.to),
      left: c.left,
      right: c.right,
    }));
    this.rings = (def.rings ?? [])
      .map((r) => makeRing(this.frames[indexAt(r.at)] as TrackFrame, indexAt(r.at), r))
      .sort((a, b) => a.index - b.index);
    this.barriers = [
      ...(def.barriers ?? []).map((b) => ({
        index: indexAt(b.at),
        left: b.left,
        right: b.right,
        height: b.height,
        slot: null,
      })),
      ...(def.slots ?? []).flatMap((slot) => slotBarriers(slot, indexAt(slot.at), this.width)),
    ].sort((a, b) => a.index - b.index);
    // Checkpoint gates are where a car respawns, so they are kept off the gaps and a run-up clear of them.
    const clear = Math.ceil(GATE_GAP_CLEAR / this.spacing);
    const blocked = (index: number): boolean => {
      for (let k = 0; k <= clear; k++) {
        if (this.gapAt(index + k)) return true;
        // steep road (a loop, a hard climb) is no place to restart from rest: the car just rolls back down
        const f = this.frames[(index + k) % count];
        if (f && Math.abs(f.tangent.y) > GATE_MAX_SLOPE) return true;
      }
      return false;
    };
    this.gates = buildGates(this.frames, this.startIndex, gateCount, blocked);
    // Hop markers: the ones the track data lists, plus one a little before every gap.
    const hopDistances = [
      ...(def.hops ?? []),
      ...(def.gaps ?? []).map((g) => g.from - GAP_HOP_LEAD),
      // and one before every hurdle (a hurdle may be two barriers side by side: one marker for each place)
      ...[...new Set((def.barriers ?? []).filter(isHurdle).map((b) => b.at))].map(
        (at) => at - BARRIER_HOP_LEAD,
      ),
    ];
    this.hopMarkers = hopDistances
      .map((h) => (((h - startS) % this.length) + this.length) % this.length)
      .sort((a, b) => a - b);

    this.curvature = new Float64Array(count);
    this.normalRate = new Float64Array(count);
    const smooth = 3; // samples either side, so single-sample noise does not spike the numbers
    for (let i = 0; i < count; i++) {
      const a = this.frames[(i - smooth + count) % count] as TrackFrame;
      const b = this.frames[(i + smooth) % count] as TrackFrame;
      const run = 2 * smooth * this.spacing;
      this.curvature[i] = Math.acos(Math.min(1, a.tangent.dot(b.tangent))) / run;
      this.normalRate[i] = Math.acos(Math.min(1, a.up.dot(b.up))) / run;
    }
  }

  /** The gap that sample i is inside, or null. */
  gapAt(i: number): GapRange | null {
    const n = this.count;
    const at = ((i % n) + n) % n;
    for (const g of this.gaps) {
      if ((at - g.first + n) % n <= (g.last - g.first + n) % n) return g;
    }
    return null;
  }

  /** The first and last top vertex of the road at sample i: the whole road, or just the ledge inside a gap. */
  stripRange(i: number): [number, number] {
    const gap = this.gapAt(i);
    if (!gap) return [0, TRACK_STRIPS];
    if (gap.ledge === 'none') return [0, 0];
    return gap.ledge === 'right'
      ? [TRACK_STRIPS - TRACK_LEDGE_STRIPS, TRACK_STRIPS]
      : [0, TRACK_LEDGE_STRIPS];
  }

  /** Whether there is road at sample i, w metres to the right of the centre line. */
  roadAt(i: number, w: number): boolean {
    const [lo, hi] = this.stripRange(i);
    if (lo === hi) return false;
    const strip = this.width / TRACK_STRIPS;
    const half = this.width / 2;
    return w >= -half + lo * strip - 1e-6 && w <= -half + hi * strip + 1e-6;
  }

  /** The middle of the ledge, in metres to the right of the centre line, when sample i is inside a gap. */
  ledgeCentre(i: number): number | null {
    const gap = this.gapAt(i);
    if (!gap || gap.ledge === 'none') return null;
    const half = this.width / 2;
    const ledge = (TRACK_LEDGE_STRIPS * this.width) / TRACK_STRIPS;
    return gap.ledge === 'right' ? half - ledge / 2 : -half + ledge / 2;
  }

  /** Whether sample i, w metres to the right of the centre line, is on a charge strip. */
  chargeAt(i: number, w: number): boolean {
    const n = this.count;
    const at = ((i % n) + n) % n;
    for (const c of this.charges) {
      if ((at - c.first + n) % n <= (c.last - c.first + n) % n && w >= c.left && w <= c.right) {
        return true;
      }
    }
    return false;
  }

  /** The opening of the next slot wall within `ahead` samples of sample i, as metres right of the centre. Null when none. */
  slotAhead(i: number, ahead: number): { centre: number; distance: number } | null {
    const n = this.count;
    for (const b of this.barriers) {
      if (!b.slot) continue;
      const d = (b.index - i + n) % n;
      if (d <= ahead) return { centre: b.slot.centre, distance: d * this.spacing };
    }
    return null;
  }

  /**
   * Where a car coming down should aim to land: the first road beyond the island gap that sample i is in, or about to
   * enter within `lead` samples. With no such gap, the road at sample i itself.
   */
  landingIndex(i: number, lead: number): number {
    const n = this.count;
    const at = ((i % n) + n) % n;
    for (const g of this.gaps) {
      if (g.ledge !== 'none') continue;
      const toGap = (g.first - at + n) % n;
      const inside = (at - g.first + n) % n <= (g.last - g.first + n) % n;
      if (inside || toGap <= lead) return (g.last + 4) % n;
    }
    return at;
  }

  /** Distance from the start line to sample i, metres, in 0 .. length. */
  lapDistance(i: number): number {
    const n = this.count;
    return ((((i - this.startIndex) % n) + n) % n) * this.spacing;
  }

  /**
   * The road's up vector at every sample, before banking.
   *
   * Parallel transport carries the up vector along the spline by the smallest rotation at each step, which
   * is what keeps it sensible through a loop. But transport alone drifts: a loop that shifts the road
   * sideways leaves the road twisted by (shift / radius) when it comes out, and the spec's fix of spreading
   * the leftover over the whole track would tilt every flat stretch.
   *
   * So on flat stretches (tangent within 25 degrees of horizontal) the up vector is locked to the world's
   * level direction, upright or upside down depending on which way the road arrived. Through the steep
   * stretches between them it is transported, and the leftover twist is spread evenly along that stretch.
   * A track with no flat stretch falls back to spreading the leftover over the whole loop.
   */
  private buildUps(tangents: Vector3[]): Vector3[] {
    const n = tangents.length;
    const worldUp = new Vector3(0, 1, 0);
    const turn = new Quaternion();
    const tan = (i: number): Vector3 => tangents[((i % n) + n) % n] as Vector3;
    const level = (t: Vector3): Vector3 =>
      worldUp.clone().addScaledVector(t, -worldUp.dot(t)).normalize();
    const transport = (up: Vector3, from: Vector3, to: Vector3): Vector3 => {
      turn.setFromUnitVectors(from, to);
      const out = up.clone().applyQuaternion(turn);
      return out.addScaledVector(to, -out.dot(to)).normalize(); // remove rounding drift
    };

    const flat = tangents.map((t) => Math.abs(t.y) < TRACK_FLAT_SLOPE);
    const start = flat.indexOf(true);
    const ups: Vector3[] = Array.from({ length: n }, () => new Vector3());

    if (start < 0) {
      // No flat stretch anywhere: plain transport, then spread the closing twist evenly along the whole loop.
      const first = tan(0);
      const u0 = worldUp.clone().addScaledVector(first, -worldUp.dot(first));
      if (u0.lengthSq() < 1e-6) u0.set(0, 0, 1).addScaledVector(first, -first.z);
      ups[0] = u0.normalize();
      for (let i = 1; i < n; i++) ups[i] = transport(ups[i - 1] as Vector3, tan(i - 1), tan(i));
      const closing = transport(ups[n - 1] as Vector3, tan(n - 1), first);
      this.closingTwist = signedAngle(closing, ups[0] as Vector3, first);
      for (let i = 1; i < n; i++)
        (ups[i] as Vector3).applyAxisAngle(tan(i), (this.closingTwist * i) / n);
      return ups;
    }

    ups[start] = level(tan(start)); // the first flat stretch is upright
    let anchor = 0; // how many steps from `start` the last flat sample was
    for (let k = 1; k <= n; k++) {
      const i = start + k;
      const carried = transport(ups[(i - 1) % n] as Vector3, tan(i - 1), tan(i));
      if (!flat[i % n]) {
        ups[i % n] = carried;
        continue;
      }
      // Reached the next flat sample: snap to level (upright or inverted, whichever the road arrived as)
      // and spread what the transport got wrong back over the steep stretch just crossed.
      const lvl = level(tan(i));
      if (carried.dot(lvl) < 0) lvl.negate();
      if (k === n && lvl.dot(ups[start] as Vector3) < 0) {
        throw new Error(
          `Track "${this.name}" arrives back at the start upside down, so it cannot close smoothly`,
        );
      }
      const d = signedAngle(carried, lvl, tan(i));
      this.closingTwist = Math.max(this.closingTwist, Math.abs(d));
      for (let j = anchor + 1; j < k; j++) {
        (ups[(start + j) % n] as Vector3).applyAxisAngle(
          tan(start + j),
          (d * (j - anchor)) / (k - anchor),
        );
      }
      if (k < n) ups[i % n] = lvl;
      anchor = k;
    }
    return ups;
  }

  get count(): number {
    return this.frames.length;
  }

  /** The point on the road surface at sample i, a distance w to the right of the centre line. */
  surfacePoint(out: Vector3, i: number, w: number): Vector3 {
    const f = this.frames[((i % this.count) + this.count) % this.count] as TrackFrame;
    return out.copy(f.position).addScaledVector(f.binormal, w);
  }

  /** A car's rest pose on the road at sample i, w metres to the right of the centre: at ride height, facing along the track. */
  poseAt(i: number, w = 0): { position: Vector3; quaternion: Quaternion } {
    const f = this.frames[((i % this.count) + this.count) % this.count] as TrackFrame;
    const position = this.surfacePoint(new Vector3(), i, w).addScaledVector(f.up, RIDE_HEIGHT);
    const basis = new Matrix4().makeBasis(f.binormal, f.up, f.tangent.clone().negate());
    return { position, quaternion: new Quaternion().setFromRotationMatrix(basis) };
  }

  /** Where a car starts: on the road at the first sample. */
  spawnPose(): { position: Vector3; quaternion: Quaternion } {
    return this.poseAt(0);
  }

  /**
   * One welded, closed slab for the whole track: top, bottom and both sides, `thickness` deep along -up.
   * Thick on purpose, so a fast car cannot tunnel through it.
   */
  colliderData(): MeshData {
    if (this.meshCache) return this.meshCache;
    const n = this.count;
    const strips = TRACK_STRIPS;
    // per sample: strips + 1 vertices across the top, then the bottom left and bottom right
    const perSample = strips + 3;
    const bottomLeft = strips + 1;
    const bottomRight = strips + 2;
    const vertices = new Float32Array(n * perSample * 3);
    const hw = this.width * 0.5;
    const stripWidth = this.width / strips;
    const p = new Vector3();
    for (let i = 0; i < n; i++) {
      const f = this.frames[i] as TrackFrame;
      const [lo, hi] = this.stripRange(i);
      const put = (k: number, w: number, depth: number): void => {
        p.copy(f.position).addScaledVector(f.binormal, w).addScaledVector(f.up, depth);
        vertices.set([p.x, p.y, p.z], (i * perSample + k) * 3);
      };
      // The top is cut into strips across the road. A road that rolls is a twisted ribbon, and one triangle
      // spanning the whole width would tilt along the road by (half width x roll rate): 25 degrees on a steep roll.
      for (let k = 0; k <= strips; k++) put(k, -hw + stripWidth * k, 0);
      // The slab underneath is as wide as the road is here: all of it, or just the ledge inside a gap.
      const depth = this.thickness * (this.taper[i] ?? 1);
      put(bottomLeft, -hw + stripWidth * lo, -depth);
      put(bottomRight, -hw + stripWidth * hi, -depth);
    }

    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = i * perSample;
      const b = j * perSample;
      const [loI, hiI] = this.stripRange(i);
      const [loJ, hiJ] = this.stripRange(j);
      // An island gap leaves nothing at all between the islands, and the slab is left open where an island
      // ends: it thins to a knife edge there, and a face closing it would be a wall for the car's sensor to find.
      if (loI === hiI || loJ === hiJ) continue;
      // top (faces +up), in strips. A strip exists between two samples only if the road has it at both,
      // so a gap leaves a hole, and only the ledge stays inside it.
      for (let k = Math.max(loI, loJ); k < Math.min(hiI, hiJ); k++) {
        indices.push(a + k, b + k + 1, b + k, a + k, a + k + 1, b + k + 1);
      }
      // bottom (faces -up), left side, right side
      indices.push(a + bottomLeft, b + bottomLeft, b + bottomRight);
      indices.push(a + bottomLeft, b + bottomRight, a + bottomRight);
      indices.push(a + loI, b + loJ, b + bottomLeft, a + loI, b + bottomLeft, a + bottomLeft);
      indices.push(a + hiI, b + bottomRight, b + hiJ, a + hiI, a + bottomRight, b + bottomRight);
    }
    this.meshCache = { vertices, indices: new Uint32Array(indices) };
    return this.meshCache;
  }
}
