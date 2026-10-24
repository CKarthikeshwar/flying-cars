import {
  SOUND_ENGINE_BASE_HZ,
  SOUND_ENGINE_HZ_PER_MS,
  SOUND_MASTER,
  SOUND_SMOOTHING,
} from '../util/constants';

/** One-off sounds. */
export type SfxKind =
  | 'hop'
  | 'hopRefused'
  | 'cushion'
  | 'flip'
  | 'perfect'
  | 'rough'
  | 'crash'
  | 'dash'
  | 'ring'
  | 'hit'
  | 'respawn'
  | 'tick'
  | 'go'
  | 'lap'
  | 'finish';

/** What the continuous sounds follow, once per frame. */
export interface SoundState {
  /** True while a race or the sandbox is running and not paused: otherwise the engine is silent. */
  active: boolean;
  speed: number;
  attached: boolean;
  boosting: boolean;
  gliding: boolean;
  retro: boolean;
  slam: boolean;
  /** Air control jets are firing (tilting or steering in the air). */
  jets: boolean;
}

/** Pitch of the engine hum for a speed in m/s: it rises steadily, so you can hear how fast you are going. */
export function engineFrequency(speed: number): number {
  return SOUND_ENGINE_BASE_HZ + Math.max(0, speed) * SOUND_ENGINE_HZ_PER_MS;
}

/** Loudness of the engine hum, 0 to about 0.12: off when inactive, quiet in the air where nothing drives the wheels. */
export function engineLevel(state: SoundState): number {
  if (!state.active) return 0;
  const speedPart = Math.min(1, state.speed / 60);
  const base = 0.035 + 0.06 * speedPart;
  const grounded = state.attached ? 1 : 0.35;
  return base * grounded * (state.boosting ? 1.3 : 1);
}

/** The thruster hiss: how loud (0 to about 0.14), and where its pitch sits, for the busiest jet at the moment. */
export function hissLevel(state: SoundState): { level: number; hz: number } {
  if (!state.active) return { level: 0, hz: 1500 };
  if (state.boosting) return { level: 0.12, hz: 1500 };
  if (state.retro) return { level: 0.12, hz: 2300 };
  if (state.slam) return { level: 0.1, hz: 1100 };
  if (state.gliding) return { level: 0.07, hz: 2600 };
  if (state.jets) return { level: 0.045, hz: 3600 };
  return { level: 0, hz: 1500 };
}

type Wave = OscillatorType;

