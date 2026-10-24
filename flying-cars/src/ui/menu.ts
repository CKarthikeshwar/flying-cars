import type { Track } from '../track/Track';
import { controlsList } from './controls';
import { formatTime } from './hud';
import './menu.css';

export type TrackFeature = 'wall' | 'ceiling' | 'gap' | 'loop' | 'climb';

/** One row of the track list. */
export interface MenuEntry {
  id: string;
  name: string;
  blurb: string;
  features: TrackFeature[];
  /** Builds the track, for the map. Called once per entry, when it is first shown. */
  track: () => Track;
  bestLap: number | null;
  bestRace: number | null;
  hasGhost: boolean;
}

const ICONS: Record<TrackFeature, string> = {
  wall: '<svg viewBox="0 0 24 24"><path d="M4 20h7V6M11 6l5-3"/><path d="M16 3v18"/></svg>',
  ceiling: '<svg viewBox="0 0 24 24"><path d="M3 5h18"/><path d="M8 5v6l4 4 4-4V5"/></svg>',
  gap: '<svg viewBox="0 0 24 24"><path d="M3 16h6M15 16h6"/><path d="M7 11c2-6 8-6 10 0"/></svg>',
  loop: '<svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="6"/><path d="M3 20c5 0 7-3 9-4M21 20c-5 0-7-3-9-4"/></svg>',
  climb:
    '<svg viewBox="0 0 24 24"><path d="M3 20c6 0 4-8 9-8s3-8 9-8"/><path d="M17 4h4v4"/></svg>',
};
const FEATURE_NAMES: Record<TrackFeature, string> = {
  wall: 'Wall',
  ceiling: 'Ceiling',
  gap: 'Gap',
  loop: 'Loop',
  climb: 'Climb',
};

const MAP_WIDTH = 400;
const MAP_HEIGHT = 220;
const MAP_MARGIN = 14;

