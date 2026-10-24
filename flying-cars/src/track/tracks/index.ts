import { Track, type TrackDef } from '../Track';
import { gapRunDef } from './gapRun';
import { spiralTowerDef } from './spiralTower';
import { testTrackDef } from './testTrack';
import { warmUpDef } from './warmUp';

/** A track the player can pick. */
export interface TrackInfo {
  /** Short name used in the address (?track=warm-up). */
  id: string;
  name: string;
  /** One line about what it teaches. */
  blurb: string;
  /** What is on it, for the menu. */
  features: ('wall' | 'ceiling' | 'gap' | 'loop' | 'climb')[];
  def: () => TrackDef;
}

/** The tracks in the menu, easiest first. */
export const TRACK_LIST: TrackInfo[] = [
  {
    id: 'warm-up',
    name: 'Warm-up',
    blurb:
      'Wide and gentle. A small gap, a wall, a ceiling, and one sky island to learn the flip on.',
    features: ['wall', 'ceiling', 'gap'],
    def: warmUpDef,
  },
  {
    id: 'spiral-tower',
    name: 'Spiral Tower',
    blurb: 'Islands in the sky, then climb the spiral and race down the tower.',
    features: ['climb', 'ceiling', 'wall', 'gap'],
    def: spiralTowerDef,
  },
  {
    id: 'gap-run',
    name: 'Gap Run',
    blurb: 'Three gaps in a row, wider each time. Then the loop, the wall and a sky island.',
    features: ['gap', 'wall', 'loop', 'ceiling'],
    def: gapRunDef,
  },
];

/** Tracks that can be opened by name but are not in the menu. */
const HIDDEN: Record<string, () => TrackDef> = {
  test: testTrackDef,
};

export function trackNames(): string[] {
  return [...TRACK_LIST.map((t) => t.id), ...Object.keys(HIDDEN)];
}

export function createTrack(id: string): Track | null {
  const def = TRACK_LIST.find((t) => t.id === id)?.def ?? HIDDEN[id];
  return def ? new Track(def()) : null;
}
