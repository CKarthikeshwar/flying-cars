import type { KeyValueStore } from './records';

/** One setting the player can change: its name on screen, its range and the size of one step. */
export interface SettingDef {
  key: 'volume' | 'shake' | 'hints';
  label: string;
  /** How the number is shown: a percentage, or ON and OFF for a switch. */
  format: 'percent' | 'toggle';
  min: number;
  max: number;
  step: number;
  fallback: number;
}

/** The settings, in the order they appear on the screen. */
export const SETTING_DEFS: SettingDef[] = [
  { key: 'volume', label: 'Volume', format: 'percent', min: 0, max: 1, step: 0.1, fallback: 0.8 },
  {
    key: 'shake',
    label: 'Camera shake',
    format: 'percent',
    min: 0,
    max: 2,
    step: 0.25,
    fallback: 1,
  },
  { key: 'hints', label: 'Hints', format: 'toggle', min: 0, max: 1, step: 1, fallback: 1 },
];

export const SETTINGS_KEY = 'flyingcars.v1.settings';

export type SettingValues = Record<SettingDef['key'], number>;

/** Rounds to the step, so repeated steps never drift (0.1 + 0.1 + 0.1 is not quite 0.3). */
function snap(def: SettingDef, value: number): number {
  const clamped = Math.min(def.max, Math.max(def.min, value));
  const steps = Math.round((clamped - def.min) / def.step);
  return Math.min(def.max, Math.max(def.min, Number((def.min + steps * def.step).toFixed(4))));
}

/** Which setting is picked on the settings screen, and the keys that move and change it. No screen in here. */
export class SettingsCursor {
  /** Index into SETTING_DEFS. */
  selected = 0;
  private readonly settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  get current(): SettingDef {
    return SETTING_DEFS[this.selected] as SettingDef;
  }

  /** Up (-1) or down (+1) to the next setting, wrapping round. */
  move(direction: number): void {
    const n = SETTING_DEFS.length;
    this.selected = (((this.selected + Math.sign(direction)) % n) + n) % n;
  }

  /** Left (-1) or right (+1): one step on the picked setting. */
  adjust(direction: number): void {
    this.settings.nudge(this.current.key, Math.sign(direction));
  }

  select(index: number): void {
    if (index >= 0 && index < SETTING_DEFS.length) this.selected = index;
  }
}

/**
 * What the player has chosen: volume and camera shake. Kept in the browser, loaded when the game starts, and
 * saved every time one changes. Knows nothing about sound or the camera: the game listens and applies them.
 */
export class Settings {
  private readonly values: SettingValues = { volume: 0.8, shake: 1, hints: 1 };
  private readonly store: KeyValueStore | null;

  /** Called after any setting changes. */
  onChange: (values: Readonly<SettingValues>) => void = () => {};

  constructor(store: KeyValueStore | null) {
    this.store = store;
    for (const def of SETTING_DEFS) this.values[def.key] = def.fallback;
    this.load();
  }

  get volume(): number {
    return this.values.volume;
  }

  get shake(): number {
    return this.values.shake;
  }

  /** Whether the on-screen hints are on. */
  get hints(): boolean {
    return this.values.hints >= 1;
  }

  get(key: SettingDef['key']): number {
    return this.values[key];
  }

  /** Sets one setting, kept inside its range and on its steps. */
  set(key: SettingDef['key'], value: number): void {
    const def = SETTING_DEFS.find((d) => d.key === key);
    if (!def || !Number.isFinite(value)) return;
    const next = snap(def, value);
    if (next === this.values[key]) return;
    this.values[key] = next;
    this.save();
    this.onChange(this.values);
  }

  /** Moves one setting by a number of steps (negative for down). */
  nudge(key: SettingDef['key'], steps: number): void {
    const def = SETTING_DEFS.find((d) => d.key === key);
    if (def) this.set(key, this.values[key] + steps * def.step);
  }

  private load(): void {
    try {
      const text = this.store?.getItem(SETTINGS_KEY);
      if (!text) return;
      const data: unknown = JSON.parse(text);
      if (typeof data !== 'object' || data === null) return;
      for (const def of SETTING_DEFS) {
        const value = (data as Record<string, unknown>)[def.key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          this.values[def.key] = snap(def, value);
        }
      }
    } catch {
      // unreadable or missing: keep the defaults
    }
  }

  private save(): void {
    try {
      this.store?.setItem(SETTINGS_KEY, JSON.stringify(this.values));
    } catch {
      // not saved: still works for this visit
    }
  }
}