/**
 * All the game's sounds, made in code with the Web Audio API: an engine hum that follows the speed, a hiss for
 * the thrusters, and short effects for hops, landings, flips and the rest. Nothing is downloaded.
 *
 * Browsers keep audio silent until the player has pressed a key, so the sound system builds itself on the first
 * key press or click. Until then every call does nothing, which also keeps it safe where there is no Web Audio.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineOscillators: { osc: OscillatorNode; ratio: number }[] = [];
  private hissGain: GainNode | null = null;
  private hissFilter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted: boolean;
  private paused = false;
  private volume = 1;
  private readonly factory: (() => AudioContext) | null;

  /** Called when the mute state changes, so it can be saved. */
  onMuteChange: (muted: boolean) => void = () => {};

  constructor(muted = false, factory: (() => AudioContext) | null = defaultFactory()) {
    this.muted = muted;
    this.factory = factory;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** True once the audio system has been built (after the first key press). */
  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Listens for the first key press or click, which is when the browser lets sound start. */
  attach(target: Window): void {
    const unlock = (): void => {
      this.unlock();
      if (this.ctx) {
        target.removeEventListener('keydown', unlock);
        target.removeEventListener('pointerdown', unlock);
      }
    };
    target.addEventListener('keydown', unlock);
    target.addEventListener('pointerdown', unlock);
  }

  /** Builds the audio graph (once) and starts the context. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    if (!this.factory) return;
    let ctx: AudioContext;
    try {
      ctx = this.factory();
    } catch {
      return; // no audio here: the game is just quiet
    }
    this.ctx = ctx;
    void ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.value = this.masterTarget();
    this.master.connect(ctx.destination);

    // the engine: a low saw, a fifth above it and a sub an octave below, through a filter that opens with speed
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    const layers: [Wave, number, number][] = [
      ['sawtooth', 1, 1],
      ['square', 1.5, 0.35],
      ['sine', 0.5, 0.9],
    ];
    for (const [type, ratio, level] of layers) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = engineFrequency(0) * ratio;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g);
      g.connect(this.engineFilter);
      osc.start();
      this.engineOscillators.push({ osc, ratio });
    }

    // the thruster hiss: looped noise through a band-pass filter
    this.noise = makeNoise(ctx);
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noise;
    hiss.loop = true;
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'bandpass';
    this.hissFilter.frequency.value = 1500;
    this.hissFilter.Q.value = 0.8;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    hiss.connect(this.hissFilter);
    this.hissFilter.connect(this.hissGain);
    this.hissGain.connect(this.master);
    hiss.start();
  }

  /** M: sound on or off. Returns the new state. */
  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
    this.onMuteChange(muted);
  }

  /** The player's volume setting, 0 to 1, on top of the built-in loudness. */
  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyMaster();
  }

  /** While paused everything goes quiet. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyMaster();
  }

  /** Moves the engine and the hiss toward what the car is doing now. Call every frame. */
  update(state: SoundState): void {
    const ctx = this.ctx;
    if (!ctx || !this.engineGain || !this.engineFilter || !this.hissGain || !this.hissFilter)
      return;
    const now = ctx.currentTime;
    const hz = engineFrequency(state.speed);
    for (const { osc, ratio } of this.engineOscillators) {
      osc.frequency.setTargetAtTime(hz * ratio, now, SOUND_SMOOTHING);
    }
    this.engineFilter.frequency.setTargetAtTime(350 + state.speed * 18, now, SOUND_SMOOTHING);
    this.engineGain.gain.setTargetAtTime(engineLevel(state), now, SOUND_SMOOTHING);
    const hiss = hissLevel(state);
    this.hissGain.gain.setTargetAtTime(hiss.level, now, SOUND_SMOOTHING);
    this.hissFilter.frequency.setTargetAtTime(hiss.hz, now, SOUND_SMOOTHING);
  }

  /** Plays one effect now. */
  play(kind: SfxKind): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime;
    switch (kind) {
      case 'hop':
        this.tone(150, t, 0.16, 'sine', 0.35, 50);
        this.burst(t, 0.12, 'highpass', 2500, 0.18);
        break;
      case 'hopRefused':
        this.tone(110, t, 0.07, 'square', 0.08, 90);
        break;
      case 'cushion':
        this.burst(t, 0.22, 'lowpass', 1400, 0.22, 300);
        break;
      case 'flip':
        this.tone(660, t, 0.12, 'sine', 0.18);
        this.tone(990, t + 0.08, 0.18, 'sine', 0.18);
        break;
      case 'perfect':
        this.tone(170, t, 0.14, 'sine', 0.3, 60);
        this.tone(1320, t + 0.02, 0.22, 'sine', 0.12);
        break;
      case 'rough':
        this.tone(130, t, 0.2, 'sine', 0.45, 45);
        this.burst(t, 0.18, 'lowpass', 500, 0.3);
        break;
      case 'crash':
        this.burst(t, 0.6, 'lowpass', 900, 0.5, 120);
        this.tone(120, t, 0.5, 'sawtooth', 0.25, 35);
        break;
      case 'dash':
        this.burst(t, 0.2, 'bandpass', 600, 0.28, 3000);
        break;
      case 'ring':
        [523, 659, 784].forEach((f, i) => this.tone(f, t + i * 0.055, 0.2, 'sine', 0.16));
        break;
      case 'hit':
        this.burst(t, 0.25, 'bandpass', 800, 0.45, 200);
        this.tone(90, t, 0.25, 'square', 0.22, 40);
        break;
      case 'respawn':
        this.tone(600, t, 0.4, 'sawtooth', 0.12, 150);
        break;
      case 'tick':
        this.tone(440, t, 0.09, 'sine', 0.2);
        break;
      case 'go':
        this.tone(880, t, 0.35, 'sine', 0.25);
        break;
      case 'lap':
        this.tone(660, t, 0.15, 'sine', 0.18);
        this.tone(880, t + 0.1, 0.25, 'sine', 0.18);
        break;
      case 'finish':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.1, 0.4, 'sine', 0.2));
        break;
    }
  }

  private masterTarget(): number {
    return this.muted || this.paused ? 0 : SOUND_MASTER * this.volume;
  }

  private applyMaster(): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.masterTarget(), this.ctx.currentTime, 0.03);
  }

  /** A tone that fades out, optionally sliding to `endHz`. */
  private tone(
    hz: number,
    start: number,
    length: number,
    wave: Wave,
    level: number,
    endHz?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(hz, start);
    if (endHz !== undefined) osc.frequency.exponentialRampToValueAtTime(endHz, start + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(start);
    osc.stop(start + length + 0.02);
  }

  /** A burst of filtered noise that fades out, optionally sweeping the filter to `endHz`. */
  private burst(
    start: number,
    length: number,
    filter: BiquadFilterType,
    hz: number,
    level: number,
    endHz?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(hz, start);
    if (endHz !== undefined) f.frequency.exponentialRampToValueAtTime(endHz, start + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    source.connect(f);
    f.connect(gain);
    gain.connect(this.master);
    source.start(start);
    source.stop(start + length + 0.02);
  }
}

/** One second of white noise. */
function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** The browser's audio, or null where there is none (tests, very old browsers). */
function defaultFactory(): (() => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? () => new Ctor() : null;
}
