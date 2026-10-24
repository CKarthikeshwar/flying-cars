import { describe, expect, it } from 'vitest';
import { SpeedStreaks, speedLineLevel, type LineContext } from '../../src/ui/speedLines';
import { SPEED_LINES_COUNT, SPEED_LINES_FULL, SPEED_LINES_START } from '../../src/util/constants';

class FakeContext implements LineContext {
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  globalAlpha = 1;
  lineWidth = 1;
  clears = 0;
  moves: [number, number][] = [];
  lines: [number, number][] = [];
  strokes = 0;
  clearRect(): void {
    this.clears++;
  }
  beginPath(): void {}
  moveTo(x: number, y: number): void {
    this.moves.push([x, y]);
  }
  lineTo(x: number, y: number): void {
    this.lines.push([x, y]);
  }
  stroke(): void {
    this.strokes++;
  }
}

describe('speedLineLevel', () => {
  it('is zero until the start speed, then grows to one at full speed', () => {
    expect(speedLineLevel(0, false)).toBe(0);
    expect(speedLineLevel(SPEED_LINES_START, false)).toBe(0);
    expect(speedLineLevel((SPEED_LINES_START + SPEED_LINES_FULL) / 2, false)).toBeCloseTo(0.5);
    expect(speedLineLevel(SPEED_LINES_FULL, false)).toBe(1);
    expect(speedLineLevel(500, false)).toBe(1);
  });

  it('boosting makes it stronger, but not while slow', () => {
    expect(speedLineLevel(60, true)).toBeGreaterThan(speedLineLevel(60, false));
    expect(speedLineLevel(10, true)).toBe(0);
  });
});

describe('SpeedStreaks', () => {
  it('draws nothing but a clear at level 0', () => {
    const ctx = new FakeContext();
    new SpeedStreaks().draw(ctx, 1920, 1080, 0, false);
    expect(ctx.clears).toBe(1);
    expect(ctx.strokes).toBe(0);
  });

  it('draws every streak in one stroke, outside the middle of the screen', () => {
    const ctx = new FakeContext();
    new SpeedStreaks(() => 0.5).draw(ctx, 1920, 1080, 1, false);
    expect(ctx.strokes).toBe(1);
    expect(ctx.moves.length).toBe(SPEED_LINES_COUNT);
    for (const [x, y] of ctx.moves) {
      const away = Math.hypot(x - 960, y - 540);
      expect(away).toBeGreaterThan(0.3 * Math.hypot(960, 540)); // the car stays clear
    }
  });

  it('each streak is drawn outward: its end is farther from the middle than its start', () => {
    const ctx = new FakeContext();
    new SpeedStreaks().draw(ctx, 1280, 720, 0.7, false);
    ctx.moves.forEach(([x, y], i) => {
      const [ex, ey] = ctx.lines[i] as [number, number];
      expect(Math.hypot(ex - 640, ey - 360)).toBeGreaterThan(Math.hypot(x - 640, y - 360));
    });
  });

  it('streaks move on as time passes', () => {
    const a = new FakeContext();
    const b = new FakeContext();
    const streaks = new SpeedStreaks(() => 0.3);
    streaks.draw(a, 1280, 720, 1, false);
    streaks.advance(0.1, 1);
    streaks.draw(b, 1280, 720, 1, false);
    expect(b.moves[0]).not.toEqual(a.moves[0]);
    for (const m of b.moves) expect(Number.isFinite(m[0]) && Number.isFinite(m[1])).toBe(true);
  });

  it('boost changes the colour', () => {
    const plain = new FakeContext();
    const boost = new FakeContext();
    const streaks = new SpeedStreaks();
    streaks.draw(plain, 800, 600, 1, false);
    streaks.draw(boost, 800, 600, 1, true);
    expect(boost.strokeStyle).not.toBe(plain.strokeStyle);
  });
});