/** The outline of a track seen from above, as an SVG path, plus where its features are, scaled to the map box. */
export function trackOutline(track: Track): {
  path: string;
  start: [number, number];
  charges: [number, number][];
  gaps: [number, number][];
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const f of track.frames) {
    minX = Math.min(minX, f.position.x);
    maxX = Math.max(maxX, f.position.x);
    minZ = Math.min(minZ, f.position.z);
    maxZ = Math.max(maxZ, f.position.z);
  }
  // Fit the track in the box, turned so its long side runs left to right.
  const alongX = maxX - minX >= maxZ - minZ;
  const spanA = Math.max(1, alongX ? maxX - minX : maxZ - minZ);
  const spanB = Math.max(1, alongX ? maxZ - minZ : maxX - minX);
  const scale = Math.min(
    (MAP_WIDTH - 2 * MAP_MARGIN) / spanA,
    (MAP_HEIGHT - 2 * MAP_MARGIN) / spanB,
  );
  const offsetA = (MAP_WIDTH - spanA * scale) / 2;
  const offsetB = (MAP_HEIGHT - spanB * scale) / 2;
  const project = (i: number): [number, number] => {
    const p = (track.frames[((i % track.count) + track.count) % track.count] ?? track.frames[0])
      ?.position;
    if (!p) return [0, 0];
    const a = alongX ? p.x - minX : p.z - minZ;
    const b = alongX ? p.z - minZ : p.x - minX;
    return [offsetA + a * scale, offsetB + b * scale];
  };

  const step = Math.max(1, Math.round(track.count / 220));
  const parts: string[] = [];
  for (let i = 0; i < track.count; i += step) {
    const [x, y] = project(i);
    parts.push(`${parts.length === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  parts.push('Z');

  return {
    path: parts.join(' '),
    start: project(track.startIndex),
    charges: track.charges.map((c) => project(Math.round((c.first + c.last) / 2))),
    gaps: track.gaps.map((g) => project(Math.round((g.first + g.last) / 2))),
  };
}

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

/** Track select: a list on the left, a preview with a map and your best times on the right. */
export class TrackMenu {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly help: HTMLElement;
  private readonly onRace: (id: string) => void;
  private readonly onSettings: () => void;
  private readonly firstTime: HTMLElement;
  private entries: MenuEntry[] = [];
  private selected = 0;
  private open = false;
  private readonly outlines = new Map<string, ReturnType<typeof trackOutline>>();

  constructor(onRace: (id: string) => void, onSettings: () => void = () => {}) {
    this.onRace = onRace;
    this.onSettings = onSettings;
    this.root = el('div', 'menu');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Track select');

    const header = el('header', '', this.root);
    const logo = el('div', 'logo', header, 'Flying ');
    el('em', '', logo, 'Cars');
    el('small', '', logo, 'Pick a track');
    this.firstTime = el(
      'p',
      'first',
      header,
      'New here? Start with Warm-up. Click a track, then Race.',
    );

    const main = el('main', '', this.root);
    const left = el('section', '', main);
    el('h2', '', left, 'Tracks');
    this.list = el('div', 'list', left);
    this.list.setAttribute('role', 'listbox');
    this.preview = el('section', 'preview', main);
    this.preview.setAttribute('aria-live', 'polite');

    this.help = el('div', 'help', this.root);
    this.help.appendChild(controlsList());

    const footer = el('footer', '', this.root);
    const keys = el('div', 'keys', footer);
    const hint = (key: string, text: string, action?: () => void) => {
      const span = el(action ? 'button' : 'span', action ? 'keybtn' : '', keys);
      el('kbd', '', span, key);
      span.append(text);
      if (action) span.addEventListener('click', action);
    };
    hint('Up', 'Choose');
    hint('Down', '');
    hint('Enter', 'Race');
    hint('H', 'Controls', () => this.toggleHelp());
    hint('Esc', 'Settings', () => this.onSettings());
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.open;
  }

  /** The id of the track under the cursor. */
  get selectedId(): string | undefined {
    return this.entries[this.selected]?.id;
  }

  show(entries: MenuEntry[], selectId?: string): void {
    this.entries = entries;
    const index = entries.findIndex((e) => e.id === selectId);
    this.selected = index >= 0 ? index : Math.min(this.selected, entries.length - 1);
    // a new player is told where to begin
    this.firstTime.style.display = entries.every((e) => e.bestLap === null) ? '' : 'none';
    this.root.classList.add('shown');
    this.open = true;
    this.render();
  }

  hide(): void {
    this.root.classList.remove('shown');
    this.open = false;
  }

  move(delta: number): void {
    if (!this.open || this.entries.length === 0) return;
    this.selected = (this.selected + delta + this.entries.length) % this.entries.length;
    this.render();
  }

  confirm(): void {
    const id = this.selectedId;
    if (this.open && id) this.onRace(id);
  }

  toggleHelp(): void {
    if (this.open) this.help.classList.toggle('shown');
  }

  private render(): void {
    this.list.replaceChildren();
    this.entries.forEach((entry, i) => {
      const row = el('button', 'track', this.list);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === this.selected));
      el('span', 'name num', row, entry.name);
      const best = el('span', `best num${entry.bestLap === null ? ' none' : ''}`, row);
      el('b', '', best, entry.bestLap === null ? '--:--.---' : formatTime(entry.bestLap));
      el('span', '', best, entry.bestLap === null ? 'No time yet' : 'Best lap');
      el('span', 'blurb', row, entry.blurb);
      row.addEventListener('click', () => {
        if (this.selected === i) this.confirm();
        else {
          this.selected = i;
          this.render();
        }
      });
    });

    const entry = this.entries[this.selected];
    this.preview.replaceChildren();
    if (!entry) return;

    const top = el('div', '', this.preview);
    el('h1', '', top, entry.name);
    el('p', 'desc', top, entry.blurb);
    const tags = el('div', 'tags', top);
    for (const f of entry.features) {
      const tag = el('span', 'tag', tags);
      tag.innerHTML = ICONS[f]; // fixed icon markup from this file, never user text
      tag.append(FEATURE_NAMES[f]);
    }

    this.renderMap(entry);

    const stats = el('div', 'stats', this.preview);
    const stat = (label: string, value: string, className = '') => {
      const box = el('div', 'stat', stats);
      el('span', '', box, label);
      el('b', `num ${className}`, box, value);
    };
    stat('Best lap', entry.bestLap === null ? '--:--.---' : formatTime(entry.bestLap));
    stat('Best 3-lap race', entry.bestRace === null ? '--:--.---' : formatTime(entry.bestRace));
    stat('Ghost', entry.hasGhost ? 'Saved' : 'None', 'ghost');
    const go = el('button', 'go', stats, 'Race');
    go.addEventListener('click', () => this.confirm());
  }

  private renderMap(entry: MenuEntry): void {
    const map = el('div', 'map', this.preview);
    map.setAttribute('aria-hidden', 'true');
    let outline = this.outlines.get(entry.id);
    if (!outline) {
      outline = trackOutline(entry.track());
      this.outlines.set(entry.id, outline);
    }
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const add = (tag: string, attrs: Record<string, string>): SVGElement => {
      const node = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      svg.appendChild(node);
      return node as SVGElement;
    };
    add('path', { d: outline.path, class: 'road' });
    const line = add('path', { d: outline.path, class: 'line draw' });
    const length = (line as unknown as SVGPathElement).getTotalLength?.() ?? 1000;
    line.style.setProperty('--len', String(length));
    for (const [x, y] of outline.charges)
      add('circle', { cx: String(x), cy: String(y), r: '5', class: 'map-charge' });
    for (const [x, y] of outline.gaps)
      add('circle', { cx: String(x), cy: String(y), r: '5', class: 'map-gap' });
    add('rect', {
      x: String(outline.start[0] - 3),
      y: String(outline.start[1] - 12),
      width: '6',
      height: '24',
      class: 'map-start',
    });
    map.appendChild(svg);

    const legend = el('div', 'legend', map);
    const key = (color: string, text: string) => {
      const span = el('span', '', legend);
      const swatch = el('i', '', span);
      swatch.style.background = color;
      span.append(text);
    };
    key('var(--charge)', 'Charge strip');
    key('var(--alarm)', 'Gap');
  }
}
