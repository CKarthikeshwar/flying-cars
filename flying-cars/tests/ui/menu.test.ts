import { describe, expect, it } from 'vitest';
import { TRACK_LIST, createTrack } from '../../src/track/tracks';
import type { Track } from '../../src/track/Track';
import { trackOutline } from '../../src/ui/menu';
import { formatTime, ordinal } from '../../src/ui/hud';

describe('trackOutline', () => {
  it.each(TRACK_LIST)(
    'fits $name inside the map box and marks its start, charge strips and gaps',
    (info) => {
      const track = createTrack(info.id) as Track;
      const outline = trackOutline(track);
      const numbers = [...outline.path.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));
      expect(numbers.length).toBeGreaterThan(100);
      for (let i = 0; i < numbers.length; i += 2) {
        expect(numbers[i]).toBeGreaterThanOrEqual(0);
        expect(numbers[i]).toBeLessThanOrEqual(400);
        expect(numbers[i + 1]).toBeGreaterThanOrEqual(0);
        expect(numbers[i + 1]).toBeLessThanOrEqual(220);
      }
      expect(outline.path.endsWith('Z')).toBe(true);
      expect(outline.charges.length).toBe(track.charges.length);
      expect(outline.gaps.length).toBe(track.gaps.length);
      const [x, y] = outline.start;
      expect(x).toBeGreaterThan(0);
      expect(y).toBeGreaterThan(0);
    },
  );
});

describe('HUD text helpers', () => {
  it('formats times as minutes, seconds and thousandths', () => {
    expect(formatTime(83.456)).toBe('01:23.456');
    expect(formatTime(0)).toBe('00:00.000');
    expect(formatTime(5.5)).toBe('00:05.500');
    expect(formatTime(-3)).toBe('00:00.000');
    expect(formatTime(600.0004)).toBe('10:00.000');
  });

  it('gives the right ordinal suffix, including the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      'ST',
      'ND',
      'RD',
      'TH',
      'TH',
      'TH',
      'TH',
      'ST',
      'ND',
      'RD',
      'ST',
      'TH',
    ]);
  });
});
