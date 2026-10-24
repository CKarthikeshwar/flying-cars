import { formatTime, ordinal } from './hud';
import './results.css';

export interface LapRow {
  lap: number;
  time: number;
  /** Seconds against the best lap before this race: negative is faster. Null when there was no best lap yet. */
  versusBest: number | null;
  /** The fastest lap of this race. */
  fastest: boolean;
}

export interface StandingRow {
  name: string;
  place: number;
  /** Finishing time with penalties, or null for a racer still on the road. */
  time: number | null;
  isPlayer: boolean;
}

export interface ResultsData {
  trackName: string;
  place: number;
  racers: number;
  /** Total race time including penalties. */
  time: number;
  penalty: number;
  /** The new best lap time, when this race set one. */
  newBestLap: number | null;
  laps: LapRow[];
  standings: StandingRow[];
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

function cell(row: HTMLElement, text: string, className = ''): HTMLTableCellElement {
  const td = el('td', className, row, text);
  return td;
}

/** The screen after a race: finishing place, time, laps against the best lap, standings, and what to do next. */
export class ResultsScreen {
  private readonly root: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly onRestart: () => void;
  private readonly onMenu: () => void;
  private open = false;

  constructor(onRestart: () => void, onMenu: () => void) {
    this.onRestart = onRestart;
    this.onMenu = onMenu;
    this.root = el('div', 'results');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Race results');
    this.sheet = el('div', 'sheet', this.root);
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.open;
  }

  show(data: ResultsData): void {
    this.sheet.replaceChildren();

    const top = el('section', 'top enter', this.sheet);
    const place = el('div', 'place', top, String(data.place));
    place.setAttribute('aria-label', `Finished ${data.place}${ordinal(data.place).toLowerCase()}`);
    el('sup', '', place, ordinal(data.place));
    const head = el('div', 'head', top);
    el(
      'h1',
      '',
      head,
      `Finished, ${data.place}${ordinal(data.place).toLowerCase()} of ${data.racers}`,
    );
    el('p', 'track', head, data.trackName);
    const total = el('div', 'total', head);
    el('b', 'num', total, formatTime(data.time));
    if (data.penalty > 0) {
      el('span', 'num', total, `includes +${data.penalty.toFixed(1)} s penalty`);
    }
    if (data.newBestLap !== null) {
      el('div', 'record shown', head, `New best lap ${formatTime(data.newBestLap)}`);
    }

    const grid = el('div', 'grid', this.sheet);

    const lapsBox = el('section', 'box enter', grid);
    el('h2', '', lapsBox, 'Laps');
    const lapsTable = el('table', '', lapsBox);
    const lapsHead = el('tr', '', el('thead', '', lapsTable));
    for (const label of ['Lap', 'Time', 'vs best']) el('th', '', lapsHead, label).scope = 'col';
    const lapsBody = el('tbody', '', lapsTable);
    for (const lap of data.laps) {
      const row = el('tr', lap.fastest ? 'best' : '', lapsBody);
      cell(row, String(lap.lap), 'lbl');
      cell(row, formatTime(lap.time), 'num');
      if (lap.versusBest === null) {
        cell(row, '--', 'num dim');
      } else if (lap.versusBest < 0) {
        cell(row, lap.fastest ? 'new' : lap.versusBest.toFixed(2), 'num ahead');
      } else {
        cell(row, `+${lap.versusBest.toFixed(2)}`, 'num behind');
      }
    }

    const standingsBox = el('section', 'box enter', grid);
    el('h2', '', standingsBox, 'Standings');
    const table = el('table', '', standingsBox);
    const head2 = el('tr', '', el('thead', '', table));
    for (const label of ['Racer', 'Total']) el('th', '', head2, label).scope = 'col';
    const body = el('tbody', '', table);
    for (const s of data.standings) {
      const row = el('tr', s.isPlayer ? 'you' : '', body);
      cell(row, `${s.place}${ordinal(s.place).toLowerCase()}  ${s.name}`, 'lbl');
      cell(
        row,
        s.time === null ? 'racing' : formatTime(s.time),
        s.time === null ? 'num dim' : 'num',
      );
    }

    const actions = el('div', 'actions enter', this.sheet);
    const again = el('button', 'btn primary', actions, 'Race again');
    el('kbd', '', again, 'Enter');
    again.addEventListener('click', () => this.onRestart());
    const menu = el('button', 'btn', actions, 'Menu');
    el('kbd', '', menu, 'Backspace');
    menu.addEventListener('click', () => this.onMenu());

    this.root.classList.add('shown');
    this.open = true;
    again.focus();
  }

  hide(): void {
    this.root.classList.remove('shown');
    this.open = false;
  }
}
