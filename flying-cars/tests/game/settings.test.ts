import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { Sfx } from '../../src/audio/sfx';
import { Keyboard } from '../../src/input/keyboard';
import { Settings, SettingsCursor, SETTINGS_KEY, SETTING_DEFS } from '../../src/game/settings';
import { ChaseCamera } from '../../src/render/camera';
import { SOUND_MASTER } from '../../src/util/constants';

/** A store that lives in memory, like the browser's. */
class MemoryStore {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('Settings', () => {
  it('starts with volume at 80% and the normal amount of camera shake', () => {
    const s = new Settings(new MemoryStore());
    expect(s.volume).toBeCloseTo(0.8);
    expect(s.shake).toBe(1);
  });

  it('keeps every value inside its range and on its steps', () => {
    const s = new Settings(null);
    s.set('volume', 7);
    expect(s.volume).toBe(1);
    s.set('volume', -3);
    expect(s.volume).toBe(0);
    s.set('shake', 0.37);
    expect(s.shake).toBe(0.25);
    s.set('shake', 5);
    expect(s.shake).toBe(2);
    s.set('volume', Number.NaN);
    expect(s.volume).toBe(0); // a bad value changes nothing
  });

  it('does not drift when stepped many times', () => {
    const s = new Settings(null);
    s.set('volume', 0);
    for (let i = 0; i < 3; i++) s.nudge('volume', 1);
    expect(s.volume).toBe(0.3);
    for (let i = 0; i < 20; i++) s.nudge('volume', 1);
    expect(s.volume).toBe(1);
    for (let i = 0; i < 20; i++) s.nudge('volume', -1);
    expect(s.volume).toBe(0);
  });

  it('saves on every change and loads the same values next time', () => {
    const store = new MemoryStore();
    const first = new Settings(store);
    first.set('volume', 0.3);
    first.set('shake', 0);
    expect(store.data.has(SETTINGS_KEY)).toBe(true);
    const second = new Settings(store);
    expect(second.volume).toBe(0.3);
    expect(second.shake).toBe(0);
  });

  it('tells the game after a change, and not when nothing changed', () => {
    const s = new Settings(null);
    const seen: number[] = [];
    s.onChange = (v) => seen.push(v.volume);
    s.set('volume', 0.5);
    s.set('volume', 0.5);
    s.nudge('volume', 1);
    expect(seen).toEqual([0.5, 0.6]);
  });

  it('shrugs off saved data that is broken, missing or wrong', () => {
    for (const text of ['not json', '[]', 'null', '{"volume":"loud"}', '{"shake":null}', '']) {
      const store = new MemoryStore();
      store.setItem(SETTINGS_KEY, text);
      const s = new Settings(store);
      expect(s.volume).toBeCloseTo(0.8);
      expect(s.shake).toBe(1);
    }
    const store = new MemoryStore();
    store.setItem(SETTINGS_KEY, '{"volume":9,"shake":-1}');
    const clamped = new Settings(store);
    expect(clamped.volume).toBe(1);
    expect(clamped.shake).toBe(0);
  });

  it('survives a store that refuses to save or load', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    const s = new Settings(broken);
    expect(() => s.set('volume', 0.2)).not.toThrow();
    expect(s.volume).toBe(0.2);
  });
});

describe('the settings screen keys', () => {
  it('up and down move between rows and wrap round', () => {
    const cursor = new SettingsCursor(new Settings(null));
    expect(cursor.current.key).toBe('volume');
    cursor.move(1);
    expect(cursor.current.key).toBe('shake');
    cursor.move(1);
    expect(cursor.current.key).toBe('hints');
    cursor.move(1);
    expect(cursor.current.key).toBe('volume');
    cursor.move(-1);
    expect(cursor.current.key).toBe('hints');
    expect(SETTING_DEFS.length).toBe(3);
  });

  it('left and right change the picked row by one step each', () => {
    const s = new Settings(null);
    const cursor = new SettingsCursor(s);
    cursor.adjust(1);
    expect(s.volume).toBeCloseTo(0.9);
    cursor.adjust(-1);
    cursor.adjust(-1);
    expect(s.volume).toBeCloseTo(0.7);
    cursor.move(1);
    cursor.adjust(1);
    expect(s.shake).toBe(1.25);
    expect(s.volume).toBeCloseTo(0.7); // the other row is left alone
  });

  it('hints is a switch: on by default, one step turns it off, and it stays off or on', () => {
    const s = new Settings(null);
    expect(s.hints).toBe(true);
    const cursor = new SettingsCursor(s);
    cursor.select(2);
    cursor.adjust(-1);
    expect(s.hints).toBe(false);
    cursor.adjust(-1);
    expect(s.hints).toBe(false);
    cursor.adjust(1);
    expect(s.hints).toBe(true);
  });

  it('picking a row by the mouse works, and a bad index is ignored', () => {
    const cursor = new SettingsCursor(new Settings(null));
    cursor.select(1);
    expect(cursor.current.key).toBe('shake');
    cursor.select(9);
    cursor.select(-1);
    expect(cursor.current.key).toBe('shake');
  });

  it('the keyboard reports the left and right arrows', () => {
    const kb = new Keyboard();
    const seen: number[] = [];
    kb.onSide = (d) => seen.push(d);
    const press = (code: string) =>
      (kb as unknown as { keyDown: (e: object) => void }).keyDown({
        code,
        repeat: false,
        shiftKey: false,
        timeStamp: 0,
        preventDefault() {},
      });
    press('ArrowLeft');
    press('ArrowRight');
    press('KeyA');
    expect(seen).toEqual([-1, 1]);
  });
});

