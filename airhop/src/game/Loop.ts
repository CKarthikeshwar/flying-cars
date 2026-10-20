import { MAX_FRAME_TIME, PHYSICS_DT } from '../util/constants';

/**
 * Fixed-timestep accumulator. Feed it the real frame time; it runs `step` zero or more times
 * at exactly PHYSICS_DT and returns how far into the next step we are (0..1) for render interpolation.
 * The frame time is capped so a long stall makes the game slow down instead of spiralling.
 */
export class Accumulator {
  private left = 0;

  tick(frameTime: number, step: () => void): number {
    this.left += Math.min(frameTime, MAX_FRAME_TIME);
    while (this.left >= PHYSICS_DT) {
      step();
      this.left -= PHYSICS_DT;
    }
    return this.left / PHYSICS_DT;
  }

  reset(): void {
    this.left = 0;
  }
}

/** Drives `step` at a fixed rate and `render` at the display rate. */
export class Loop {
  private readonly acc = new Accumulator();
  private readonly step: () => void;
  private readonly render: (alpha: number, frameTime: number) => void;
  private readonly timeScale: () => number;
  private last = 0;
  private running = false;

  constructor(
    step: () => void,
    render: (alpha: number, frameTime: number) => void,
    timeScale: () => number,
  ) {
    this.step = step;
    this.render = render;
    this.timeScale = timeScale;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const frameTime = (now - this.last) / 1000;
    this.last = now;
    const alpha = this.acc.tick(frameTime * this.timeScale(), this.step);
    this.render(alpha, frameTime);
    requestAnimationFrame(this.frame);
  };
}
