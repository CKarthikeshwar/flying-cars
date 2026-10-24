import { decodeGhost, encodeGhost, type GhostData } from './Ghost';

/** The part of localStorage we use, so tests can supply a stand-in. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PREFIX = 'flyingcars.v1.';

/**
 * Best times and the best-lap ghost for each track, kept in localStorage. No backend.
 * Every read and write is guarded: storage can be missing, blocked or full, and the game must still run.
 */
export class Records {
  private readonly store: KeyValueStore | null;

  constructor(store: KeyValueStore | null) {
    this.store = store;
  }

  bestLap(track: string): number | null {
    return this.readNumber(`${PREFIX}${track}.bestLap`);
  }

  bestRace(track: string): number | null {
    return this.readNumber(`${PREFIX}${track}.bestRace`);
  }

  ghost(track: string): GhostData | null {
    const text = this.read(`${PREFIX}${track}.ghost`);
    return text === null ? null : decodeGhost(text);
  }

  /** Saves a lap if it beats the best. Returns true when it did. */
  saveLap(track: string, lapTime: number, ghost: GhostData | null): boolean {
    const best = this.bestLap(track);
    if (best !== null && lapTime >= best) return false;
    this.write(`${PREFIX}${track}.bestLap`, String(lapTime));
    if (ghost) this.write(`${PREFIX}${track}.ghost`, encodeGhost(ghost));
    return true;
  }

  /** Saves a race time if it beats the best. Returns true when it did. */
  saveRace(track: string, raceTime: number): boolean {
    const best = this.bestRace(track);
    if (best !== null && raceTime >= best) return false;
    this.write(`${PREFIX}${track}.bestRace`, String(raceTime));
    return true;
  }

  private readNumber(key: string): number | null {
    const text = this.read(key);
    if (text === null) return null;
    const value = Number(text);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private read(key: string): string | null {
    try {
      return this.store?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.store?.setItem(key, value);
    } catch {
      // storage full or blocked: carry on without saving
    }
  }
}

/** The browser's localStorage, or null where it cannot be touched (private windows, blocked site data). */
export function browserStore(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
