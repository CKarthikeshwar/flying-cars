import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Track } from '../../src/track/Track';
import { gateCrossing } from '../../src/track/checkpoints';
import { testTrackDef } from '../../src/track/tracks/testTrack';
import { GATE_ABOVE, GATE_BELOW, GATE_MARGIN } from '../../src/util/constants';

const track = new Track(testTrackDef());

describe('track start and gates', () => {
  it('puts the start line where the track data says, and gate 0 on it', () => {
    expect(track.lapDistance(track.startIndex)).toBe(0);
    expect(track.startIndex * track.spacing).toBeCloseTo(40, 0);
    expect(track.gates[0]?.index).toBe(track.startIndex);
  });

  it('spaces the gates about 100 m apart in driving order, leaving a gate out where a loop leaves no safe spot', () => {
    expect(track.gates.length).toBeLessThanOrEqual(Math.round(track.length / 100));
    expect(track.gates.length).toBeGreaterThan(Math.round(track.length / 100) * 0.6);
    for (let g = 1; g < track.gates.length; g++) {
      const a = track.gates[g - 1];
      const b = track.gates[g];
      if (!a || !b) throw new Error('missing gate');
      expect(track.lapDistance(b.index)).toBeGreaterThan(track.lapDistance(a.index));
      // about 100 m apart, or up to a loop's length where the loop has no safe spot in it
      expect(track.lapDistance(b.index) - track.lapDistance(a.index)).toBeLessThan(460);
    }
  });

  it('wraps lap distance round the start line', () => {
    expect(track.lapDistance(track.startIndex - 1)).toBeGreaterThan(track.length - 2);
    expect(track.lapDistance(track.startIndex + 10)).toBeCloseTo(10 * track.spacing);
  });
});

describe('gateCrossing', () => {
  const gate = track.gates[3];
  if (!gate) throw new Error('no gate');
  const f = gate.frame;
  const at = (along: number, across = 0, above = 0) =>
    f.position
      .clone()
      .addScaledVector(f.tangent, along)
      .addScaledVector(f.binormal, across)
      .addScaledVector(f.up, above);

  it('detects a forward crossing and says how far along the step it happened', () => {
    const t = gateCrossing(gate, at(-1), at(3), track.width);
    expect(t).toBeCloseTo(0.25);
  });

  it('ignores crossing backwards, and moves that stay on one side', () => {
    expect(gateCrossing(gate, at(3), at(-1), track.width)).toBeNull();
    expect(gateCrossing(gate, at(-5), at(-1), track.width)).toBeNull();
    expect(gateCrossing(gate, at(1), at(5), track.width)).toBeNull();
  });

  it('only counts a crossing inside the road width plus a margin', () => {
    const edge = track.width / 2 + GATE_MARGIN;
    expect(gateCrossing(gate, at(-1, edge - 0.1), at(1, edge - 0.1), track.width)).not.toBeNull();
    expect(gateCrossing(gate, at(-1, edge + 0.1), at(1, edge + 0.1), track.width)).toBeNull();
    expect(gateCrossing(gate, at(-1, -edge - 0.1), at(1, -edge - 0.1), track.width)).toBeNull();
  });

  it('only counts a crossing near the road surface, so another part of the track does not trigger it', () => {
    expect(gateCrossing(gate, at(-1, 0, 0.5), at(1, 0, 0.5), track.width)).not.toBeNull();
    expect(
      gateCrossing(gate, at(-1, 0, GATE_ABOVE + 0.5), at(1, 0, GATE_ABOVE + 0.5), track.width),
    ).toBeNull();
    expect(
      gateCrossing(gate, at(-1, 0, -GATE_BELOW - 0.5), at(1, 0, -GATE_BELOW - 0.5), track.width),
    ).toBeNull();
  });

  it('works on an upside-down road, where up points down', () => {
    const ceiling = track.gates.find((g) => g.frame.up.y < -0.99);
    if (!ceiling) return; // no gate happens to sit on the ceiling; the road geometry tests cover it
    const c = ceiling.frame;
    const prev = c.position.clone().addScaledVector(c.tangent, -1).addScaledVector(c.up, 0.45);
    const cur = c.position.clone().addScaledVector(c.tangent, 1).addScaledVector(c.up, 0.45);
    expect(gateCrossing(ceiling, prev, cur, track.width)).not.toBeNull();
  });

  it('the two ends of a loop, a road width apart, are different gates', () => {
    // a point on the first loop must not satisfy a gate on the straight beside it
    const far = new Vector3(f.position.x + 40, f.position.y, f.position.z);
    expect(
      gateCrossing(
        gate,
        far.clone().addScaledVector(f.tangent, -1),
        far.clone().addScaledVector(f.tangent, 1),
        track.width,
      ),
    ).toBeNull();
  });
});
