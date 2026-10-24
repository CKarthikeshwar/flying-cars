import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { GhostRecorder, type GhostData } from '../../src/game/Ghost';
import { Records, type KeyValueStore } from '../../src/game/records';

/** A stand-in for localStorage that outlives any one Records object, like a browser does across reloads. */
class MemoryStore implements KeyValueStore {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

function sampleGhost(lapTime: number): GhostData {
  const rec = new GhostRecorder();
  rec.begin();
  for (let i = 1; i <= 30; i++) rec.offer(i / 30, new Vector3(i, 0, 0), new Quaternion(), i);
  const data = rec.finish(lapTime);
  if (!data) throw new Error('no ghost');
  return data;
}

describe('Records', () => {
  it('has nothing at first', () => {
    const r = new Records(new MemoryStore());
    expect(r.bestLap('test')).toBeNull();
    expect(r.bestRace('test')).toBeNull();
    expect(r.ghost('test')).toBeNull();
  });

  it('keeps the best lap and its ghost after a page reload', () => {
    const store = new MemoryStore();
    new Records(store).saveLap('test', 42.5, sampleGhost(42.5));
    const afterReload = new Records(store); // a new page load: new objects, same storage
    expect(afterReload.bestLap('test')).toBe(42.5);
    expect(afterReload.ghost('test')?.lapTime).toBe(42.5);
    expect(afterReload.ghost('test')?.samples.length).toBe(30 * 9);
  });

  it('only replaces a record with a better one', () => {
    const r = new Records(new MemoryStore());
    expect(r.saveLap('test', 50, sampleGhost(50))).toBe(true);
    expect(r.saveLap('test', 55, sampleGhost(55))).toBe(false);
    expect(r.saveLap('test', 50, sampleGhost(50))).toBe(false);
    expect(r.saveLap('test', 45, sampleGhost(45))).toBe(true);
    expect(r.bestLap('test')).toBe(45);
    expect(r.ghost('test')?.lapTime).toBe(45);
  });

  it('keeps each track separate, and laps separate from races', () => {
    const r = new Records(new MemoryStore());
    r.saveLap('warm-up', 40, null);
    r.saveRace('warm-up', 125);
    expect(r.bestLap('gap-run')).toBeNull();
    expect(r.bestLap('warm-up')).toBe(40);
    expect(r.bestRace('warm-up')).toBe(125);
    expect(r.saveRace('warm-up', 130)).toBe(false);
    expect(r.saveRace('warm-up', 120)).toBe(true);
  });

  it('ignores damaged saved data', () => {
    const store = new MemoryStore();
    store.setItem('flyingcars.v1.test.bestLap', 'not a number');
    store.setItem('flyingcars.v1.test.bestRace', '-4');
    store.setItem('flyingcars.v1.test.ghost', 'garbage');
    const r = new Records(store);
    expect(r.bestLap('test')).toBeNull();
    expect(r.bestRace('test')).toBeNull();
    expect(r.ghost('test')).toBeNull();
    expect(r.saveLap('test', 50, null)).toBe(true);
  });

  it('carries on when storage is missing, blocked or full', () => {
    expect(new Records(null).saveLap('test', 50, null)).toBe(true);
    expect(new Records(null).bestLap('test')).toBeNull();

    const hostile: KeyValueStore = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('quota exceeded');
      },
    };
    const r = new Records(hostile);
    expect(r.bestLap('test')).toBeNull();
    expect(() => r.saveLap('test', 50, sampleGhost(50))).not.toThrow();
    expect(() => r.saveRace('test', 150)).not.toThrow();
  });
});
