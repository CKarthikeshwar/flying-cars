import { describe, expect, it } from 'vitest';
import {
  Sfx,
  engineFrequency,
  engineLevel,
  hissLevel,
  type SfxKind,
  type SoundState,
} from '../../src/audio/sfx';
import { SOUND_MASTER } from '../../src/util/constants';

/** A stand-in for one audio parameter that remembers what it was told. */
class FakeParam {
  value = 0;
  target: number | null = null;
  setValueAtTime(v: number): void {
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number): void {
    this.target = v;
  }
  setTargetAtTime(v: number): void {
    this.target = v;
  }
}

class FakeNode {
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  connected: FakeNode[] = [];
  started = 0;
  stopped = 0;
  connect(node: FakeNode): FakeNode {
    this.connected.push(node);
    return node;
  }
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 100;
  state = 'suspended';
  readonly destination = new FakeNode();
  readonly nodes: Record<string, FakeNode[]> = {};
  resumed = 0;
  resume(): Promise<void> {
    this.resumed++;
    this.state = 'running';
    return Promise.resolve();
  }
  private make(kind: string): FakeNode {
    const node = new FakeNode();
    (this.nodes[kind] ??= []).push(node);
    return node;
  }
  createGain = () => this.make('gain');
  createOscillator = () => this.make('osc');
  createBiquadFilter = () => this.make('filter');
  createBufferSource = () => this.make('source');
  createBuffer = (_channels: number, length: number) => ({
    getChannelData: () => new Float32Array(length),
  });
}

function make(muted = false) {
  let ctx: FakeContext | null = null;
  const sfx = new Sfx(muted, () => {
    ctx = new FakeContext();
    return ctx as unknown as AudioContext;
  });
  return { sfx, context: () => ctx };
}

const drive: SoundState = {
  active: true,
  speed: 40,
  attached: true,
  boosting: false,
  gliding: false,
  retro: false,
  slam: false,
  jets: false,
};

describe('what the sounds follow', () => {
  it('raises the engine pitch with speed', () => {
    expect(engineFrequency(0)).toBeLessThan(engineFrequency(20));
    expect(engineFrequency(20)).toBeLessThan(engineFrequency(60));
    expect(engineFrequency(-5)).toBe(engineFrequency(0));
  });

  it('keeps the engine silent when nothing is running, quieter in the air, louder when boosting', () => {
    expect(engineLevel({ ...drive, active: false })).toBe(0);
    expect(engineLevel({ ...drive, attached: false })).toBeLessThan(engineLevel(drive));
    expect(engineLevel({ ...drive, boosting: true })).toBeGreaterThan(engineLevel(drive));
    expect(engineLevel({ ...drive, speed: 0 })).toBeLessThan(engineLevel({ ...drive, speed: 60 }));
    expect(engineLevel({ ...drive, speed: 60, boosting: true })).toBeLessThan(0.2);
  });

  it('hisses for each jet, with the loudest for boost and braking, and nothing when idle', () => {
    expect(hissLevel(drive).level).toBe(0);
    expect(hissLevel({ ...drive, active: false, boosting: true }).level).toBe(0);
    const levels = {
      boost: hissLevel({ ...drive, boosting: true }),
      retro: hissLevel({ ...drive, retro: true }),
      slam: hissLevel({ ...drive, slam: true }),
      glide: hissLevel({ ...drive, gliding: true }),
      jets: hissLevel({ ...drive, jets: true }),
    };
    const copy = Object.values(levels).map((l) => ({ ...l }));
    for (const l of copy) expect(l.level).toBeGreaterThan(0);
    expect(levels.jets.level).toBeLessThan(levels.glide.level);
    expect(levels.glide.level).toBeLessThan(levels.boost.level);
    // the pitch differs, so you can hear which jet it is
    expect(new Set(copy.map((l) => l.hz)).size).toBe(5);
  });
});

