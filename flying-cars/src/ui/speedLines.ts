import {
  SPEED_LINES_ALPHA,
  SPEED_LINES_BOOST,
  SPEED_LINES_COUNT,
  SPEED_LINES_FULL,
  SPEED_LINES_START,
} from '../util/constants';
import { clamp } from '../util/math';

/** How strong the speed lines are: 0 below the start speed, 1 at full speed, a little more while boosting. */
export function speedLineLevel(speed: number, boosting: boolean): number {
  const base = clamp((speed - SPEED_LINES_START) / (SPEED_LINES_FULL - SPEED_LINES_START), 0, 1);
  return base === 0 ? 0 : clamp(base + (boosting ? SPEED_LINES_BOOST : 0), 0, 1.3);
}

/** The few drawing calls the streaks need, so a test can stand in for a real canvas. */
export interface LineContext {
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  lineWidth: number;
}

const AIR = '#19e3ff';
const HEAT = '#ff7a1a';
/** Streaks start this far out from the middle (a fraction of the screen half-diagonal), to keep the car clear. */
const INNER = 0.42;
const OUTER = 1.05;

/**
 * Streaks flying outward from the middle of the screen. Each one has a fixed direction and a place along its
 * path that advances with time; the pool is made once, and drawing allocates nothing.
 */
export class SpeedStreaks {
  private readonly cos = new Float32Array(SPEED_LINES_COUNT);
  private readonly sin = new Float32Array(SPEED_LINES_COUNT);
  private readonly phase = new Float32Array(SPEED_LINES_COUNT);
  private readonly pace = new Float32Array(SPEED_LINES_COUNT);

  constructor(random: () => number = Math.random) {
    for (let i = 0; i < SPEED_LINES_COUNT; i++) {
      // evenly spread round the circle with some jitter, so they never bunch
      const angle = ((i + random() * 0.8) / SPEED_LINES_COUNT) * Math.PI * 2;
      this.cos[i] = Math.cos(angle);
      this.sin[i] = Math.sin(angle);
      this.phase[i] = random();
      this.pace[i] = 0.7 + random() * 0.6;
    }
  }

  /** Moves every streak along its path. Faster at higher level. */
  advance(dt: number, level: number): void {
    const rate = (0.9 + level * 1.6) * dt;
    for (let i = 0; i < SPEED_LINES_COUNT; i++) {
      this.phase[i] = ((this.phase[i] as number) + rate * (this.pace[i] as number)) % 1;
    }
  }

  /** Draws the streaks for a screen of the given size. Draws nothing at level 0. */
  draw(ctx: LineContext, width: number, height: number, level: number, boosting: boolean): void {
    ctx.clearRect(0, 0, width, height);
    if (level <= 0) return;
    const cx = width / 2;
    const cy = height / 2;
    const reach = Math.hypot(cx, cy);
    ctx.strokeStyle = boosting ? HEAT : AIR;
    ctx.globalAlpha = SPEED_LINES_ALPHA * Math.min(level, 1);
    ctx.lineWidth = Math.max(1.5, height / 540);
    ctx.beginPath();
    for (let i = 0; i < SPEED_LINES_COUNT; i++) {
      const t = this.phase[i] as number;
      const near = INNER + (OUTER - INNER) * t;
      // the streak stretches as it flies out, and more so at speed
      const far = near + (0.05 + 0.16 * level) * (0.4 + t);
      const dx = this.cos[i] as number;
      const dy = this.sin[i] as number;
      ctx.moveTo(cx + dx * near * reach, cy + dy * near * reach);
      ctx.lineTo(cx + dx * far * reach, cy + dy * far * reach);
    }
    ctx.stroke();
  }
}

/** The streaks on a canvas laid over the 3D view. Does nothing for players who ask for less motion. */
export class SpeedLines {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly streaks = new SpeedStreaks();
  private readonly enabled: boolean;
  private drawn = false;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'speedlines';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    this.ctx = this.canvas.getContext('2d');
    this.enabled = !(
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
    container.appendChild(this.canvas);
  }

  /** Call every frame. `dt` is 0 while paused, so the streaks freeze. */
  update(dt: number, speed: number, boosting: boolean): void {
    if (!this.ctx || !this.enabled) return;
    const level = speedLineLevel(speed, boosting);
    if (level === 0 && !this.drawn) return; // nothing on screen and nothing to show
    if (this.canvas.width !== window.innerWidth || this.canvas.height !== window.innerHeight) {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }
    this.streaks.advance(dt, level);
    this.streaks.draw(this.ctx, this.canvas.width, this.canvas.height, level, boosting);
    this.drawn = level > 0;
  }
}
