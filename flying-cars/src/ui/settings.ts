import { SETTING_DEFS, SettingsCursor, type SettingDef, type Settings } from '../game/settings';
import './settings.css';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

/** How a value is shown: a percentage, so volume and shake read the same way. */
export function formatSetting(def: SettingDef, value: number): string {
  if (def.format === 'toggle') return value >= 1 ? 'ON' : 'OFF';
  return `${Math.round(value * 100)}%`;
}

/**
 * The settings screen's panel: one row for each setting, a slider you can drag, and keys to use it without the
 * mouse (up and down pick a row, left and right change it). It shows what `Settings` holds and writes back to it.
 */
export class SettingsPanel {
  readonly element: HTMLElement;
  private readonly rows: {
    def: SettingDef;
    row: HTMLElement;
    input: HTMLInputElement;
    out: HTMLElement;
  }[] = [];
  private readonly cursor: SettingsCursor;
  private readonly settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
    this.cursor = new SettingsCursor(settings);
    this.element = el('section', 'settings');
    el('h3', '', this.element, 'Settings');
    for (const def of SETTING_DEFS) {
      const row = el('div', 'setting', this.element);
      el('label', 'name', row, def.label);
      const input = el('input', 'slider', row);
      input.type = 'range';
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step);
      input.setAttribute('aria-label', def.label);
      const out = el('output', 'value num', row);
      input.addEventListener('input', () => {
        settings.set(def.key, Number(input.value));
        this.refresh();
      });
      row.addEventListener('pointerdown', () => {
        this.cursor.select(this.rows.findIndex((r) => r.row === row));
        this.refresh();
      });
      this.rows.push({ def, row, input, out });
    }
    el(
      'p',
      'hint',
      this.element,
      'Up and down pick a setting, left and right change it. M turns sound off and on. Hints stop on their own once you have done each thing three times.',
    );
    this.refresh();
  }

  /** Up (-1) or down (+1) to the next row. */
  move(direction: number): void {
    this.cursor.move(direction);
    this.refresh();
  }

  /** Left (-1) or right (+1) on the picked row: one step. */
  adjust(direction: number): void {
    this.cursor.adjust(direction);
    this.refresh();
  }

  /** Brings the sliders and numbers up to date with the settings. */
  refresh(): void {
    this.rows.forEach(({ def, row, input, out }, i) => {
      const value = this.settings.get(def.key);
      input.value = String(value);
      out.textContent = formatSetting(def, value);
      row.classList.toggle('selected', i === this.cursor.selected);
    });
  }
}
