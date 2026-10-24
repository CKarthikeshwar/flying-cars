import { Quaternion, Vector3 } from 'three';
import { Sim } from '../physics/Sim';
import { createInput, type Input } from '../physics/Input';
import { Racer } from '../ai/Racer';
import type { Track } from '../track/Track';
import { gateCrossing } from '../track/checkpoints';
import { barrierHit, ringPass } from '../track/hazards';
import { TrackProgress } from '../track/progress';
import { GhostPlayer, GhostRecorder, type GhostData } from './Ghost';
import {
  AI_LANES,
  AI_LANDING_LEAD,
  AI_SKILLS,
  BARRIER_PENALTY,
  BARRIER_SPEED_MULT,
  COUNTDOWN_SECONDS,
  FINISH_CRUISE_SPEED,
  GRID_FIRST_ROW,
  GRID_LANE_OFFSET,
  GRID_ROW_GAP,
  HOP_BUFFER_AT,
  HOP_BUFFER_WINDOW,
  PHYSICS_DT,
  RACE_LAPS,
  RACER_HIGH_RISE,
  RING_AIR,
  RING_BOOST,
} from '../util/constants';

export type RaceState = 'countdown' | 'racing' | 'finished';

export type RaceEvent =
  | { type: 'go' }
  | { type: 'gate'; racer: number; gate: number }
  | { type: 'ring'; racer: number; ring: number }
  | { type: 'hit'; racer: number }
  | { type: 'lap'; racer: number; lap: number; lapTime: number; ghost: GhostData | null }
  | { type: 'finish'; racer: number; time: number; place: number };

/** One car in the race: the player or an AI, with its own physics world and its progress. */
export class RaceRacer {
  readonly name: string;
  readonly isPlayer: boolean;
  readonly sim: Sim;
  readonly driver: Racer | null;
  readonly progress: TrackProgress;
  readonly input: Input = createInput();
  readonly prevPosition = new Vector3();
  /** A Space tap held back until the right spot before a gap (see Race.bufferHop). */
  hopQueued = false;
  queuedStyle = 0;
  /** Rings this car has flown through in the lap in progress. They come back for the next lap. */
  readonly ringsTaken = new Set<number>();

  /** The lap in progress: 0 before the first crossing of the line, then 1 to the number of laps. */
  lap = 0;
  /** The gate this car has to pass next. Gate 0 is the start and finish line. */
  nextGate = 0;
  /** Race clock when the current lap began. */
  lapStart = 0;
  lapTimes: number[] = [];
  /** Metres travelled round the track relative to the start line, never wrapping. Negative on the grid. */
  distance = 0;
  finished = false;
  /** Penalty seconds at the moment the car finished. Later respawns do not change a finished race. */
  penaltyAtFinish = 0;
  /** Race clock at the finish plus penalties. */
  finishTime = 0;
  place = 0;
  /** Drives a finished car (the player's, or an AI's own driver) slowly round the track. */
  cruiser: Racer | null = null;

  private lastLapDistance = 0;

  constructor(name: string, isPlayer: boolean, sim: Sim, driver: Racer | null, track: Track) {
    this.name = name;
    this.isPlayer = isPlayer;
    this.sim = sim;
    this.driver = driver;
    this.progress = new TrackProgress(track);
  }

  /** Metres covered in the lap in progress, 0 to the track length. Continuous, so it does not jump at the line. */
  lapProgress(track: Track): number {
    if (this.lap < 1) return 0;
    return Math.min(track.length, Math.max(0, this.distance - (this.lap - 1) * track.length));
  }

  /** Re-finds the car on the track after a teleport, keeping the distance count consistent. */
  relocate(track: Track): void {
    this.progress.locate(this.sim.car.position);
    this.driver?.reset(this.sim);
    this.hopQueued = false;
    this.advanceDistance(track);
  }

  /** Adds how far the car has moved along the track since the last call (wrapping at the start line). */
  advanceDistance(track: Track): void {
    const d = this.progress.lapDistance;
    let delta = d - this.lastLapDistance;
    if (delta > track.length / 2) delta -= track.length;
    else if (delta < -track.length / 2) delta += track.length;
    this.distance += delta;
    this.lastLapDistance = d;
  }

  startAt(track: Track): void {
    this.progress.locate(this.sim.car.position);
    this.driver?.reset(this.sim);
    this.hopQueued = false;
    const d = this.progress.lapDistance;
    // On the grid, behind the line: negative distance.
    this.distance = d > track.length / 2 ? d - track.length : d;
    this.lastLapDistance = d;
  }
}

