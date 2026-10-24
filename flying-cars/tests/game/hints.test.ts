import { describe, expect, it } from 'vitest';
import {
  HINT_LEARNED,
  HINTS_KEY,
  HintEngine,
  findFeatures,
  type HintState,
} from '../../src/game/hints';
import { Track } from '../../src/track/Track';
import { TRACK_LIST, createTrack } from '../../src/track/tracks';

class MemoryStore {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const warmUp = createTrack('warm-up') as Track;

const base: HintState = {
  index: 0,
  attached: true,
  air: 100,
  groundDistance: Infinity,
  guide: null,
};

/** Drives a car round the whole track once, asking for the hint at every sample, and gathers what it said. */
function lap(engine: HintEngine, track: Track, state: Partial<HintState> = {}) {
  const seen: { kind: string; title: string; index: number; now: boolean }[] = [];
  for (let i = 0; i < track.count; i++) {
    const hint = engine.update({ ...base, ...state, index: i });
    if (hint) seen.push({ kind: hint.kind, title: hint.title, index: i, now: hint.now });
  }
  return seen;
}

describe('finding things to hint about', () => {
  it('finds each kind of thing on Warm-up', () => {
    const kinds = new Set(findFeatures(warmUp).map((f) => f.kind));
    for (const kind of ['gap', 'skyUp', 'skyDown', 'hurdle', 'slot', 'wall', 'ceiling', 'charge']) {
      expect(kinds.has(kind as never), kind).toBe(true);
    }
  });

  it('tells a flat gap from a gap up to a sky island and a drop back down', () => {
    const features = findFeatures(warmUp);
    const gaps = warmUp.gaps;
    const kindAt = (gapIndex: number) => {
      const g = gaps[gapIndex];
      return features.find(
        (f) =>
          ['gap', 'skyUp', 'skyDown'].includes(f.kind) && f.to >= g!.last && f.from <= g!.first,
      )?.kind;
    };
    expect(kindAt(0)).toBe('gap');
    expect(kindAt(1)).toBe('skyUp');
    expect(kindAt(2)).toBe('skyDown');
  });

  it('gives a slot wall one hint, not one for each of its two walls', () => {
    for (const info of TRACK_LIST) {
      const track = createTrack(info.id) as Track;
      const slots = track.barriers.filter((b) => b.slot);
      const hints = findFeatures(track).filter((f) => f.kind === 'slot');
      const walls = new Set(slots.map((b) => b.index));
      expect(hints.length).toBe(walls.size);
    }
  });

  it('every track has hints for its gaps, and every gap gets exactly one', () => {
    for (const info of TRACK_LIST) {
      const track = createTrack(info.id) as Track;
      const gapHints = findFeatures(track).filter((f) =>
        ['gap', 'skyUp', 'skyDown'].includes(f.kind),
      );
      expect(gapHints.length, info.name).toBe(track.gaps.length);
    }
  });
});

describe('what the hints say', () => {
  const fresh = () => new HintEngine(warmUp, null);

  it('warns ahead of a gap, then says to tap Space now as the edge comes close', () => {
    const gap = warmUp.gaps[0]!;
    const far = fresh().update({ ...base, index: gap.first - 80 });
    expect(far?.kind).toBe('gap');
    expect(far?.now).toBe(false);
    expect(far?.key).toBe('Space');
    const close = fresh().update({ ...base, index: gap.first - 12 });
    expect(close?.now).toBe(true);
    expect(close?.title).toContain('NOW');
  });

  it('on the way up to a sky island, names the key to roll with while the car is off level', () => {
    const gap = warmUp.gaps[1]!;
    const hint = fresh().update({
      ...base,
      index: gap.first + 10,
      attached: false,
      guide: { degrees: 120, key: 'E' },
    });
    expect(hint?.kind).toBe('skyUp');
    expect(hint?.title).toBe('PRESS E');
    expect(hint?.key).toBe('E');
    const level = fresh().update({
      ...base,
      index: gap.first + 10,
      attached: false,
      guide: { degrees: 5, key: 'E' },
    });
    expect(level?.key).toBeNull();
  });

  it('coming off the end of a sky island, says to drive off, then to tap Space near the ground', () => {
    const gap = warmUp.gaps[2]!;
    const on = fresh().update({ ...base, index: gap.first - 30 });
    expect(on?.kind).toBe('skyDown');
    expect(on?.title).toBe('DRIVE OFF THE END');
    const low = fresh().update({
      ...base,
      index: gap.first + 30,
      attached: false,
      groundDistance: 2,
      guide: { degrees: 4, key: 'Q' },
    });
    expect(low?.title).toBe('TAP SPACE NOW');
  });

  it('says which side the opening is on for a slot wall', () => {
    const wall = warmUp.barriers.find((b) => b.slot)!;
    const hint = fresh().update({ ...base, index: wall.index - 50 });
    expect(hint?.kind).toBe('slot');
    expect(hint?.title).toMatch(/LEFT|RIGHT|MIDDLE/);
  });

  it('shows nothing on a plain stretch with nothing coming', () => {
    const engine = fresh();
    const seen = lap(engine, warmUp);
    const quiet = Array.from({ length: warmUp.count }, (_, i) => i).filter(
      (i) => !seen.some((s) => s.index === i),
    );
    expect(quiet.length).toBeGreaterThan(200);
  });

  it('can be turned off, and shows nothing then', () => {
    const engine = fresh();
    engine.enabled = false;
    expect(lap(engine, warmUp)).toEqual([]);
  });
});

describe('learning', () => {
  it('stops showing a kind after three clean passes, and only that kind', () => {
    const engine = new HintEngine(warmUp, null);
    for (let i = 0; i < HINT_LEARNED; i++) lap(engine, warmUp);
    expect(engine.count('gap')).toBeGreaterThanOrEqual(HINT_LEARNED);
    const after = lap(engine, warmUp);
    expect(after.some((s) => s.kind === 'gap')).toBe(false);
    expect(after.some((s) => s.kind === 'skyUp')).toBe(false);
  });

  it('does not count a pass that went wrong', () => {
    const engine = new HintEngine(warmUp, null);
    const gap = warmUp.gaps[0]!;
    for (let i = gap.first - 100; i < gap.first + 60; i++) {
      if (i === gap.first + 5) engine.noteFailure();
      engine.update({ ...base, index: i });
    }
    // leave it far behind so the pass is judged
    engine.update({ ...base, index: gap.last + 200 });
    expect(engine.count('gap')).toBe(0);
  });

  it('remembers what was learned next time, and survives broken saved data', () => {
    const store = new MemoryStore();
    const first = new HintEngine(warmUp, store);
    for (let i = 0; i < HINT_LEARNED; i++) lap(first, warmUp);
    expect(store.data.has(HINTS_KEY)).toBe(true);
    const second = new HintEngine(warmUp, store);
    expect(second.count('gap')).toBeGreaterThanOrEqual(HINT_LEARNED);

    for (const text of ['nope', '[]', 'null', '{"gap":"x"}', '{"gap":-4}']) {
      const bad = new MemoryStore();
      bad.setItem(HINTS_KEY, text);
      expect(new HintEngine(warmUp, bad).count('gap')).toBe(0);
    }
  });
});
