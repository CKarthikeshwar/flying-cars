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
  /** True while Space has been held long enough to glide (a tap is a hop). Air only. */
  glide: boolean;
  /** -1 to +1. +1 pitches the nose down (W), -1 pitches it up (S). Air only. */
  pitch: number;
  /** -1 to +1. +1 rolls right (E), -1 rolls left (Q). Air only. */
  roll: number;
  /** True for exactly one step per key press. */
  respawn: boolean;
  /** -1 (left), +1 (right) for exactly one step after a double tap of A or D, else 0. */
  dash: number;
  /** True while held: the front jets fire to brake hard. Surface only. */
  retro: boolean;
  /** True while held: a downward jet pulls the car to the nearest surface. Air only. */
  slam: boolean;
  /** How a hop goes: 1 leans it forward into a long jump (boost held), -1 makes it a steep high hop (S held), 0 normal. */
  hopStyle: number;
}

export function createInput(): Input {
  return {
    steer: 0,
    throttle: 0,
    brake: 0,
    hop: false,
    boost: false,
    glide: false,
    pitch: 0,
    roll: 0,
    respawn: false,
    dash: 0,
    retro: false,
    slam: false,
    hopStyle: 0,
  };
}
