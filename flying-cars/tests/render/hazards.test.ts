import { describe, expect, it } from 'vitest';
import { Hazards } from '../../src/render/hazards';
import { TRACK_LIST, createTrack } from '../../src/track/tracks';
import type { Track } from '../../src/track/Track';

describe('Hazards', () => {
  for (const info of TRACK_LIST) {
    const track = createTrack(info.id) as Track;

    it(`${info.name}: draws every ring and barrier`, () => {
      const hazards = new Hazards(track);
      // each ring is one group, each barrier a group, and a slot wall adds a post at the opening
      expect(hazards.group.children.length).toBeGreaterThanOrEqual(
        track.rings.length + track.barriers.length,
      );
    });
  }

  it('hides a ring once the player has taken it, and shows it again for the next lap', () => {
    const track = createTrack('warm-up') as Track;
    const hazards = new Hazards(track);
    const rings = hazards.group.children.slice(0, track.rings.length);
    hazards.update(0.016, new Set([1]));
    expect(rings.map((r) => r.visible)).toEqual(rings.map((_, i) => i !== 1));
    hazards.update(0.016, new Set());
    expect(rings.every((r) => r.visible)).toBe(true);
    hazards.update(0.016, null);
    expect(rings.every((r) => r.visible)).toBe(true);
  });

  it('puts a ring where the track says', () => {
    const track = createTrack('gap-run') as Track;
    const hazards = new Hazards(track);
    const first = hazards.group.children[0];
    const ring = track.rings[0];
    expect(first?.position.distanceTo(ring?.position ?? first.position)).toBeLessThan(1e-4);
  });
});
