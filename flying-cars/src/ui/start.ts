import { controlsList } from './controls';
import { formatTime } from './hud';
import './start.css';

export interface StartInfo {
  trackName: string;
  bestLap: number | null;
}

/** The screen before a race: where you are racing, your best lap, the controls, and a button to begin. */
export class StartScreen {
  private readonly root: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly onStart: () => void;
  private readonly onMenu: () => void;
  private readonly onSettings: () => void;
  private open = false;

  constructor(
    onStart: () => void,
    onMenu: () => void = () => {},
    onSettings: () => void = () => {},
  ) {
    this.onStart = onStart;
    this.onMenu = onMenu;
    this.onSettings = onSettings;
    this.root = document.createElement('div');
    this.root.className = 'start';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Start screen');
    this.sheet = document.createElement('div');
    this.sheet.className = 'sheet';
    this.root.appendChild(this.sheet);
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.open;
  }

  show(info: StartInfo): void {
    this.sheet.replaceChildren();

    const head = document.createElement('div');
    const logo = document.createElement('div');
    logo.className = 'logo';
    logo.append('Flying ');
    const hop = document.createElement('em');
    hop.textContent = 'Cars';
    logo.appendChild(hop);
    const where = document.createElement('div');
    where.className = 'where';
    const name = document.createElement('b');
    name.textContent = info.trackName;
    const best = document.createElement('span');
    best.textContent =
      info.bestLap === null ? 'No lap time yet' : `Best lap ${formatTime(info.bestLap)}`;
    where.append(name, best);
    head.append(logo, where);
    this.sheet.appendChild(head);

    this.sheet.appendChild(controlsList());

    const go = document.createElement('button');
    go.className = 'go';
    go.textContent = 'Start race';
    const key = document.createElement('kbd');
    key.textContent = 'Enter';
    go.appendChild(key);
    go.addEventListener('click', () => this.onStart());
    const row = document.createElement('div');
    row.className = 'actions';
    row.appendChild(go);
    const link = (text: string, action: () => void) => {
      const b = document.createElement('button');
      b.className = 'link';
      b.textContent = text;
      b.addEventListener('click', action);
      row.appendChild(b);
    };
    link('Track menu', () => this.onMenu());
    link('Settings', () => this.onSettings());
    this.sheet.appendChild(row);

    this.root.classList.add('shown');
    this.open = true;
    go.focus();
  }

  hide(): void {
    this.root.classList.remove('shown');
    this.open = false;
  }
}
