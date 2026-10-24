import type { Track } from '../track/Track';
import {
  AI_BRAKE_DECEL,
  AI_LAT_ACCEL,
  AI_LEDGE_SPEED,
  AI_MAX_SPEED,
  AI_NORMAL_RATE_MAX,
} from '../util/constants';

/**
 * The speed the AI aims for at every sample of a track, before the skill factor:
 *   cornering:  v = sqrt(a_lat / kappa), from the curvature of the centre line
 *   rolling:    the road's up vector may not turn faster than AI_NORMAL_RATE_MAX under the car
 * capped at AI_MAX_SPEED (and, with `ledges`, at the ledge speed inside a gap), then smoothed backwards so the AI starts braking early enough to be at the
 * corner speed when it gets there (v[i]^2 <= v[i+1]^2 + 2 a_brake ds).
 */
export function buildSpeedProfile(track: Track, options: { ledges?: boolean } = {}): Float64Array {
  const n = track.count;
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Over an island gap there is no road to stay on: how the missing road turns or rolls does not matter.
    const void_ = track.gapAt(i)?.ledge === 'none';
    const kappa = void_ ? 0 : (track.curvature[i] ?? 0);
    const rate = void_ ? 0 : (track.normalRate[i] ?? 0);
    const corner = kappa > 1e-6 ? Math.sqrt(AI_LAT_ACCEL / kappa) : Infinity;
    const roll = rate > 1e-6 ? AI_NORMAL_RATE_MAX / rate : Infinity;
    v[i] = Math.min(AI_MAX_SPEED, corner, roll);
    // Not hopping a gap means driving its narrow ledge, which takes care.
    if (options.ledges && track.gapAt(i)) v[i] = Math.min(v[i] ?? AI_MAX_SPEED, AI_LEDGE_SPEED);
  }
  // Two passes around the loop, so the braking carries across the start line.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = v[(i + 1) % n] ?? AI_MAX_SPEED;
      v[i] = Math.min(
        v[i] ?? AI_MAX_SPEED,
        Math.sqrt(next * next + 2 * AI_BRAKE_DECEL * track.spacing),
      );
    }
  }
  return v;
}
