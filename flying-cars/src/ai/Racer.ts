import { Quaternion, Vector3 } from 'three';
import type { Sim } from '../physics/Sim';
import type { Input } from '../physics/Input';
import type { Track } from '../track/Track';
import { TrackProgress } from '../track/progress';
import { buildSpeedProfile } from './speedProfile';
import { attitudeCommand } from '../physics/attitude';
import {
  AI_BOOST_AIR_MIN,
  AI_BOOST_CURVATURE,
  AI_BOOST_ROLL_RATE,
  AI_CUSHION_SPEED,
  AI_FLY_LEVEL,
  AI_HOP_WINDOW,
  AI_LANDING_LEAD,
  AI_LEDGE_APPROACH,
  AI_LANE_ROLL_RATE,
  AI_LOOKAHEAD_BASE,
  AI_LOOKAHEAD_SPEED,
  AI_STEER_GAIN,
  AI_STUCK_SECONDS,
  CUSHION_RANGE,
  HOP_COST,
  HOP_HIGH_COST,
  RACER_HIGH_RISE,
  PHYSICS_DT,
  SLOT_APPROACH,
} from '../util/constants';
import { clamp } from '../util/math';

/** Speed profiles are the same for every racer on a track, so they are built once. */
const profiles = new WeakMap<Track, { hopping: Float64Array; ledges: Float64Array }>();
function profileFor(track: Track, ledges: boolean): Float64Array {
  let p = profiles.get(track);
  if (!p) {
    p = {
      hopping: buildSpeedProfile(track),
      ledges: buildSpeedProfile(track, { ledges: true }),
    };
    profiles.set(track, p);
  }
  return ledges ? p.ledges : p.hopping;
}

/**
 * A waypoint-following driver. It fills the same Input object a keyboard does.
 *   steering: aim at a point L = 8 m + 0.2 v ahead on the centre line, steer by the angle error
 *   speed:    the planned corner speed from the curvature, times the skill factor
 *   boost:    on straights, while the tank is above 50
 *   hop:      once at each hop marker in the track data
 */
export class Racer {
  readonly skill: number;
  /** Whether this racer hops the gaps. When false it takes the ledge, slowly. */
  readonly useHops: boolean;
  /** Upper limit on the target speed, m/s. Lowered after a car finishes so it cruises to a stop. */
  speedLimit = Infinity;
  /** Random steering wobble, 0 to 1, for varied trials in tests. Zero in the game. */
  steerNoise = 0;
  /** Metres to the right of the centre line this racer aims for, fading to zero where the road rolls steeply. */
  lane = 0;
  /** Source of randomness for the wobble, 0 to 1. */
  random: () => number = Math.random;
  private readonly track: Track;
  private readonly profile: Float64Array;
  private readonly progress: TrackProgress;
  private readonly delta = new Vector3();
  private readonly want = new Vector3();
  private readonly spin = new Vector3();
  private readonly command = { roll: 0, pitch: 0 };
  private readonly inverse = new Quaternion();
  private readonly hopped: boolean[];
  private lastLapDistance = 0;
  private stuckTime = 0;

  constructor(track: Track, skill: number, useHops = true) {
    this.track = track;
    this.skill = skill;
    this.useHops = useHops;
    this.profile = profileFor(track, !useHops);
    this.progress = new TrackProgress(track);
    this.hopped = track.hopMarkers.map(() => false);
  }

  /** Forget where we were. Call after a respawn or when the race starts. */
  reset(sim: Sim): void {
    this.progress.locate(sim.car.position);
    this.lastLapDistance = this.progress.lapDistance;
    this.stuckTime = 0;
    this.hopped.fill(false);
  }

  /** Nearest road sample to the car, for others to read. */
  get index(): number {
    return this.progress.index;
  }

  /**
   * Where to aim across the road when the gap ahead is being driven rather than hopped: the middle of the
   * ledge, blended in over the approach. Null when hopping, or when no gap is near.
   */
  private ledgeOffset(index: number): number | null {
    if (this.useHops) return null;
    const { track } = this;
    const approach = Math.round(AI_LEDGE_APPROACH / track.spacing);
    for (let k = 0; k <= approach; k++) {
      const centre = track.ledgeCentre((index + k) % track.count);
      if (centre === null) continue;
      const blend = Math.min(1, Math.max(0, 1 - (k - 5) / approach)); // fully over by the time it starts
      return this.lane + (centre - this.lane) * blend * blend * (3 - 2 * blend);
    }
    return null;
  }

  /** Where to aim across the road to go through the opening of the slot wall ahead, blended in over the approach. */
  private slotOffset(index: number): number | null {
    const slot = this.track.slotAhead(index, Math.round(SLOT_APPROACH / this.track.spacing));
    if (!slot) return null;
    const blend = clamp(1 - (slot.distance - 10) / SLOT_APPROACH, 0, 1);
    return this.lane + (slot.centre - this.lane) * blend * blend * (3 - 2 * blend);
  }

