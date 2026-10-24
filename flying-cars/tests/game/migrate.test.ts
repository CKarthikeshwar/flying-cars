import { describe, expect, it } from 'vitest';
import { migrateOldSaves, type MovableStore } from '../../src/game/migrate';

class Memory implements MovableStore {
  readonly data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('migrateOldSaves', () => {
  it('copies every value saved under the old name to the new name', () => {
    const store = new Memory();
    store.setItem('airhop.v1.Warm-up.bestLap', '71.2');
    store.setItem('airhop.v1.settings', '{"volume":0.5}');
    store.setItem('other', 'x');
    expect(migrateOldSaves(store)).toBe(2);
    expect(store.getItem('flyingcars.v1.Warm-up.bestLap')).toBe('71.2');
    expect(store.getItem('flyingcars.v1.settings')).toBe('{"volume":0.5}');
    expect(store.getItem('flyingcars.v1.other')).toBeNull();
  });

  it('keeps anything already saved under the new name, and does nothing the second time', () => {
    const store = new Memory();
    store.setItem('airhop.v1.settings', 'old');
    store.setItem('flyingcars.v1.settings', 'new');
    expect(migrateOldSaves(store)).toBe(0);
    expect(store.getItem('flyingcars.v1.settings')).toBe('new');
    expect(migrateOldSaves(store)).toBe(0);
  });

  it('copes with no storage, and with storage that refuses', () => {
    expect(migrateOldSaves(null)).toBe(0);
    const broken: MovableStore = {
      length: 1,
      key: () => {
        throw new Error('blocked');
      },
      getItem: () => null,
      setItem: () => {},
    };
    expect(migrateOldSaves(broken)).toBe(0);
  });
});
