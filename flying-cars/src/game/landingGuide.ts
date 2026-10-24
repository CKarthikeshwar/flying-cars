import { Quaternion, Vector3 } from 'three';
import type { Sim } from '../physics/Sim';
import type { Track } from '../track/Track';
import { AI_LANDING_LEAD } from '../util/constants';

/** What the landing guide shows: how far off level with the landing surface, and the key that turns the car the right way. */
export interface LandingGuide {
  degrees: number;
  key: 'Q' | 'E' | 'W' | 'S';
}

const up = new Vector3();
const inverse = new Quaternion();
const result: LandingGuide = { degrees: 0, key: 'E' };

/**
 * For a car in the air: the angle between its up and the up of the road it is heading for (the road beyond an
 * island gap if one is near, else the road below), and which of Q, E, W and S turns it toward that. Null on a surface.
 * The object returned is reused: read it before the next call.
 */
export function landingGuide(sim: Sim, track: Track, index: number): LandingGuide | null {
  if (sim.attached) return null;
  const target = track.frames[track.landingIndex(index, AI_LANDING_LEAD)];
  if (!target) return null;
  inverse.copy(sim.car.quaternion).invert();
  up.copy(target.up).applyQuaternion(inverse); // the surface's up, in the car's own axes
  result.degrees = (Math.acos(Math.max(-1, Math.min(1, up.y))) * 180) / Math.PI;
  const roll = Math.atan2(up.x, up.y); // positive: roll right
  const pitch = Math.atan2(-up.z, up.y); // positive: nose down
  // upside down, or more roll than pitch to do: roll first
  if (up.y < 0.2 || Math.abs(roll) >= Math.abs(pitch)) result.key = roll >= 0 ? 'E' : 'Q';
  else result.key = pitch >= 0 ? 'W' : 'S';
  return result;
}
