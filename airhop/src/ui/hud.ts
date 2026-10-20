import { AIR_LOW, AIR_MAX, AIR_SEGMENTS, MS_TO_KMH, POPUP_SECONDS } from '../util/constants';
import { clamp } from '../util/math';
import './tokens.css';
import './hud.css';

export type PopupKind = 'perfect' | 'rough' | 'crash' | 'flip';

const SPEED_BAR_FULL = 85 * MS_TO_KMH; // km/h at the top of the speed bar (boosted top speed)

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

/** The in-race HUD: air gauge, speed, and event pop-ups. Plain DOM over the canvas, never rotates with the car. */
export class Hud {
  readonly root: HTMLElement;
  private readonly air: HTMLElement;
  private readonly airValue: HTMLElement;
  private readonly segments: HTMLElement[] = [];
  private readonly speed: HTMLElement;
  private readonly speedBar: HTMLElement;
  private readonly popup: HTMLElement;
  private readonly popupBig: HTMLElement;
  private readonly popupSub: HTMLElement;
  readonly debugPanel: HTMLElement;
  private popupTimer = 0;

  // Last values written to the DOM, so we only touch it when something changed.
  private shownAir = -1;
  private shownSpeed = -1;
  private shownBar = -1;

  constructor() {
    this.root = el('div', '');
    this.root.id = 'hud';

    this.air = el('div', 'plate air', this.root);
    this.air.setAttribute('role', 'img');
    this.air.setAttribute('aria-label', 'Air tank');
    el('div', 'label', this.air, 'Air');
    this.airValue = el('div', 'val num', this.air, '100');
    const tank = el('div', 'tank', this.air);
    for (let i = 0; i < AIR_SEGMENTS; i++) this.segments.push(el('div', 'seg', tank));
    el('div', 'warn', this.air, 'LOW');

    const speedBox = el('div', 'plate speed', this.root);
    const row = el('div', '', speedBox);
    this.speed = el('span', 'n num', row, '0');
    el('span', 'u', row, 'KM/H');
    const bar = el('div', 'bar', speedBox);
    this.speedBar = el('i', '', bar);

    this.popup = el('div', 'pop', this.root);
    this.popupBig = el('div', 'big', this.popup);
    this.popupSub = el('div', 'sub', this.popup);

    el('div', 'vignette', this.root);

    const pause = el('div', 'paused', this.root);
    const inner = el('div', '', pause);
    el('b', '', inner, 'PAUSED');
    el('span', '', inner, 'ESC TO RESUME');

    this.debugPanel = el('div', 'debug', this.root);
    this.debugPanel.style.display = 'none';

    document.body.appendChild(this.root);
  }

  /** Updates the readouts. Call once per rendered frame. */
  update(air: number, speedMs: number, boosting: boolean, crashed: boolean): void {
    const whole = Math.round(air);
    if (whole !== this.shownAir) {
      this.shownAir = whole;
      this.airValue.textContent = String(whole);
      const lit = Math.round((clamp(air, 0, AIR_MAX) / AIR_MAX) * AIR_SEGMENTS);
      this.segments.forEach((s, i) => s.classList.toggle('on', i < lit));
      this.air.classList.toggle('low', air < AIR_LOW);
    }
    const kmh = Math.round(speedMs * MS_TO_KMH);
    if (kmh !== this.shownSpeed) {
      this.shownSpeed = kmh;
      this.speed.textContent = String(kmh);
    }
    const bar = Math.round(clamp(kmh / SPEED_BAR_FULL, 0, 1) * 100);
    if (bar !== this.shownBar) {
      this.shownBar = bar;
      this.speedBar.style.width = `${bar}%`;
    }
    this.root.classList.toggle('boosting', boosting);
    this.root.classList.toggle('crashed', crashed);
  }

  /** Shows a short event message above the car. It clears itself. */
  showPopup(kind: PopupKind, big: string, sub = '', small = false): void {
    this.popupBig.textContent = big;
    this.popupSub.textContent = sub;
    this.popup.className = `pop ${kind}${small ? ' small' : ''}`;
    void this.popup.offsetWidth; // restart the animation
    this.popup.classList.add('show');
    window.clearTimeout(this.popupTimer);
    this.popupTimer = window.setTimeout(() => this.popup.classList.remove('show'), POPUP_SECONDS * 1000);
  }

  /** Flashes the gauge when an action needs air the tank does not have. */
  flashEmpty(): void {
    this.air.classList.remove('empty-flash');
    void this.air.offsetWidth;
    this.air.classList.add('empty-flash');
  }

  setPaused(paused: boolean): void {
    this.root.classList.toggle('is-paused', paused);
  }
}
