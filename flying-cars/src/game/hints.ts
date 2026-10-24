import type { Track } from '../track/Track';
import type { KeyValueStore } from './records';
import type { LandingGuide } from './landingGuide';
import { HOP_BUFFER_AT, HOP_BUFFER_WINDOW } from '../util/constants';

/** The kinds of thing on a track that get a hint. */
export type HintKind =
  'gap' | 'skyUp' | 'skyDown' | 'hurdle' | 'slot' | 'wall' | 'ceiling' | 'loop' | 'charge';

/** What the screen shows: a short title, one line of help, and the key to press (if there is one). */
export interface Hint {
  kind: HintKind;
  title: string;
  text: string;
  key: string | null;
  /** True when it is time to act: the screen makes it louder. */
  now: boolean;
}

/** What the hints need to know about the player's car each frame. */
export interface HintState {
  /** Nearest road sample to the car. */
  index: number;
  attached: boolean;
  air: number;
  /** Distance to the surface below the car, metres (Infinity when none within reach). */
  groundDistance: number;
  /** The landing guide while in the air, else null. */
  guide: LandingGuide | null;
}

export interface Feature {
  kind: HintKind;
  /** First sample the hint shows on, the sample to act at, and the sample the feature ends at. */
  from: number;
  action: number;
  to: number;
  /** For a slot wall: where the opening is, metres right of the centre. */
  side?: number;
}

/** After this many clean passes the player knows it, and that kind of hint stops. */
export const HINT_LEARNED = 3;
export const HINTS_KEY = 'flyingcars.v1.hints';

/** Metres before the action point at which a hint changes from "coming up" to "now". */
const NOW_DISTANCE = 22;

/** The metres of warning each kind gets: more for what has to be done at speed. */
const WARNING: Record<HintKind, number> = {
  gap: 110,
  skyUp: 130,
  skyDown: 80,
  hurdle: 100,
  slot: 100,
  wall: 110,
  ceiling: 110,
  loop: 100,
  charge: 70,
};

/** When several are showing at once, the lower number wins. */
const PRIORITY: Record<HintKind, number> = {
  skyUp: 0,
  skyDown: 0,
  gap: 1,
  hurdle: 2,
  slot: 2,
  loop: 3,
  wall: 3,
  ceiling: 3,
  charge: 4,
};

/**
 * Hints for a track: what is coming up and which key to press, shown as the player gets near it. Each kind
 * stops showing once the player has got past it cleanly three times, so it teaches and then gets out of the way.
 * Knows nothing about the screen: the game asks for the current hint and draws it.
 */
export class HintEngine {
  /** Turned off in the settings. */
  enabled = true;

  private readonly track: Track;
  private readonly features: Feature[];
  private readonly store: KeyValueStore | null;
  private readonly learned: Partial<Record<HintKind, number>> = {};
  private active: Feature | null = null;
  private failed = false;
  private readonly hint: Hint = { kind: 'gap', title: '', text: '', key: null, now: false };

  constructor(track: Track, store: KeyValueStore | null) {
    this.track = track;
    this.store = store;
    this.features = findFeatures(track);
    this.load();
  }

  /** How many clean passes the player has made of this kind of thing. */
  count(kind: HintKind): number {
    return this.learned[kind] ?? 0;
  }

  /** The player crashed, fell or hit something: the pass in progress does not count. */
  noteFailure(): void {
    this.failed = true;
  }

