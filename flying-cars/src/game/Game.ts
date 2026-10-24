import { Quaternion, Vector2, Vector3 } from 'three';
import { Sim, type SimEvent } from '../physics/Sim';
import type { Input } from '../physics/Input';
import { TRACK_LIST, createTrack } from '../track/tracks';
import type { Track } from '../track/Track';
import { Keyboard } from '../input/keyboard';
import { World3D } from '../render/scene';
import { CarModel, PLAYER_LOOK, type CarLook } from '../render/carModel';
import { buildTrackMesh } from '../render/trackMesh';
import { Effects, type EmitterPose, type StreamState } from '../render/effects';
import { Hazards } from '../render/hazards';
import { Sfx } from '../audio/sfx';
import { Settings } from './settings';
import { HintEngine, type HintState } from './hints';
import type { LandingGuide } from './landingGuide';
import { SettingsPanel } from '../ui/settings';
import { ChaseCamera } from '../render/camera';
import { Hud, formatTime, ordinal, type RaceReadout } from '../ui/hud';
import { SpeedLines } from '../ui/speedLines';
import { ResultsScreen, type ResultsData } from '../ui/results';
import { StartScreen } from '../ui/start';
import { TrackMenu, type MenuEntry } from '../ui/menu';
import { DebugOverlay, debugEnabled } from '../ui/debug';
import { Loop } from './Loop';
import { Race, type RaceEvent, type RaceRacer } from './Race';
import { landingGuide } from './landingGuide';
import { Records, browserStore } from './records';
import {
  CAM_MODE_NAMES,
  CAM_UP_RATES,
  CUSHION_COST,
  FLIP_REFUND,
  GHOST_OPACITY,
  LAND_PERFECT_REFUND,
  RESULTS_WAIT_SECONDS,
  RESPAWN_PENALTY,
  RING_AIR,
  BARRIER_PENALTY,
  SHAKE_BOOST,
  SHAKE_CRASH,
  SHAKE_PERFECT,
  SHAKE_ROUGH,
  SLOW_MO_SCALE,
} from '../util/constants';

export type GameState = 'countdown' | 'racing' | 'finished' | 'paused';

const GHOST_VIOLET = 0xa99bff;
/** Colours for the AI cars, so they can be told apart: lime, pink, white. */
const AI_LOOKS: CarLook[] = [
  { outline: 0xb8ff3c, tail: 0xb8ff3c },
  { outline: 0xff2e63, tail: 0xff2e63 },
  { outline: 0xeaf1f5, tail: 0xeaf1f5 },
];
/** How long the GO message stays up, seconds of race time. */
const GO_SECONDS = 0.8;
/** Where the chosen camera mode is remembered between visits. */
const CAMERA_KEY = 'flyingcars.v1.camera';
const MUTE_KEY = 'flyingcars.v1.muted';

/**
 * Ties the pieces together. On a track it runs a race: a countdown, three laps against three AI racers
 * and the ghost of the best lap, then the results. With ?track=flat it is the Milestone 1 sandbox.
 */
export class Game {
  private track: Track | null = null;
  private race: Race | null = null;
  private sandbox: Sim | null = null;
  private paused = false;

  private readonly keyboard = new Keyboard();
  private readonly view: World3D;
  private readonly chase: ChaseCamera;
  private readonly hud = new Hud();
  private readonly results: ResultsScreen;
  private readonly startScreen: StartScreen;
  private readonly menu: TrackMenu;
  private readonly records = new Records(browserStore());
  private readonly sfx = new Sfx(readMuted());
  private readonly settings = new Settings(browserStore());
  private readonly settingsPanel = new SettingsPanel(this.settings);
  private lastCountdown = 0;
  private readonly debug: DebugOverlay | null;
  private readonly loop: Loop;

