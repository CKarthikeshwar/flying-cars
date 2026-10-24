/** The part of the browser's storage the move needs: reading its keys, and reading and writing values. */
export interface MovableStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const OLD_PREFIX = 'airhop.v1.';
const NEW_PREFIX = 'flyingcars.v1.';

/**
 * The game used to be called AirHop and saved its data under that name. Copies everything saved that way to the
 * new name, once, so nobody loses their best laps, ghosts or settings. Anything already saved under the new
 * name is kept. Returns how many values were copied.
 */
export function migrateOldSaves(store: MovableStore | null): number {
  if (!store) return 0;
  let copied = 0;
  try {
    const old: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(OLD_PREFIX)) old.push(key);
    }
    for (const key of old) {
      const target = NEW_PREFIX + key.slice(OLD_PREFIX.length);
      const value = store.getItem(key);
      if (value !== null && store.getItem(target) === null) {
        store.setItem(target, value);
        copied++;
      }
    }
  } catch {
    // storage blocked or full: the game still runs, just without the old saves
  }
  return copied;
}