  /** The hint to show now, or null. Call every frame while racing. The object returned is reused: read it before the next call. */
  update(state: HintState): Hint | null {
    const n = this.track.count;
    const here = state.index;
    let best: Feature | null = null;
    let bestDistance = Infinity;
    for (const f of this.features) {
      if (this.count(f.kind) >= HINT_LEARNED) continue;
      const into = (here - f.from + n) % n;
      const length = (f.to - f.from + n) % n;
      if (into > length) continue;
      const toAction = (f.action - here + n) % n; // wraps to a large number once past it
      const distance = toAction > n / 2 ? 0 : toAction;
      const rank = PRIORITY[f.kind] * 1000 + distance;
      if (rank < bestDistance) {
        best = f;
        bestDistance = rank;
      }
    }

    // Leaving a feature it was showing for: a clean pass counts.
    if (this.active && this.active !== best) {
      const left = this.active;
      const still = (here - left.from + n) % n <= (left.to - left.from + n) % n;
      if (!still && !this.failed) this.pass(left.kind);
    }
    if (best !== this.active) this.failed = false;
    this.active = best;

    if (!best || !this.enabled) return null;
    return this.describe(best, state);
  }

  /** Fills in the one Hint object that is handed out, so a hint shown for many frames allocates nothing. */
  private make(kind: HintKind, title: string, text: string, key: string | null, now = false): Hint {
    const hint = this.hint;
    hint.kind = kind;
    hint.title = title;
    hint.text = text;
    hint.key = key;
    hint.now = now;
    return hint;
  }

  private describe(f: Feature, s: HintState): Hint {
    const n = this.track.count;
    const toAction = ((f.action - s.index + n) % n) * this.track.spacing;
    const ahead = toAction < (n / 2) * this.track.spacing;
    // a tap for a gap is held until the right spot, so "now" starts as soon as the tap is accepted
    const reach =
      f.kind === 'gap' || f.kind === 'skyUp' ? HOP_BUFFER_WINDOW - HOP_BUFFER_AT : NOW_DISTANCE;
    const near = ahead && toAction <= reach;
    switch (f.kind) {
      case 'gap':
        if (!s.attached) return this.make(f.kind, 'IN THE AIR', 'Keep level', null);
        return near
          ? this.make(f.kind, 'TAP SPACE NOW', 'Any moment now', 'Space', true)
          : this.make(f.kind, 'GAP AHEAD', 'Tap SPACE to jump', 'Space');
      case 'skyUp':
        if (!s.attached) {
          return s.guide && s.guide.degrees > 30
            ? this.make(f.kind, `PRESS ${s.guide.key}`, 'Make LAND ANGLE green', s.guide.key, true)
            : this.make(f.kind, 'HOLD ON', 'Stay level', null);
        }
        return near
          ? this.make(f.kind, 'TAP SPACE NOW', 'The car flips itself', 'Space', true)
          : this.make(f.kind, 'SKY ISLAND AHEAD', 'Tap SPACE to jump', 'Space');
      case 'skyDown':
        if (!s.attached) {
          return s.groundDistance < 3.5
            ? this.make(f.kind, 'TAP SPACE NOW', 'Soft landing', 'Space', true)
            : s.guide && s.guide.degrees > 30
              ? this.make(
                  f.kind,
                  `PRESS ${s.guide.key}`,
                  'Make LAND ANGLE green',
                  s.guide.key,
                  true,
                )
              : this.make(f.kind, 'ALMOST DOWN', 'Tap SPACE near the road', 'Space');
        }
        return this.make(f.kind, 'DRIVE OFF THE END', 'Do not brake', null);
      case 'hurdle':
        return near
          ? this.make(f.kind, 'TAP SPACE NOW', 'Jump the barrier', 'Space', true)
          : this.make(f.kind, 'BARRIER AHEAD', 'Tap SPACE to jump', 'Space');
      case 'slot': {
        const side = f.side ?? 0;
        const where = side < -1.5 ? 'ON THE LEFT' : side > 1.5 ? 'ON THE RIGHT' : 'IN THE MIDDLE';
        return this.make(
          f.kind,
          `WALL, GAP ${where}`,
          'Steer through the gap',
          side < -1.5 ? 'A' : side > 1.5 ? 'D' : null,
          near,
        );
      }
      case 'wall':
        return this.make(f.kind, 'WALL AHEAD', 'Keep your speed up', null);
      case 'ceiling':
        return this.make(f.kind, 'CEILING AHEAD', 'Do not brake', null);
      case 'loop':
        return this.make(f.kind, 'LOOP AHEAD', 'Stay on the throttle', null);
      case 'charge':
        return this.make(
          f.kind,
          'CHARGE STRIP',
          s.air < 90 ? 'Drive over it to refill air' : 'Your air is full',
          null,
        );
    }
  }