  private readonly effects: Effects;
  /** Rings and barriers of the loaded track. */
  private hazards: Hazards | null = null;
  private hints: HintEngine | null = null;
  /** Hops and landing cushions seen in the physics steps, waiting for the next frame to draw their puffs. */
  private readonly pendingEffects: {
    racer: number;
    type: 'hop' | 'cushion' | 'dash' | 'ring' | 'hit';
    direction: number;
  }[] = [];
  private lastInput: Input | null = null;
  private readonly speedLines: SpeedLines;
  // Filled in again every frame instead of building new objects.
  private readonly readout: RaceReadout = {
    place: 1,
    racers: 1,
    lap: 0,
    laps: 1,
    time: 0,
    penalty: 0,
    ghostGap: null,
  };
  private readonly hintState: HintState = {
    index: 0,
    attached: true,
    air: 0,
    groundDistance: Infinity,
    guide: null,
  };
  private readonly streamState: StreamState = {
    boosting: false,
    gliding: false,
    retro: false,
    slam: false,
    airborne: false,
    pitch: 0,
    roll: 0,
    steer: 0,
  };
  private readonly bufferSize = new Vector2();
  private readonly emitter: EmitterPose = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    velocity: new Vector3(),
  };

  private readonly models: CarModel[] = [];
  private readonly ghostModel = new CarModel().makeGhost(GHOST_VIOLET, GHOST_OPACITY);

  /** The best lap before this race started, to compare this race's laps with. */
  private previousBest: number | null = null;
  /** Set when a lap of this race beats the saved best. */
  private newBestLap: number | null = null;
  /** Race clock when the player finished, while waiting to show the results. Null otherwise. */
  private waitingSince: number | null = null;
  /** The track last raced, so the menu opens on it again. */
  private lastTrackId: string | undefined;

  private cameraMode = 1; // index into CAM_UP_RATES: 0 smooth, 1 quick, 2 locked
  private readonly tmpUp = new Vector3();
  private readonly tmpQuat = new Quaternion();
  private readonly pos = new Vector3();
  private readonly quat = new Quaternion();

  constructor(container: HTMLElement) {
    // ?track=flat is the Milestone 1 sandbox, ?track=<id> goes straight to that track, and with no
    // parameter the track menu opens.
    const param = new URLSearchParams(window.location.search).get('track');

    this.view = new World3D(container);
    this.chase = new ChaseCamera(this.view.camera);
    this.effects = new Effects(this.view.scene);
    this.speedLines = new SpeedLines(container);
    this.results = new ResultsScreen(
      () => this.startRace(false),
      () => this.showMenu(),
    );
    this.startScreen = new StartScreen(
      () => this.beginRace(),
      () => this.showMenu(),
      () => this.togglePause(),
    );
    this.menu = new TrackMenu(
      (id) => this.loadTrack(id, false),
      () => this.togglePause(),
    );
    this.loadCameraMode();
    this.debug = debugEnabled() ? new DebugOverlay(this.view.scene, this.hud.debugPanel) : null;
    // Debug mode only: expose the game so a console or a browser test can step it by hand.
    if (this.debug) (window as unknown as { __game?: Game }).__game = this;

    if (param === 'flat') {
      this.models.push(new CarModel());
      this.sandbox = new Sim(null);
      for (const m of this.models) this.view.scene.add(m.group);
      this.hud.setRace(false);
    } else {
      // the player, then the three AI racers
      [PLAYER_LOOK, ...AI_LOOKS].forEach((look) => this.models.push(new CarModel(look)));
      for (const m of this.models) this.view.scene.add(m.group);
      this.ghostModel.group.visible = false;
      this.view.scene.add(this.ghostModel.group);
      if (param !== null && createTrackId(param)) this.loadTrack(param, true);
      else this.showMenu();
    }

    this.keyboard.onPause = () => this.togglePause();
    this.keyboard.onSlowMo = () => this.debug?.toggleSlowMo();
    this.keyboard.onConfirm = () => {
      if (this.paused) return;
      if (this.menu.visible) this.menu.confirm();
      else if (this.startScreen.visible) this.beginRace();
      else if (this.results.visible) this.startRace(false);
    };
    this.hud.addSettings(this.settingsPanel.element);
    const applySettings = (): void => {
      this.sfx.setVolume(this.settings.volume);
      this.chase.shakeScale = this.settings.shake;
      if (this.hints) this.hints.enabled = this.settings.hints;
    };
    this.settings.onChange = applySettings;
    applySettings();
    this.keyboard.onArrow = (direction) =>
      this.paused ? this.settingsPanel.move(direction) : this.menu.move(direction);
    this.keyboard.onSide = (direction) => {
      if (this.paused) this.settingsPanel.adjust(direction);
    };
    this.keyboard.onHelp = () => this.menu.toggleHelp();
    this.keyboard.onBack = () => {
      if (this.track && !this.menu.visible && (this.paused || this.results.visible))
        this.showMenu();
    };
    this.keyboard.onCamera = () => this.cycleCamera();
    this.keyboard.onMute = () => {
      const muted = this.sfx.toggleMute();
      this.hud.showNote(`SOUND: ${muted ? 'OFF' : 'ON'}`);
    };
    this.sfx.onMuteChange = (muted) => {
      try {
        browserStore()?.setItem(MUTE_KEY, muted ? '1' : '0');
      } catch {
        // not saved: still works for this visit
      }
    };
    this.sfx.attach(window);
    this.keyboard.attach(window);

    this.loop = new Loop(
      () => this.step(),
      (alpha, frameTime) => this.render(alpha, frameTime),
      // the world stands still behind the pause screen and behind the results
      () => (this.paused || this.results.visible ? 0 : this.debug?.slowMo ? SLOW_MO_SCALE : 1),
    );
  }

  get state(): GameState {
    if (this.paused) return 'paused';
    return this.race?.state ?? 'racing';
  }

  start(): void {
    this.loop.start();
  }

  togglePause(): void {
    this.paused = !this.paused;
    if (this.paused) {
      this.hud.setPauseButtons({
        resume: () => this.togglePause(),
        restart: this.race
          ? () => {
              this.togglePause();
              this.startRace(false);
            }
          : null,
        menu: this.race
          ? () => {
              this.togglePause();
              this.showMenu();
            }
          : null,
      });
    }
    this.hud.setPaused(this.paused);
    this.sfx.setPaused(this.paused);
  }

  /** The track menu: every track with your best times. Nothing is racing behind it. */
  showMenu(): void {
    this.race?.dispose();
    this.race = null;
    this.track = null;
    this.hazards = null;
    this.hints = null;
    this.paused = false;
    this.hud.setPaused(false);
    this.view.clearTrack();
    this.effects.clear();
    this.results.hide();
    this.startScreen.hide();
    this.hud.showCountdown(null);
    this.hud.setRace(false);
    for (const m of this.models) m.group.visible = false;
    this.ghostModel.group.visible = false;

    const entries: MenuEntry[] = TRACK_LIST.map((info) => {
      const name = info.name;
      return {
        id: info.id,
        name,
        blurb: info.blurb,
        features: info.features,
        track: () => createTrack(info.id) as Track,
        bestLap: this.records.bestLap(name),
        bestRace: this.records.bestRace(name),
        hasGhost: this.records.ghost(name) !== null,
      };
    });
    this.menu.show(entries, this.lastTrackId);
  }

  /** Builds a track, puts it on screen and sets up a race on it. With `wait`, shows the start screen first. */
  loadTrack(id: string, wait: boolean): void {
    const track = createTrack(id);
    if (!track) return;
    this.race?.dispose();
    this.race = null;
    this.track = track;
    this.lastTrackId = id;
    this.menu.hide();
    const mesh = buildTrackMesh(track);
    this.hazards = new Hazards(track);
    this.hints = new HintEngine(track, browserStore());
    this.hints.enabled = this.settings.hints;
    mesh.add(this.hazards.group);
    this.view.setTrack(mesh, track.minY);
    for (const m of this.models) m.group.visible = true;
    this.hud.setRace(true);
    this.startRace(wait);
  }

  /** Throws the current race away and sets up a fresh one. With `wait`, shows the start screen first. */
  startRace(wait: boolean): void {
    if (!this.track) return;
    this.race?.dispose();
    const race = new Race(this.track, { hold: wait });
    this.race = race;
    this.effects.clear();

    const bestLap = this.records.bestLap(this.track.name);
    this.previousBest = bestLap;
    this.newBestLap = null;
    this.waitingSince = null;
    race.setGhost(bestLap === null ? null : this.records.ghost(this.track.name));

    this.results.hide();
    this.hud.showCountdown(null);
    this.hud.showPopup('flip', '', '');
    if (wait) this.startScreen.show({ trackName: this.track.name, bestLap });
    else this.startScreen.hide();
  }

  /** The player is ready: hide the start screen and let the countdown run. */
  private beginRace(): void {
    this.startScreen.hide();
    if (this.race) this.race.waiting = false;
  }

  private loadCameraMode(): void {
    try {
      const text = browserStore()?.getItem(CAMERA_KEY);
      const saved = text === null || text === undefined ? NaN : Number(text);
      if (Number.isInteger(saved) && saved >= 0 && saved < CAM_UP_RATES.length) {
        this.cameraMode = saved;
      }
    } catch {
      // storage unavailable: keep the default
    }
    this.chase.upRate = CAM_UP_RATES[this.cameraMode] ?? this.chase.upRate;
  }

  /** C: smooth, quick, locked. Remembered for next time. */
  private cycleCamera(): void {
    this.cameraMode = (this.cameraMode + 1) % CAM_UP_RATES.length;
    this.chase.upRate = CAM_UP_RATES[this.cameraMode] ?? this.chase.upRate;
    this.hud.showNote(`CAMERA: ${CAM_MODE_NAMES[this.cameraMode] ?? ''}`);
    try {
      browserStore()?.setItem(CAMERA_KEY, String(this.cameraMode));
    } catch {
      // not saved: still works for this visit
    }
  }

  private step(): void {
    const input = this.keyboard.poll();
    this.lastInput = input;
    if (this.race) {
      this.race.step(input);
      const racers = this.race.racers;
      for (let i = 0; i < racers.length; i++)
        this.queueEffects(i, (racers[i] as RaceRacer).sim.events);
      for (const event of this.race.events) this.onRaceEvent(event, this.race);
      for (const event of this.race.player.sim.events) this.onSimEvent(event);
      const waiting = this.waitingSince;
      if (waiting !== null && !this.results.visible) {
        const everyoneIn = this.race.racers.every((r) => r.finished);
        if (everyoneIn || this.race.clock - waiting > RESULTS_WAIT_SECONDS) {
          this.waitingSince = null;
          this.results.show(this.resultsFor(this.race));
        }
      }
    } else if (this.sandbox) {
      this.sandbox.step(input);
      this.queueEffects(0, this.sandbox.events);
      for (const event of this.sandbox.events) this.onSimEvent(event);
    }
  }

  /** Remembers the events that cause a puff of gas, to draw them at the car on the next frame. */
  private queueEffects(racer: number, events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'hop') this.pendingEffects.push({ racer, type: 'hop', direction: 0 });
      else if (e.type === 'cushion')
        this.pendingEffects.push({ racer, type: 'cushion', direction: 0 });
      else if (e.type === 'dash')
        this.pendingEffects.push({ racer, type: 'dash', direction: e.direction });
    }
  }

  /** Puffs for one car this frame: the events it had, and the continuous jets while it boosts, glides or tilts. */
  private emitEffects(
    racer: number,
    sim: Sim,
    input: Input | null,
    pos: Vector3,
    quat: Quaternion,
    dt: number,
  ): void {
    const pose = this.emitter;
    pose.position.copy(pos);
    pose.quaternion.copy(quat);
    pose.velocity.copy(sim.car.velocity);
    for (const e of this.pendingEffects) {
      if (e.racer !== racer) continue;
      if (e.type === 'hop') this.effects.hop(pose);
      else if (e.type === 'dash') this.effects.dash(pose, e.direction);
      else if (e.type === 'ring') this.effects.ring(pose);
      else if (e.type === 'hit') this.effects.hit(pose);
      else this.effects.cushion(pose);
    }
    const stream = this.streamState;
    stream.boosting = sim.boosting;
    stream.gliding = sim.gliding;
    stream.retro = sim.retroing;
    stream.slam = sim.slamming;
    stream.airborne = !sim.attached;
    stream.pitch = input?.pitch ?? 0;
    stream.roll = input?.roll ?? 0;
    stream.steer = input?.steer ?? 0;
    this.effects.stream(racer, pose, stream, dt);
  }

  private onRaceEvent(event: RaceEvent, race: Race): void {
    if (!this.track) return;
    if (event.type === 'go') this.sfx.play('go');
    if (event.type === 'ring') {
      this.pendingEffects.push({ racer: event.racer, type: 'ring', direction: 0 });
      if (event.racer === 0) {
        this.hud.showPopup('flip', `+${RING_AIR} AIR`, 'RING', true);
        this.sfx.play('ring');
      }
    } else if (event.type === 'hit') {
      this.pendingEffects.push({ racer: event.racer, type: 'hit', direction: 0 });
      if (event.racer === 0) {
        this.hud.showPopup('crash', 'HIT', `+${BARRIER_PENALTY.toFixed(1)} S PENALTY`);
        this.sfx.play('hit');
        this.hints?.noteFailure();
        this.chase.addShake(SHAKE_CRASH);
      }
    }
    if (event.type === 'lap' && event.racer === 0) {
      this.sfx.play('lap');
      const isBest = this.records.saveLap(this.track.name, event.lapTime, event.ghost);
      if (isBest) {
        this.newBestLap = event.lapTime;
        race.setGhost(event.ghost); // the new best is the ghost for the laps still to come
      }
      if (event.lap < race.laps) {
        this.hud.showPopup(
          isBest ? 'perfect' : 'flip',
          isBest ? 'BEST LAP' : `LAP ${event.lap}`,
          formatTime(event.lapTime),
          true,
        );
      }
    } else if (event.type === 'finish' && event.racer === 0) {
      this.records.saveRace(this.track.name, event.time);
      this.sfx.play('finish');
      // Give the AI a few seconds to finish, so the standings show their times.
      this.waitingSince = race.clock;
      this.hud.showPopup('perfect', 'FINISH', `${event.place}${ordinalWord(event.place)}`);
    }
  }

  private resultsFor(race: Race): ResultsData {
    const player = race.player;
    const fastest = Math.min(...player.lapTimes);
    const best = this.previousBest;
    return {
      trackName: this.track?.name ?? '',
      place: player.place,
      racers: race.racers.length,
      time: player.finishTime,
      penalty: player.penaltyAtFinish,
      newBestLap: this.newBestLap,
      laps: player.lapTimes.map((time, i) => ({
        lap: i + 1,
        time,
        versusBest: best === null ? null : time - best,
        fastest: time === fastest && (best === null || time < best),
      })),
      standings: race.standings().map((r: RaceRacer, index) => ({
        name: r.name,
        place: index + 1,
        time: r.finished ? r.finishTime : null,
        isPlayer: r.isPlayer,
      })),
    };
  }

  private onSimEvent(event: SimEvent): void {
    switch (event.type) {
      case 'landing':
        if (event.kind === 'perfect') {
          this.hud.showPopup('perfect', 'PERFECT', `+${LAND_PERFECT_REFUND} AIR`);
          this.chase.addShake(SHAKE_PERFECT);
          this.sfx.play('perfect');
        } else if (event.kind === 'rough') {
          this.hud.showPopup('rough', 'ROUGH', 'SPEED x0.6');
          this.chase.addShake(SHAKE_ROUGH);
          this.sfx.play('rough');
        } else {
          this.hud.showPopup('crash', 'CRASH', `+${RESPAWN_PENALTY.toFixed(1)} S PENALTY`);
          this.chase.addShake(SHAKE_CRASH);
          this.sfx.play('crash');
          this.hints?.noteFailure();
        }
        break;
      case 'flip':
        this.hud.showPopup('flip', `+${FLIP_REFUND * event.count} AIR`, '', true);
        this.sfx.play('flip');
        break;
      case 'cushion':
        this.hud.showPopup('flip', `CUSHION -${CUSHION_COST} AIR`, '', true);
        this.sfx.play('cushion');
        break;
      case 'hopRefused':
        this.hud.flashEmpty();
        this.sfx.play('hopRefused');
        break;
      case 'respawn':
        this.sfx.play('respawn');
        this.hints?.noteFailure();
        if (event.reason === 'fell') {
          this.hud.showPopup(
            'crash',
            'OFF TRACK',
            `+${RESPAWN_PENALTY.toFixed(1)} S PENALTY`,
            true,
          );
        } else if (event.reason === 'key') {
          this.hud.showPopup('rough', 'RESPAWN', `+${RESPAWN_PENALTY.toFixed(1)} S PENALTY`, true);
        }
        break;
      case 'hop':
        this.sfx.play('hop');
        break;
      case 'dash':
        this.sfx.play('dash');
        break;
    }
  }

  /** The player's state for the hint engine, in one object that is reused. */
  private hintFor(race: Race, sim: Sim, guide: LandingGuide | null): HintState {
    const state = this.hintState;
    state.index = race.player.progress.index;
    state.attached = sim.attached;
    state.air = sim.air.value;
    state.groundDistance = sim.sensor.found ? sim.sensor.distance : Infinity;
    state.guide = guide;
    return state;
  }

  private render(alpha: number, frameTime: number): void {
    const fxTime = this.paused || this.results.visible ? 0 : frameTime; // the puffs freeze with the game
    const race = this.race;
    if (!race && !this.sandbox) {
      this.speedLines.update(0, 0, false); // clears any streaks left from the race
      this.view.render(); // the menu is up: just the backdrop
      return;
    }
    const playerSim = race ? race.player.sim : (this.sandbox as Sim);

    if (race) {
      for (let i = 0; i < race.racers.length; i++) {
        const r = race.racers[i] as RaceRacer;
        r.sim.getRenderPose(alpha, this.pos, this.quat);
        const speed = r.sim.car.velocity.dot(r.sim.car.forward);
        this.models[i]?.update(this.pos, this.quat, speed, frameTime, r.sim.boosting);
        this.emitEffects(
          i,
          r.sim,
          r.isPlayer ? this.lastInput : r.input,
          this.pos,
          this.quat,
          fxTime,
        );
      }
      const showGhost = race.ghostPose(this.pos, this.quat);
      this.ghostModel.group.visible = showGhost;
      if (showGhost) this.ghostModel.update(this.pos, this.quat, 0, frameTime, false);
    } else {
      playerSim.getRenderPose(alpha, this.pos, this.quat);
      const speed = playerSim.car.velocity.dot(playerSim.car.forward);
      this.models[0]?.update(this.pos, this.quat, speed, frameTime, playerSim.boosting);
      this.emitEffects(0, playerSim, this.lastInput, this.pos, this.quat, fxTime);
    }
    this.pendingEffects.length = 0;
    this.hazards?.update(fxTime, race ? race.player.ringsTaken : null);
    // pixels per metre at distance one, so a puff keeps the same size on screen whatever the window is
    this.view.renderer.getDrawingBufferSize(this.bufferSize);
    this.effects.update(
      fxTime,
      0.5 * this.bufferSize.y * this.view.camera.projectionMatrix.elements[5]!,
    );

    // The camera and the HUD follow the player.
    playerSim.getRenderPose(alpha, this.pos, this.quat);
    this.chase.update(frameTime, this.pos, this.quat, playerSim.car.velocity, playerSim.speed);
    this.view.follow(this.pos);
    this.chase.setRumble(playerSim.boosting && fxTime > 0 ? SHAKE_BOOST : 0);
    this.speedLines.update(fxTime, playerSim.speed, playerSim.boosting);
    this.hud.update(
      playerSim.air.value,
      playerSim.speed,
      playerSim.boosting,
      playerSim.crashed,
      playerSim.onChargeStrip && playerSim.attached,
    );

    const guide =
      race && race.state !== 'countdown'
        ? landingGuide(playerSim, race.track, race.player.progress.index)
        : null;
    this.hud.setLanding(guide);
    // hints, only while racing and not paused
    const hint =
      race && this.hints && race.state === 'racing' && !this.paused && !race.player.finished
        ? this.hints.update(this.hintFor(race, playerSim, guide))
        : null;
    this.hud.setHint(hint);

    if (race) {
      const readout = this.readout;
      readout.place = race.playerPlace;
      readout.racers = race.racers.length;
      readout.lap = race.player.lap;
      readout.laps = race.laps;
      readout.time = race.state === 'countdown' ? 0 : race.clock + race.player.sim.penalty;
      readout.penalty = race.player.sim.penalty;
      readout.ghostGap = race.ghostGap;
      this.hud.updateRace(readout);
      this.hud.showCountdown(
        race.waiting
          ? null
          : race.state === 'countdown'
            ? String(race.countdownNumber)
            : race.clock < GO_SECONDS
              ? 'GO'
              : null,
      );
    }

    // Which way is really up, on the screen: world up in the camera's view, as an angle from the top.
    this.tmpQuat.copy(this.view.camera.quaternion).invert();
    this.tmpUp.set(0, 1, 0).applyQuaternion(this.tmpQuat);
    this.hud.setHorizon((Math.atan2(this.tmpUp.x, this.tmpUp.y) * 180) / Math.PI);

    this.updateSound(race, playerSim);
    this.debug?.update(playerSim, frameTime, race ? this.raceDebugLines(race) : []);
    this.view.render();
  }

  /** Feeds the engine and thruster sounds from the player's car, and ticks the countdown. */
  private updateSound(race: Race | null, sim: Sim): void {
    const active =
      !this.paused &&
      !this.menu.visible &&
      !this.startScreen.visible &&
      !this.results.visible &&
      !(race?.waiting ?? false);
    const input = this.lastInput;
    this.sfx.update({
      active,
      speed: sim.speed,
      attached: sim.attached,
      boosting: sim.boosting,
      gliding: sim.gliding,
      retro: sim.retroing,
      slam: sim.slamming,
      jets:
        !sim.attached &&
        input !== null &&
        (input.pitch !== 0 || input.roll !== 0 || input.steer !== 0),
    });
    const count = race && active && race.state === 'countdown' ? race.countdownNumber : 0;
    if (count !== this.lastCountdown && count > 0) this.sfx.play('tick');
    this.lastCountdown = count;
  }

  private raceDebugLines(race: Race): string[] {
    const p = race.player;
    return [
      `race      ${race.state}  clock ${race.clock.toFixed(2)} s`,
      `lap       ${p.lap}/${race.laps}  next gate ${p.nextGate}/${race.track.gates.length}`,
      `place     ${race.playerPlace}/${race.racers.length}  lap distance ${p.lapProgress(race.track).toFixed(0)} m`,
      `ghost gap ${race.ghostGap === null ? '-' : race.ghostGap.toFixed(2) + ' s'}`,
      `best lap  ${this.records.bestLap(race.track.name)?.toFixed(3) ?? '-'}`,
    ];
  }
}

/** 1 becomes st, 2 nd, 3 rd, 4 th. */
function ordinalWord(n: number): string {
  return ordinal(n).toLowerCase();
}

/** Whether a name is one of the tracks that can be opened. */
function createTrackId(id: string): boolean {
  return TRACK_LIST.some((t) => t.id === id) || id === 'test';
}

/** Whether the player turned the sound off on an earlier visit. */
function readMuted(): boolean {
  try {
    return browserStore()?.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