  /**
   * In the air: turn the car so it meets the road it is about to land on. The way up of that road, seen from the
   * car, gives how far to roll and pitch; a little damping stops the turn on time. An upside-down landing (a
   * ceiling island) is just a bigger roll.
   */
  private fly(sim: Sim, input: Input, index: number): void {
    const target = this.track.frames[this.track.landingIndex(index, AI_LANDING_LEAD)];
    if (!target) return;
    const car = sim.car;
    this.inverse.copy(car.quaternion).invert();
    const u = this.want.copy(target.up).applyQuaternion(this.inverse); // the road's up in the car's own axes
    // Steering turns the car about its own up. That aims the landing while the car is level, but once it has
    // rolled over it is a sideways spin that fights the flip, so it waits until the car is nearly level again.
    if (u.y < AI_FLY_LEVEL) input.steer = 0;

    // Coming down fast onto a surface: tap hop for the cushion, which takes most of the speed off the landing.
    const found = sim.sensor.found && sim.sensor.distance < CUSHION_RANGE;
    if (found && car.velocity.dot(sim.sensor.smoothNormal) < -AI_CUSHION_SPEED) input.hop = true;
    sim.localSpin(this.spin);
    attitudeCommand(u, this.spin, this.command);
    input.roll = this.command.roll;
    input.pitch = this.command.pitch;
  }

  drive(sim: Sim, input: Input): void {
    const { track } = this;
    const car = sim.car;
    const n = track.count;

    if (sim.crashed) return; // waiting to respawn

    const index = this.progress.update(car.position);
    const speed = sim.speed;

    // Steering: angle to a point ahead on the centre line, measured in the car's own frame.
    const lookahead = AI_LOOKAHEAD_BASE + AI_LOOKAHEAD_SPEED * speed;
    const aheadIndex = (index + Math.round(lookahead / track.spacing)) % n;
    const ahead = track.frames[aheadIndex];
    if (ahead) {
      this.delta.copy(ahead.position).sub(car.position);
      const ledge = this.ledgeOffset(index) ?? this.slotOffset(index);
      if (ledge !== null) {
        // Driving the ledge: aim for its middle, moving over before the gap begins.
        this.delta.addScaledVector(ahead.binormal, ledge);
      } else if (this.lane !== 0) {
        const fade = clamp(1 - (track.normalRate[aheadIndex] ?? 0) / AI_LANE_ROLL_RATE, 0, 1);
        this.delta.addScaledVector(ahead.binormal, this.lane * fade);
      }
      input.steer = clamp(
        Math.atan2(this.delta.dot(car.right), this.delta.dot(car.forward)) * AI_STEER_GAIN,
        -1,
        1,
      );
      if (this.steerNoise > 0) {
        input.steer = clamp(input.steer + (this.random() * 2 - 1) * this.steerNoise, -1, 1);
      }
    }

    // Speed: bang-bang around the planned speed.
    const target = Math.min((this.profile[index] ?? 0) * this.skill, this.speedLimit);
    input.throttle = speed < target ? 1 : 0;
    input.brake = speed > target + 3 ? 1 : 0;

    // Boost on straights: flat road here and a little way ahead, with air to spare.
    const straight =
      (track.curvature[index] ?? 0) < AI_BOOST_CURVATURE &&
      (track.curvature[aheadIndex] ?? 0) < AI_BOOST_CURVATURE &&
      (track.normalRate[index] ?? 0) < AI_BOOST_ROLL_RATE &&
      (track.normalRate[aheadIndex] ?? 0) < AI_BOOST_ROLL_RATE;
    input.boost = straight && sim.air.value > AI_BOOST_AIR_MIN && speed < target - 2;

    // Hop markers: hop once as the car reaches each one, on each lap.
    const lapDistance = this.progress.lapDistance;
    if (lapDistance < this.lastLapDistance - track.length / 2) this.hopped.fill(false); // crossed the line
    this.lastLapDistance = lapDistance;
    for (let k = 0; this.useHops && k < track.hopMarkers.length; k++) {
      const marker = track.hopMarkers[k] ?? 0;
      if (!this.hopped[k] && lapDistance >= marker - AI_HOP_WINDOW && lapDistance < marker + 20) {
        this.hopped[k] = true;
        // A landing well above the road here (an island up in the sky) needs the steep high hop.
        const up = track.frames[track.landingIndex(index, AI_LANDING_LEAD)];
        const high = up !== undefined && up.position.y - car.position.y > RACER_HIGH_RISE;
        input.hopStyle = high ? -1 : 0;
        // Leaving an upside-down island there is nothing to hop from: a hop would only throw the car downward.
        const underneath = (track.frames[index]?.up.y ?? 1) < -0.5;
        if (!underneath && sim.attached && sim.air.value >= HOP_COST * (high ? HOP_HIGH_COST : 1))
          input.hop = true;
      }
    }

    if (!sim.attached) this.fly(sim, input, index);

    // Stuck for a while (upside down off the road, wedged): ask for a respawn.
    this.stuckTime = speed < 1.5 ? this.stuckTime + PHYSICS_DT : 0;
    if (this.stuckTime > AI_STUCK_SECONDS) {
      input.respawn = true;
      this.stuckTime = 0;
    }
  }
}
