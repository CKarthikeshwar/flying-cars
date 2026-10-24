import { AIR_LOW, AIR_MAX, AIR_SEGMENTS, MS_TO_KMH, POPUP_SECONDS } from '../util/constants';
import { clamp } from '../util/math';
import { controlsList } from './controls';
import './start.css';
import './tokens.css';
import './hud.css';
import './race.css';

export type PopupKind = 'perfect' | 'rough' | 'crash' | 'flip';

/** The keys that are not for driving the car, shown in the corner during a race. */
const OTHER_KEYS: [string, string][] = [
  ['Esc', 'Pause'],
  ['R', 'Respawn'],
  ['C', 'Camera'],
  ['M', 'Sound'],
  ['Backspace', 'Menu'],
];

/** What the race HUD shows. */
export interface RaceReadout {
  place: number;
  racers: number;
  lap: number;
  laps: number;
  /** Race time including penalties, seconds. */
  time: number;
  /** Penalty seconds so far. */
  penalty: number;
  /** Seconds ahead (negative) or behind (positive) the ghost, or null when there is no ghost to compare with. */
  ghostGap: number | null;
}

/** 83.456 becomes "01:23.456". */
export function formatTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

const ORDINALS = ['TH', 'ST', 'ND', 'RD'];
/** 1 becomes ST, 2 ND, 3 RD, 4 TH, 11 TH, 21 ST. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return 'TH';
  return ORDINALS[n % 10] ?? 'TH';
}

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
  private readonly horizon: HTMLElement;
  private readonly horizonArrow: HTMLElement;
  private readonly landing: HTMLElement;
  private readonly pauseScreen: HTMLElement;
  private readonly pauseButtons: HTMLElement;
  private readonly hintBox: HTMLElement;
  private readonly hintKey: HTMLElement;
  private readonly hintTitle: HTMLElement;
  private readonly hintText: HTMLElement;
  private hintSignature = '';
  private readonly pauseInner: HTMLElement;
  private readonly pauseControls: HTMLElement;
  private readonly landingDegrees: HTMLElement;
  private readonly landingHint: HTMLElement;
  private readonly place: HTMLElement;
  private readonly placeOrdinal: HTMLElement;
  private readonly placeOf: HTMLElement;
  private readonly lapText: HTMLElement;
  private readonly timeText: HTMLElement;
  private readonly gapText: HTMLElement;
  private readonly penaltyText: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly countdownText: HTMLElement;
  private popupTimer = 0;
  private shownCountdown = '';

  // Last values written to the DOM, so we only touch it when something changed.
  private shownAir = -1;
  private shownPlace = '';
  private shownLap = '';
  private shownPenalty = -1;
  private shownGapClass = '';
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

    // Race readouts: position top left, lap and timer top centre, countdown in the middle.
    const pos = el('div', 'plate pos race', this.root);
    this.place = el('b', 'num', pos, '1');
    this.placeOrdinal = el('span', 'ord', pos, 'ST');
    this.placeOf = el('span', 'of num', pos, '/ 4');

    const clock = el('div', 'plate clock race', this.root);
    const clockRow = el('div', 'row', clock);
    this.lapText = el('span', 'lap num', clockRow);
    this.timeText = el('span', 'time num', clockRow, '00:00.000');
    const extra = el('div', 'extra', clock);
    this.gapText = el('span', 'gap num', extra);
    this.penaltyText = el('span', 'penalty num', extra);

    this.countdown = el('div', 'countdown race', this.root);
    this.countdownText = el('b', 'num', this.countdown);

    this.popup = el('div', 'pop', this.root);
    this.popupBig = el('div', 'big', this.popup);
    this.popupSub = el('div', 'sub', this.popup);

    el('div', 'vignette', this.root);

    // The pause screen sits on the page itself, above the start, menu and results screens, so it can open over any of them.
    const pause = el('div', 'paused', document.body);
    this.pauseScreen = pause;
    const inner = el('div', '', pause);
    el('b', '', inner, 'PAUSED');
    el('span', 'sub', inner, 'ESC TO RESUME   BACKSPACE FOR THE MENU');
    this.pauseInner = inner;
    this.pauseButtons = el('div', 'actions', inner);
    this.pauseControls = controlsList();
    inner.appendChild(this.pauseControls);

    // A small arrow that points to the real up, shown only when the view is tilted.
    this.horizon = el('div', 'plate horizon', this.root);
    this.horizon.setAttribute('role', 'img');
    this.horizon.setAttribute('aria-label', 'Which way is up');
    this.horizonArrow = el('div', 'arrow', el('div', 'ring', this.horizon));
    el('div', 'cap', this.horizon, 'UP');

    // In the air: how far the car is from the way it needs to be turned to land, and which key turns it.
    this.landing = el('div', 'plate landing', this.root);
    this.landing.setAttribute('role', 'status');
    this.landing.setAttribute('aria-label', 'Landing angle');
    el('div', 'cap', this.landing, 'LAND ANGLE');
    this.landingDegrees = el('div', 'deg', this.landing);
    this.landingHint = el('div', 'hint', this.landing);

    // The keys that are not for driving, in the bottom-left corner while racing.
    const reminder = el('div', 'keyhelp', this.root);
    reminder.setAttribute('aria-label', 'Other keys');
    for (const [key, text] of OTHER_KEYS) {
      const row = el('span', 'row', reminder);
      el('kbd', '', row, key);
      row.append(text);
    }

    // Hints: what is coming up and which key to press, in the upper middle of the screen.
    this.hintBox = el('div', 'hintbox', this.root);
    this.hintBox.setAttribute('role', 'status');
    this.hintKey = el('kbd', 'key', this.hintBox);
    const hintCopy = el('div', 'copy', this.hintBox);
    this.hintTitle = el('b', 'title', hintCopy);
    this.hintText = el('span', 'text', hintCopy);

    this.debugPanel = el('div', 'debug', this.root);
    this.debugPanel.style.display = 'none';

    document.body.appendChild(this.root);
  }

  /** Updates the readouts. Call once per rendered frame. */
  update(
    air: number,
    speedMs: number,
    boosting: boolean,
    crashed: boolean,
    charging = false,
  ): void {
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
    this.air.classList.toggle('charging', charging);
  }

  /** Turns the race readouts on or off. They are off in the flat sandbox. */
  setRace(on: boolean): void {
    this.root.classList.toggle('is-race', on);
  }

  /** Updates position, lap, timer, ghost gap and penalty. */
  updateRace(r: RaceReadout): void {
    const place = `${r.place}/${r.racers}`;
    if (place !== this.shownPlace) {
      this.shownPlace = place;
      this.place.textContent = String(r.place);
      this.placeOrdinal.textContent = ordinal(r.place);
      this.placeOf.textContent = `/ ${r.racers}`;
    }
    const lapNow = Math.min(Math.max(r.lap, 1), r.laps);
    const lap = `${lapNow}/${r.laps}`;
    if (lap !== this.shownLap) {
      this.shownLap = lap;
      this.lapText.innerHTML = `LAP <b>${lapNow}</b>/${r.laps}`;
    }
    this.timeText.textContent = formatTime(r.time);

    if (r.ghostGap === null) {
      if (this.shownGapClass !== 'none') {
        this.shownGapClass = 'none';
        this.gapText.className = 'gap num';
      }
    } else {
      const ahead = r.ghostGap <= 0;
      const side = ahead ? 'ahead' : 'behind';
      if (this.shownGapClass !== side) {
        this.shownGapClass = side;
        this.gapText.className = `gap num shown ${side}`;
      }
      this.gapText.textContent = `${ahead ? '-' : '+'}${Math.abs(r.ghostGap).toFixed(2)}`;
    }

    const penalty = Math.round(r.penalty * 10);
    if (penalty !== this.shownPenalty) {
      this.shownPenalty = penalty;
      this.penaltyText.className = r.penalty > 0 ? 'penalty num shown' : 'penalty num';
      if (r.penalty > 0) this.penaltyText.textContent = `+${r.penalty.toFixed(1)} S`;
    }
  }

  /** The big countdown number, "GO", or nothing (null). */
  showCountdown(text: string | null): void {
    const shown = text ?? '';
    if (shown === this.shownCountdown) return;
    this.shownCountdown = shown;
    this.countdown.classList.toggle('shown', text !== null);
    this.countdown.classList.toggle('go', text === 'GO');
    if (text !== null) {
      // re-add the element so its animation starts again for each number
      this.countdownText.remove();
      this.countdownText.textContent = text;
      this.countdown.appendChild(this.countdownText);
    }
  }

  /** Shows a short event message above the car. It clears itself. */
  showPopup(kind: PopupKind, big: string, sub = '', small = false): void {
    this.popupBig.textContent = big;
    this.popupSub.textContent = sub;
    this.popup.className = `pop ${kind}${small ? ' small' : ''}`;
    void this.popup.offsetWidth; // restart the animation
    this.popup.classList.add('show');
    window.clearTimeout(this.popupTimer);
    this.popupTimer = window.setTimeout(
      () => this.popup.classList.remove('show'),
      POPUP_SECONDS * 1000,
    );
  }

  /** Flashes the gauge when an action needs air the tank does not have. */
  flashEmpty(): void {
    this.air.classList.remove('empty-flash');
    void this.air.offsetWidth;
    this.air.classList.add('empty-flash');
  }

  /**
   * Shows a hint, or hides it with null. Only touches the page when the hint changes, so calling it every frame is cheap.
   */
  setHint(hint: { title: string; text: string; key: string | null; now: boolean } | null): void {
    const signature = hint ? `${hint.title}|${hint.text}|${hint.key}|${hint.now}` : '';
    if (signature === this.hintSignature) return;
    this.hintSignature = signature;
    this.hintBox.classList.toggle('shown', hint !== null);
    if (!hint) return;
    this.hintBox.classList.toggle('now', hint.now);
    this.hintKey.textContent = hint.key ?? '';
    this.hintKey.style.display = hint.key ? '' : 'none';
    this.hintTitle.textContent = hint.title;
    this.hintText.textContent = hint.text;
  }

  /**
   * The buttons on the pause screen. Resume is always there; restart and the track menu only when a race is
   * loaded (on the menu itself there is nothing to restart).
   */
  setPauseButtons(actions: {
    resume: () => void;
    restart: (() => void) | null;
    menu: (() => void) | null;
  }): void {
    this.pauseButtons.replaceChildren();
    const add = (text: string, key: string, action: () => void, primary = false): void => {
      const b = el('button', primary ? 'btn primary' : 'btn', this.pauseButtons, text);
      if (key) el('kbd', '', b, key);
      b.addEventListener('click', action);
    };
    add('Resume', 'Esc', actions.resume, true);
    if (actions.restart) add('Restart race', '', actions.restart);
    if (actions.menu) add('Track menu', 'Backspace', actions.menu);
  }

  /** Puts the settings panel on the pause screen, above the controls list. */
  addSettings(panel: HTMLElement): void {
    this.pauseInner.insertBefore(panel, this.pauseControls);
  }

  setPaused(paused: boolean): void {
    this.root.classList.toggle('is-paused', paused);
    this.pauseScreen.classList.toggle('open', paused);
  }

  /**
   * Points the "up" arrow. `degrees` is the direction of real up on the screen, clockwise from the top.
   * The arrow only shows when the view is tilted by more than `showAbove` degrees.
   */
  setHorizon(degrees: number, showAbove = 20): void {
    const tilted = Math.abs(degrees) > showAbove;
    this.horizon.classList.toggle('shown', tilted);
    if (tilted) this.horizonArrow.style.transform = `rotate(${degrees.toFixed(1)}deg)`;
  }

  /**
   * The landing guide, shown while the car is in the air. `degrees` is how far the car is from level with the
   * surface it will land on, `key` the key that turns it the right way (Q, E, W or S). Null hides it.
   * Green is a Perfect landing (under 30 degrees), amber a rough one, red a crash (over 60).
   */
  setLanding(info: { degrees: number; key: string } | null): void {
    this.landing.classList.toggle('shown', info !== null);
    if (info === null) return;
    const state = info.degrees < 30 ? 'good' : info.degrees < 60 ? 'warn' : 'bad';
    this.landing.dataset['state'] = state;
    this.landingDegrees.textContent = String(Math.round(info.degrees));
    this.landingHint.textContent = info.degrees < 30 ? 'HOLD' : `PRESS ${info.key}`;
  }

  /** A short message in the middle of the screen, for settings changes such as the camera mode. */
  showNote(text: string): void {
    this.showPopup('flip', text, '', true);
  }
}