/** An audio parameter that remembers the last value it was steered toward. */
class Param {
  value = 0;
  target: number | null = null;
  setValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
  setTargetAtTime(v: number): void {
    this.target = v;
  }
}

class Node {
  readonly gain = new Param();
  readonly frequency = new Param();
  readonly Q = new Param();
  type = '';
  connect(): void {}
  start(): void {}
  stop(): void {}
}

describe('what the settings do', () => {
  it('volume scales the master level of the sound, and zero is silent', () => {
    const gains: Node[] = [];
    const context = {
      currentTime: 0,
      sampleRate: 10,
      destination: {},
      resume: () => Promise.resolve(),
      createGain: () => {
        const g = new Node();
        gains.push(g);
        return g;
      },
      createOscillator: () => new Node(),
      createBiquadFilter: () => new Node(),
      createBufferSource: () => new Node(),
      createBuffer: () => ({ getChannelData: () => new Float32Array(10) }),
    };
    const sfx = new Sfx(false, () => context as unknown as AudioContext);
    sfx.unlock();
    const master = gains[0] as Node; // the first gain built is the master
    sfx.setVolume(0.5);
    expect(master.gain.target).toBeCloseTo(SOUND_MASTER * 0.5);
    sfx.setVolume(0);
    expect(master.gain.target).toBe(0);
    sfx.setVolume(5);
    expect(master.gain.target).toBeCloseTo(SOUND_MASTER); // never louder than full
  });

  it('camera shake scales every shake, and zero removes it', () => {
    const stored = (scale: number): number => {
      const chase = new ChaseCamera(new PerspectiveCamera());
      chase.shakeScale = scale;
      chase.addShake(0.4);
      return (chase as unknown as { shake: number }).shake;
    };
    expect(stored(1)).toBeCloseTo(0.4);
    expect(stored(2)).toBeCloseTo(0.8);
    expect(stored(0.5)).toBeCloseTo(0.2);
    expect(stored(0)).toBe(0);
  });

  it('a camera with shake turned off does not move when the car crashes', () => {
    const settle = (scale: number): number => {
      const camera = new PerspectiveCamera();
      const chase = new ChaseCamera(camera);
      chase.shakeScale = scale;
      const still = new Vector3(0, 0, 0);
      const quat = new Quaternion();
      for (let i = 0; i < 60; i++) chase.update(1 / 60, still, quat, new Vector3(), 0);
      const rest = camera.position.clone();
      chase.addShake(0.6);
      let moved = 0;
      for (let i = 0; i < 10; i++) {
        chase.update(1 / 60, still, quat, new Vector3(), 0);
        moved = Math.max(moved, camera.position.distanceTo(rest));
      }
      return moved;
    };
    expect(settle(0)).toBeLessThan(1e-6);
    expect(settle(1)).toBeGreaterThan(0.01);
  });
});

describe('camera rumble', () => {
  const wobble = (scale: number, rumble: number): number => {
    const camera = new PerspectiveCamera();
    const chase = new ChaseCamera(camera);
    chase.shakeScale = scale;
    const still = new Vector3(0, 0, 0);
    const quat = new Quaternion();
    for (let i = 0; i < 60; i++) chase.update(1 / 60, still, quat, new Vector3(), 0);
    const rest = camera.position.clone();
    chase.setRumble(rumble);
    let moved = 0;
    for (let i = 0; i < 30; i++) {
      chase.update(1 / 60, still, quat, new Vector3(), 0);
      moved = Math.max(moved, camera.position.distanceTo(rest));
    }
    return moved;
  };

  it('a steady rumble moves the camera, follows the shake setting, and stops when set to 0', () => {
    expect(wobble(1, 0.1)).toBeGreaterThan(0.01);
    expect(wobble(0, 0.1)).toBeLessThan(1e-6);
    expect(wobble(1, 0)).toBeLessThan(1e-6);
  });

  it('the shake is smooth: the camera moves only a little between two frames', () => {
    const camera = new PerspectiveCamera();
    const chase = new ChaseCamera(camera);
    const still = new Vector3();
    const quat = new Quaternion();
    for (let i = 0; i < 60; i++) chase.update(1 / 60, still, quat, new Vector3(), 0);
    chase.addShake(0.4);
    let last = camera.position.clone();
    let biggest = 0;
    for (let i = 0; i < 20; i++) {
      chase.update(1 / 60, still, quat, new Vector3(), 0);
      biggest = Math.max(biggest, camera.position.distanceTo(last));
      last = camera.position.clone();
    }
    expect(biggest).toBeLessThan(0.4 * 1.5); // random jitter could jump twice the shake amount
  });
});
