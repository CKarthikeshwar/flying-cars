/** One step of control input. The keyboard and the AI both fill this same object. */
export interface Input {
  /** -1 (left) to +1 (right). On a surface it steers, in the air it yaws. */
  steer: number;
  /** 0 to 1. */
  throttle: number;
  /** 0 to 1. Brakes, then reverses. */
  brake: number;
  /** True for exactly one step per key press. */
  hop: boolean;
  /** True while held. */
  boost: boolean;
  /** -1 to +1. +1 pitches the nose down (W), -1 pitches it up (S). Air only. */
  pitch: number;
  /** -1 to +1. +1 rolls right (E), -1 rolls left (Q). Air only. */
  roll: number;
  /** True for exactly one step per key press. */
  respawn: boolean;
}

export function createInput(): Input {
  return { steer: 0, throttle: 0, brake: 0, hop: false, boost: false, pitch: 0, roll: 0, respawn: false };
}
