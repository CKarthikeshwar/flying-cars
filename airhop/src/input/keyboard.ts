import { createInput, type Input } from '../physics/Input';

/** Keys the game uses. Their default browser behaviour (page scroll, tab focus) is suppressed. */
const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyR',
  'Space',
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
  private readonly input = createInput();

  /** Called once when Esc is pressed. */
  onPause: () => void = () => {};
  /** Called when T is pressed (debug slow motion). */
  onSlowMo: () => void = () => {};
  /** Called when M is pressed. */
  onMute: () => void = () => {};

  attach(target: Window): void {
    target.addEventListener('keydown', this.keyDown);
    target.addEventListener('keyup', this.keyUp);
    target.addEventListener('blur', this.clear);
  }

  detach(target: Window): void {
    target.removeEventListener('keydown', this.keyDown);
    target.removeEventListener('keyup', this.keyUp);
    target.removeEventListener('blur', this.clear);
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
    i.respawn = this.respawnPressed;
    this.hopPressed = false;
    this.respawnPressed = false;
    return i;
  }

  private readonly keyDown = (e: KeyboardEvent): void => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    if (e.code === 'Space') this.hopPressed = true;
    else if (e.code === 'KeyR') this.respawnPressed = true;
    else if (e.code === 'Escape') this.onPause();
    else if (e.code === 'KeyT') this.onSlowMo();
    else if (e.code === 'KeyM') this.onMute();
  };

  private readonly keyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly clear = (): void => {
    this.down.clear();
  };
}