export interface RaceOptions {
  laps?: number;
  /** The AI racers. Defaults to three, with the spec's skill factors. */
  ai?: { name: string; skill: number }[];
  playerName?: string;
  /** Random steering wobble for the AI (0 to 1) and where its randomness comes from. For varied test trials. */
  aiNoise?: number;
  random?: () => number;
  /** Whether the AI hops the gaps. Off, they drive the ledge, slowly. Default on. */
  useHops?: boolean;
  /** Hold the countdown at its start until `waiting` is cleared, so nothing runs until the player is ready. */
  hold?: boolean;
}

const DEFAULT_AI_NAMES = ['Dune', 'Marrow', 'Kestrel']; // slowest to fastest, matching AI_SKILLS

/** Starting grid: [row, side] with side -1 left and +1 right. The player starts at the front left. */
const GRID: [number, number][] = [
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 1],
];

const IDLE: Input = createInput();

/**
 * A race: a countdown, then a number of laps for the player and the AI racers, each in its own physics
 * world. Checkpoint gates must be passed in order for a lap to count. The player's best lap can be
 * replayed as a ghost. Knows nothing about rendering, so it can run headless.
 */
export class Race {
  readonly track: Track;
  readonly laps: number;
  readonly racers: RaceRacer[];
  readonly player: RaceRacer;
  readonly events: RaceEvent[] = [];
  readonly recorder = new GhostRecorder();

  state: RaceState = 'countdown';
  /** Seconds left in the countdown. */
  countdown = COUNTDOWN_SECONDS;
  /** Race clock in seconds, from the go signal. Penalties are not included. */
  clock = 0;
  /** While true the countdown does not run. The cars sit on the grid. */
  waiting = false;
  /** The ghost to race against, if there is a recorded lap. */
  ghost: GhostPlayer | null = null;

  private finishedCount = 0;
  private readonly crossing = new Vector3();
  private readonly offset = new Vector3();

  constructor(track: Track, options: RaceOptions = {}) {
    this.track = track;
    this.laps = options.laps ?? RACE_LAPS;
    this.waiting = options.hold ?? false;

    const ai =
      options.ai ??
      AI_SKILLS.map((skill, i) => ({ name: DEFAULT_AI_NAMES[i] ?? `AI ${i + 1}`, skill }));
    const entries: { name: string; isPlayer: boolean; skill: number }[] = [
      { name: options.playerName ?? 'You', isPlayer: true, skill: 0 },
      ...ai.map((a) => ({ name: a.name, isPlayer: false, skill: a.skill })),
    ];
    this.racers = entries.map((entry, i) => {
      const sim = new Sim(track);
      const slot = GRID[i % GRID.length] ?? [0, 0];
      const behind = GRID_FIRST_ROW + slot[0] * GRID_ROW_GAP;
      const index = track.startIndex - Math.round(behind / track.spacing);
      const pose = track.poseAt(index, slot[1] * GRID_LANE_OFFSET);
      sim.placeCar(pose.position, pose.quaternion);
      sim.setSpawn(pose.position, pose.quaternion);
      const driver = entry.isPlayer ? null : new Racer(track, entry.skill, options.useHops ?? true);
      if (driver) {
        driver.lane = AI_LANES[i - 1] ?? 0;
        driver.steerNoise = options.aiNoise ?? 0;
        if (options.random) driver.random = options.random;
      }
      return new RaceRacer(entry.name, entry.isPlayer, sim, driver, track);
    });
    this.player = this.racers[0] as RaceRacer;
    for (const r of this.racers) r.startAt(track);
  }

  /** The countdown number to show: 3, 2, 1, or 0 once racing. */
  get countdownNumber(): number {
    return this.state === 'countdown' ? Math.ceil(this.countdown) : 0;
  }

  /** The player's time in the current lap, seconds. Zero before the first lap starts. */
  get lapTime(): number {
    return this.player.lap >= 1 && !this.player.finished ? this.clock - this.player.lapStart : 0;
  }

  /** Time the ghost took to reach where the player is now, minus the player's lap time so far. Null with no ghost. */
  get ghostGap(): number | null {
    const p = this.player;
    if (!this.ghost || p.lap < 1 || p.finished) return null;
    return this.lapTime - this.ghost.timeAtProgress(p.lapProgress(this.track));
  }

