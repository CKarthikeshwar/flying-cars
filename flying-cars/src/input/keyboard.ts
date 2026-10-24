import { createInput, type Input } from '../physics/Input';
import { DASH_DOUBLE_TAP, GLIDE_HOLD_SECONDS, PHYSICS_DT } from '../util/constants';

/** Keys the game uses. Their default browser behaviour (page scroll, tab focus) is suppressed. */
const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyX',
  'KeyR',
  'Space',
  'KeyC',
  'Enter',
  'Backspace',
  'KeyH',
  'ShiftLeft',
  'ShiftRight',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/**
 * Turns key state into one plain Input object each physics step.
 * Hop and respawn are one-shot: a press is held until the next poll() reads it, then cleared,
 * so a quick tap between two steps is never lost and one press never hops twice.
 */
export class Keyboard {
  private readonly down = new Set<string>();
  private hopPressed = false;
  private respawnPressed = false;
  private spaceHeldSteps = 0;
  private dashPressed = 0;
  private lastTap = { KeyA: -Infinity, KeyD: -Infinity };
  private readonly input = createInput();

  /** Called once when Esc is pressed. */
  onPause: () => void = () => {};
  /** Called when T is pressed (debug slow motion). */
  onSlowMo: () => void = () => {};
  /** Called when Enter is pressed. */
  onConfirm: () => void = () => {};
  /** Called when C is pressed (cycle the camera). */
  onCamera: () => void = () => {};
  /** Called when the left or right arrow is pressed: -1 for left, +1 for right. For the settings. */
  onSide: (direction: number) => void = () => {};
  /** Called when the up or down arrow is pressed: -1 for up, +1 for down. For the menu. */
  onArrow: (direction: number) => void = () => {};
  /** Called when H is pressed (show or hide the controls in the menu). */
  onHelp: () => void = () => {};
  /** Called when Backspace is pressed (back to the menu). */
  onBack: () => void = () => {};
  /** Called when M is pressed. */
  onMute: () => void = () => {};

  attach(target: Window): void {
    target.addEventListener('keydown', this.keyDown);
    target.addEventListener('keyup', this.keyUp);
    target.addEventListener('blur', this.clear);
    target.addEventListener('focusout', this.clear);
    document.addEventListener('visibilitychange', this.clear);
  }

  detach(target: Window): void {
    target.removeEventListener('keydown', this.keyDown);
    target.removeEventListener('keyup', this.keyUp);
    target.removeEventListener('blur', this.clear);
    target.removeEventListener('focusout', this.clear);
    document.removeEventListener('visibilitychange', this.clear);
  }

  /** Reads the keys into the shared Input object. Call once per physics step. */
  poll(): Input {
    const k = this.down;
    const i = this.input;
    const pressed = (code: string, alt: string) => (k.has(code) || k.has(alt) ? 1 : 0);
    const w = pressed('KeyW', 'ArrowUp');
    const s = pressed('KeyS', 'ArrowDown');
    i.throttle = w;
    i.brake = s;
    i.steer = pressed('KeyD', 'ArrowRight') - pressed('KeyA', 'ArrowLeft');
    i.pitch = w - s; // W pitches the nose down in the air, S pitches it up
    i.roll = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    i.boost = k.has('ShiftLeft') || k.has('ShiftRight');
    i.hop = this.hopPressed;
    // Holding Space long enough is a glide. The first press is still the hop.
    this.spaceHeldSteps = k.has('Space') ? this.spaceHeldSteps + 1 : 0;
    i.glide = this.spaceHeldSteps * PHYSICS_DT >= GLIDE_HOLD_SECONDS;
    i.respawn = this.respawnPressed;
    i.dash = this.dashPressed;
    i.retro = s === 1;
    i.slam = k.has('KeyX');
    i.hopStyle = s === 1 ? -1 : i.boost ? 1 : 0;
    this.hopPressed = false;
    this.respawnPressed = false;
    this.dashPressed = 0;
    return i;
  }

  private readonly keyDown = (e: KeyboardEvent): void => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    this.reconcileShift(e);
    if (e.repeat) return;
    this.down.add(e.code);
    if (e.code === 'Space') this.hopPressed = true;
    else if (e.code === 'KeyR') this.respawnPressed = true;
    else if (e.code === 'KeyA' || e.code === 'KeyD') this.tap(e.code, e.timeStamp / 1000);
    else if (e.code === 'Escape') this.onPause();
    else if (e.code === 'KeyT') this.onSlowMo();
    else if (e.code === 'KeyC') this.onCamera();
    else if (e.code === 'KeyM') this.onMute();
    else if (e.code === 'Enter') this.onConfirm();
    else if (e.code === 'Backspace') this.onBack();
    else if (e.code === 'KeyH') this.onHelp();
    if (e.code === 'ArrowLeft') this.onSide(-1);
    else if (e.code === 'ArrowRight') this.onSide(1);
    if (e.code === 'ArrowUp') this.onArrow(-1);
    else if (e.code === 'ArrowDown') this.onArrow(1);
  };

  /** Two quick taps of the same side key make a dash that way. */
  private tap(code: 'KeyA' | 'KeyD', time: number): void {
    if (time - this.lastTap[code] <= DASH_DOUBLE_TAP) {
      this.dashPressed = code === 'KeyA' ? -1 : 1;
      this.lastTap[code] = -Infinity;
    } else {
      this.lastTap[code] = time;
    }
  }

  private readonly keyUp = (e: KeyboardEvent): void => {
    this.reconcileShift(e);
    this.down.delete(e.code);
  };

  /**
   * Browsers can lose the key-up for Shift (a screenshot shortcut, an alt-tab). Every key event says whether
   * Shift is down right now, so use that to clear a Shift that is stuck.
   */
  private reconcileShift(e: KeyboardEvent): void {
    if (!e.shiftKey) {
      this.down.delete('ShiftLeft');
      this.down.delete('ShiftRight');
    }
  }

  private readonly clear = (): void => {
    this.down.clear();
  };
}