describe('the sound system', () => {
  it('does nothing, and does not fail, before the first key press', () => {
    const { sfx, context } = make();
    expect(sfx.ready).toBe(false);
    sfx.play('hop');
    sfx.update(drive);
    sfx.setPaused(true);
    expect(context()).toBeNull();
  });

  it('does nothing where there is no audio at all', () => {
    const sfx = new Sfx(false, null);
    sfx.unlock();
    sfx.play('crash');
    sfx.update(drive);
    expect(sfx.ready).toBe(false);
  });

  it('survives an audio context that refuses to start', () => {
    const sfx = new Sfx(false, () => {
      throw new Error('no audio');
    });
    sfx.unlock();
    expect(sfx.ready).toBe(false);
  });

  it('builds itself on the first key press and starts the context', () => {
    const { sfx, context } = make();
    sfx.unlock();
    expect(sfx.ready).toBe(true);
    const ctx = context();
    expect(ctx?.resumed).toBe(1);
    expect(ctx?.nodes['osc']?.length).toBe(3); // the engine layers
    expect(ctx?.nodes['osc']?.every((o) => o.started === 1)).toBe(true);
    expect(ctx?.nodes['source']?.length).toBe(1); // the hiss
    // a second press builds nothing more
    sfx.unlock();
    expect(context()).toBe(ctx);
    expect(ctx?.nodes['osc']?.length).toBe(3);
  });

  it('plays every effect as a short sound that stops by itself', () => {
    const kinds: SfxKind[] = [
      'hop',
      'hopRefused',
      'cushion',
      'flip',
      'perfect',
      'rough',
      'crash',
      'dash',
      'ring',
      'hit',
      'respawn',
      'tick',
      'go',
      'lap',
      'finish',
    ];
    for (const kind of kinds) {
      const { sfx, context } = make();
      sfx.unlock();
      const count = () =>
        (context()?.nodes['osc']?.length ?? 0) + (context()?.nodes['source']?.length ?? 0);
      const before = count();
      sfx.play(kind);
      const added = count() - before;
      expect(added, kind).toBeGreaterThan(0);
      const nodes = context()?.nodes;
      const fresh = [...(nodes?.['osc'] ?? []).slice(3), ...(nodes?.['source'] ?? []).slice(1)];
      expect(fresh.length, kind).toBe(added);
      expect(
        fresh.every((n) => n.started === 1 && n.stopped === 1),
        kind,
      ).toBe(true);
    }
  });

  it('makes no effects while muted, and the master volume is zero', () => {
    const { sfx, context } = make(true);
    sfx.unlock();
    const master = context()?.nodes['gain']?.[0];
    expect(master?.gain.value).toBe(0);
    const before = context()?.nodes['osc']?.length;
    sfx.play('crash');
    expect(context()?.nodes['osc']?.length).toBe(before);
  });

  it('M toggles the sound, tells the game so it can save it, and brings the volume back', () => {
    const { sfx, context } = make();
    const saved: boolean[] = [];
    sfx.onMuteChange = (m) => saved.push(m);
    sfx.unlock();
    const master = context()?.nodes['gain']?.[0];
    expect(master?.gain.value).toBe(SOUND_MASTER);
    expect(sfx.toggleMute()).toBe(true);
    expect(master?.gain.target).toBe(0);
    expect(sfx.toggleMute()).toBe(false);
    expect(master?.gain.target).toBe(SOUND_MASTER);
    expect(saved).toEqual([true, false]);
  });

  it('goes quiet while paused', () => {
    const { sfx, context } = make();
    sfx.unlock();
    const master = context()?.nodes['gain']?.[0];
    sfx.setPaused(true);
    expect(master?.gain.target).toBe(0);
    sfx.setPaused(false);
    expect(master?.gain.target).toBe(SOUND_MASTER);
  });

  it('moves the engine pitch and the hiss with the car', () => {
    const { sfx, context } = make();
    sfx.unlock();
    const osc = context()?.nodes['osc']?.[0];
    sfx.update({ ...drive, speed: 10 });
    const slow = osc?.frequency.target ?? 0;
    sfx.update({ ...drive, speed: 55 });
    expect(osc?.frequency.target ?? 0).toBeGreaterThan(slow);

    const gains = context()?.nodes['gain'] ?? [];
    const hiss = gains[gains.length - 1]; // the hiss gain is built last
    sfx.update({ ...drive, boosting: true });
    expect(hiss?.gain.target).toBeGreaterThan(0.1);
    sfx.update(drive);
    expect(hiss?.gain.target).toBe(0);
  });
});
