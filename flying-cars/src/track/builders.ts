import { Quaternion, Vector3 } from 'three';

const DEG = Math.PI / 180;
const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * A pen that lays out track control points piece by piece, each piece starting where the last one ended.
 * In its own frame the pen faces -z, its up is +y and its right is +x. Pieces emit a point every `spacing` metres.
 */
export class Pen {
  readonly points: Vector3[] = [];
  /** Distance travelled so far, measured along the emitted points. */
  length = 0;

  private readonly position = new Vector3();
  private readonly orientation = new Quaternion();
  private readonly spacing: number;
  private readonly local = new Vector3();
  private readonly last = new Vector3();

  constructor(start = new Vector3(), spacing = 5) {
    this.spacing = spacing;
    this.position.copy(start);
    this.last.copy(start);
    this.points.push(start.clone());
  }

  /**
   * Straight ahead. With `rise` the road climbs (or, negative, descends) by that many metres over the piece,
   * easing in and out so the slope starts and ends at zero and the road never kinks.
   */
  straight(length: number, rise = 0): this {
    const n = Math.max(1, Math.ceil(length / this.spacing));
    for (let k = 1; k <= n; k++) this.emit(0, rise * smoothstep(k / n), (-length * k) / n);
    this.advance(0, rise, -length, 0);
    return this;
  }

  /** A turn of `angleDeg` degrees with the given radius. With `rise` it climbs as it goes round, like a spiral ramp. */
  turn(angleDeg: number, radius: number, side: 'left' | 'right', rise = 0): this {
    const angle = angleDeg * DEG;
    const sign = side === 'left' ? -1 : 1; // left is -x in the pen's frame
    const n = Math.max(2, Math.ceil((angle * radius) / this.spacing));
    for (let k = 1; k <= n; k++) {
      const phi = (angle * k) / n;
      this.emit(
        sign * radius * (1 - Math.cos(phi)),
        rise * smoothstep(k / n),
        -radius * Math.sin(phi),
      );
    }
    this.advance(
      sign * radius * (1 - Math.cos(angle)),
      rise,
      -radius * Math.sin(angle),
      -sign * angle,
    );
    return this;
  }

  /**
   * A full vertical loop. The road leaves and rejoins at the same heading, `lateral` metres to the side,
   * so the exit does not run through the entry.
   */
  loop(radius: number, lateral: number, side: 'left' | 'right'): this {
    const sign = side === 'left' ? -1 : 1;
    const n = Math.max(8, Math.ceil((2 * Math.PI * radius) / this.spacing));
    for (let k = 1; k <= n; k++) {
      const theta = (2 * Math.PI * k) / n;
      this.emit(
        sign * lateral * smoothstep(k / n),
        radius * (1 - Math.cos(theta)),
        -radius * Math.sin(theta),
      );
    }
    this.advance(sign * lateral, 0, 0, 0);
    return this;
  }

  /** Where the pen is now (a copy). */
  here(): Vector3 {
    return this.position.clone();
  }

  /**
   * Finishes a stadium: the pen must be heading back toward the start line (+z). It goes straight until it is
   * level with the start, then turns left 180 degrees with just the radius that lands it on the start point,
   * so any sideways shift made earlier is taken up automatically. Returns the radius of that last turn.
   */
  closeStadium(): number {
    const at = this.position;
    if (at.z >= 0) throw new Error('closeStadium: the pen has already passed the start line');
    this.straight(-at.z);
    const x = this.position.x;
    if (x >= 0)
      throw new Error('closeStadium: the pen is on the wrong side to turn back to the start');
    const radius = -x / 2;
    this.turn(180, radius, 'left');
    return radius;
  }

  /** Finishes the loop: checks the pen came back to where it started and returns the control points. */
  close(tolerance = 1e-3): Vector3[] {
    const start = this.points[0] as Vector3;
    const end = this.points[this.points.length - 1] as Vector3;
    if (end.distanceTo(start) > tolerance) {
      throw new Error(
        `Track does not close: ends ${end.distanceTo(start).toFixed(3)} m from the start`,
      );
    }
    return this.points.slice(0, -1);
  }

  private emit(x: number, y: number, z: number): void {
    this.local.set(x, y, z).applyQuaternion(this.orientation).add(this.position);
    this.length += this.last.distanceTo(this.local);
    this.last.copy(this.local);
    this.points.push(this.local.clone());
  }

  /** Moves the pen to the end of the piece it just drew and turns it by `yaw` radians about its up. */
  private advance(x: number, y: number, z: number, yaw: number): void {
    this.position.add(this.local.set(x, y, z).applyQuaternion(this.orientation));
    this.orientation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
  }
}