  private pass(kind: HintKind): void {
    this.learned[kind] = this.count(kind) + 1;
    try {
      this.store?.setItem(HINTS_KEY, JSON.stringify(this.learned));
    } catch {
      // not saved: still works for this visit
    }
  }

  private load(): void {
    try {
      const text = this.store?.getItem(HINTS_KEY);
      if (!text) return;
      const data: unknown = JSON.parse(text);
      if (typeof data !== 'object' || data === null) return;
      for (const kind of Object.keys(WARNING) as HintKind[]) {
        const value = (data as Record<string, unknown>)[kind];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
          this.learned[kind] = Math.floor(value);
        }
      }
    } catch {
      // unreadable: start fresh
    }
  }
}

/** Finds everything on a track that gets a hint. */
export function findFeatures(track: Track): Feature[] {
  const n = track.count;
  const back = (i: number, metres: number): number =>
    (((i - Math.round(metres / track.spacing)) % n) + n) % n;
  const frame = (i: number) => track.frames[((i % n) + n) % n];
  const features: Feature[] = [];

  for (const g of track.gaps) {
    if (g.ledge !== 'none') continue;
    const before = frame(g.first - 4);
    const after = frame(g.last + 4);
    if (!before || !after) continue;
    const kind: HintKind =
      before.up.y < -0.5 && after.up.y > 0.5
        ? 'skyDown'
        : after.up.y < -0.5 && before.up.y > 0.5
          ? 'skyUp'
          : 'gap';
    const action = kind === 'skyDown' ? g.first : back(g.first, 8);
    features.push({
      kind,
      from: back(g.first, WARNING[kind]),
      action,
      to: (g.last + Math.round(25 / track.spacing)) % n,
    });
  }

  for (const b of track.barriers) {
    if (b.slot) {
      // a slot wall is two barriers: one hint for the pair
      if (features.some((f) => f.kind === 'slot' && f.action === b.index)) continue;
      features.push({
        kind: 'slot',
        from: back(b.index, WARNING.slot),
        action: b.index,
        to: (b.index + Math.round(8 / track.spacing)) % n,
        side: b.slot.centre,
      });
    } else if (b.height < 2) {
      features.push({
        kind: 'hurdle',
        from: back(b.index, WARNING.hurdle),
        action: back(b.index, 12),
        to: (b.index + Math.round(8 / track.spacing)) % n,
      });
    }
  }

  for (const c of track.charges) {
    features.push({
      kind: 'charge',
      from: back(c.first, WARNING.charge),
      action: c.first,
      to: c.last,
    });
  }

  // runs of road standing on its side, upside down, or climbing a loop
  const runs: [HintKind, (i: number) => boolean][] = [
    [
      'wall',
      (i) => Math.abs(frame(i)?.tangent.y ?? 1) < 0.3 && Math.abs(frame(i)?.up.y ?? 1) < 0.5,
    ],
    ['ceiling', (i) => Math.abs(frame(i)?.tangent.y ?? 1) < 0.3 && (frame(i)?.up.y ?? 1) < -0.8],
    ['loop', (i) => (frame(i)?.tangent.y ?? 0) > 0.6],
  ];
  const minimum = Math.round(25 / track.spacing);
  for (const [kind, test] of runs) {
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const inside = i < n && test(i);
      if (inside && start < 0) start = i;
      if (!inside && start >= 0) {
        if (i - start >= minimum && !track.gapAt(start)) {
          features.push({
            kind,
            from: back(start, WARNING[kind]),
            action: start,
            to: kind === 'loop' ? (start + Math.round(170 / track.spacing)) % n : i % n,
          });
        }
        start = -1;
      }
    }
  }

  return features;
}