  /** Racers in race order: finishers by time, then the rest by distance covered. */
  standings(): RaceRacer[] {
    return this.racers.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.distance - a.distance;
    });
  }

  /** The player's current place, 1 for first. */
  get playerPlace(): number {
    const me = this.player;
    if (me.finished) return me.place;
    // count who is ahead, without building and sorting a list every frame
    let place = 1;
    for (const r of this.racers) {
      if (r === me) continue;
      if (r.finished || r.distance > me.distance) place++;
    }
    return place;
  }

  /** Race time including penalties, for a racer, at the moment it finished or now. */
  timeOf(r: RaceRacer): number {
    return r.finished ? r.finishTime : this.clock + r.sim.penalty;
  }

  /** Advances the whole race by one physics step. `playerInput` is the keyboard (ignored until the go signal). */
  step(playerInput: Input): void {
    this.events.length = 0;

    if (this.state === 'countdown') {
      for (const r of this.racers) {
        r.prevPosition.copy(r.sim.car.position);
        r.sim.step(IDLE);
      }
      if (!this.waiting) this.countdown -= PHYSICS_DT;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.state = 'racing';
        this.clock = 0;
        for (const r of this.racers) r.startAt(this.track);
        this.events.push({ type: 'go' });
      }
      return;
    }

    this.clock += PHYSICS_DT;
    for (let index = 0; index < this.racers.length; index++) {
      const r = this.racers[index] as RaceRacer;
      const input = r.input;
      input.steer = input.throttle = input.brake = input.pitch = input.roll = 0;
      input.hop = input.boost = input.respawn = input.glide = false;
      input.dash = 0;
      input.hopStyle = 0;
      input.retro = input.slam = false;
      if (r.finished) {
        r.cruiser?.drive(r.sim, input); // slow down and keep to the road
      } else if (r.isPlayer) {
        input.steer = playerInput.steer;
        input.throttle = playerInput.throttle;
        input.brake = playerInput.brake;
        input.pitch = playerInput.pitch;
        input.roll = playerInput.roll;
        input.hop = playerInput.hop;
        input.boost = playerInput.boost;
        input.glide = playerInput.glide;
        input.respawn = playerInput.respawn;
        input.dash = playerInput.dash;
        input.retro = playerInput.retro;
        input.slam = playerInput.slam;
        input.hopStyle = playerInput.hopStyle;
      } else {
        r.driver?.drive(r.sim, input);
      }

      if (r.isPlayer && !r.finished) {
        this.bufferHop(r, input);
        this.setAssist(r);
      }
      r.prevPosition.copy(r.sim.car.position);
      r.sim.step(input);

      const respawned = hasRespawn(r.sim.events);
      if (respawned) r.relocate(this.track);
      else {
        r.progress.update(r.sim.car.position);
        r.advanceDistance(this.track);
      }
      this.updateCharge(r);
      if (!r.finished) {
        if (!respawned) this.checkHazards(r, index);
        this.checkGate(r, index);
      }
      if (r.isPlayer && r.lap >= 1 && !r.finished) this.recordGhost(r);
    }
  }

  /**
   * Makes the jump easy for the player: a Space tap up to HOP_BUFFER_WINDOW before a gap edge is held, then
   * released HOP_BUFFER_AT before the edge, so the timing no longer has to be exact. The style of the hop
   * (long, high) is kept. A tap made anywhere else is a plain hop.
   */
  private bufferHop(r: RaceRacer, input: Input): void {
    const track = this.track;
    const n = track.count;
    const index = r.progress.index;
    let distance = Infinity;
    for (const gap of track.gaps) {
      const frame = track.frames[gap.first];
      if (!frame) continue;
      const steps = (gap.first - index + n) % n;
      if (steps > n / 2) continue; // behind the car
      this.offset.copy(frame.position).sub(r.sim.car.position);
      const metres = this.offset.dot(frame.tangent);
      if (metres < distance && metres > -2) distance = metres;
    }
    const inWindow = r.sim.attached && distance <= HOP_BUFFER_WINDOW;
    if (r.hopQueued) {
      if (!inWindow) r.hopQueued = false;
      else if (distance <= HOP_BUFFER_AT) {
        input.hop = true;
        input.hopStyle = r.queuedStyle;
        r.hopQueued = false;
      }
    } else if (input.hop && inWindow && distance > HOP_BUFFER_AT) {
      r.hopQueued = true;
      r.queuedStyle = input.hopStyle;
    }
    if (r.hopQueued && input.hop && distance > HOP_BUFFER_AT) input.hop = false;
  }

  /**
   * Flip assist for the player near an island gap: tells the car what the landing road's up is, so it can turn
   * itself that way, and whether the landing is high enough to need a high hop. Off everywhere else.
   */
  private setAssist(r: RaceRacer): void {
    const track = this.track;
    const index = r.progress.index;
    const landing = track.landingIndex(index, AI_LANDING_LEAD);
    const frame = landing !== index ? track.frames[landing] : undefined;
    const sim = r.sim;
    sim.assistOn = frame !== undefined;
    sim.assistHigh = frame !== undefined && frame.position.y - sim.car.position.y > RACER_HIGH_RISE;
    if (frame) sim.assistUp.copy(frame.up);
  }

  /** Tells the car whether it is over a charge strip, so its air refills fast. */
  private updateCharge(r: RaceRacer): void {
    const track = this.track;
    if (track.charges.length === 0) return;
    const frame = track.frames[r.progress.index];
    if (!frame) return;
    this.offset.copy(r.sim.car.position).sub(frame.position);
    r.sim.onChargeStrip = track.chargeAt(r.progress.index, this.offset.dot(frame.binormal));
  }

  /** Rings flown through and barriers hit during the step that just ran. */
  private checkHazards(r: RaceRacer, index: number): void {
    const track = this.track;
    const prev = r.prevPosition;
    const cur = r.sim.car.position;
    track.rings.forEach((ring, k) => {
      // rings are for flying: a car driving along under one does not collect it
      if (r.sim.attached || r.ringsTaken.has(k) || ringPass(ring, prev, cur) === null) return;
      r.ringsTaken.add(k);
      r.sim.ringBoost(RING_AIR, RING_BOOST);
      this.events.push({ type: 'ring', racer: index, ring: k });
    });
    for (const barrier of track.barriers) {
      const frame = track.frames[barrier.index];
      if (!frame || !barrierHit(barrier, frame, prev, cur)) continue;
      r.sim.hitBarrier(BARRIER_SPEED_MULT, BARRIER_PENALTY);
      this.events.push({ type: 'hit', racer: index });
      break; // one hit per step, even when two walls of a slot are met together
    }
  }

  private checkGate(r: RaceRacer, index: number): void {
    const gate = this.track.gates[r.nextGate];
    if (!gate) return;
    const f = gateCrossing(gate, r.prevPosition, r.sim.car.position, this.track.width);
    if (f === null) return;

    const time = this.clock - PHYSICS_DT + f * PHYSICS_DT; // when, to within a fraction of a step
    if (gate.number === 0) this.crossLine(r, index, time, f);
    r.nextGate = (gate.number + 1) % this.track.gates.length;
    // A respawn now puts the car back at this gate.
    const pose = this.track.poseAt(gate.index);
    r.sim.setSpawn(pose.position, pose.quaternion);
    this.events.push({ type: 'gate', racer: index, gate: gate.number });
  }

  /** The car has crossed the start and finish line with every gate behind it passed in order. */
  private crossLine(r: RaceRacer, index: number, time: number, f: number): void {
    // Where the car was at the moment of crossing, so the ghost has exact first and last samples.
    const car = r.sim.car;
    this.crossing.lerpVectors(r.prevPosition, car.position, f);
    if (r.lap >= 1) {
      const lapTime = time - r.lapStart;
      r.lapTimes.push(lapTime);
      if (r.isPlayer) this.recorder.add(lapTime, this.crossing, car.quaternion, this.track.length);
      const ghost = r.isPlayer ? this.recorder.finish(lapTime) : null;
      this.events.push({ type: 'lap', racer: index, lap: r.lap, lapTime, ghost });
      if (r.lap >= this.laps) {
        r.finished = true;
        r.finishTime = time + r.sim.penalty;
        r.place = ++this.finishedCount;
        // Slow to a cruise on the ledges: at this speed a hop would not clear a gap.
        r.cruiser = new Racer(this.track, 1, false);
        r.cruiser.lane = r.driver?.lane ?? 0;
        r.cruiser.speedLimit = FINISH_CRUISE_SPEED;
        r.penaltyAtFinish = r.sim.penalty;
        r.cruiser.reset(r.sim);
        this.events.push({ type: 'finish', racer: index, time: r.finishTime, place: r.place });
        if (r.isPlayer) this.state = 'finished';
        return;
      }
    }
    r.lap += 1;
    r.lapStart = time;
    r.ringsTaken.clear();
    if (r.isPlayer) {
      this.recorder.begin();
      this.recorder.add(0, this.crossing, car.quaternion, 0);
    }
  }

  private recordGhost(r: RaceRacer): void {
    const car = r.sim.car;
    this.recorder.offer(
      this.clock - r.lapStart,
      car.position,
      car.quaternion,
      r.lapProgress(this.track),
    );
  }

  /** Frees every racer's physics world. Call when the race is thrown away. */
  dispose(): void {
    for (const r of this.racers) r.sim.dispose();
  }

  /** Sets the ghost from a recorded lap, or clears it. */
  setGhost(data: GhostData | null): void {
    this.ghost = data ? new GhostPlayer(data) : null;
  }

  /** Where the ghost is now, written into the arguments. False when there is no ghost to show. */
  ghostPose(outPosition: Vector3, outQuaternion: Quaternion): boolean {
    if (!this.ghost || this.player.lap < 1 || this.player.finished) return false;
    this.ghost.poseAt(this.lapTime, outPosition, outQuaternion);
    return true;
  }
}

/** True when one of the events is a respawn. A plain loop, so nothing is allocated on every physics step. */
function hasRespawn(events: readonly { type: string }[]): boolean {
  for (let i = 0; i < events.length; i++) if (events[i]?.type === 'respawn') return true;
  return false;
}
