import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  type Material,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  Vector3,
} from 'three';
import { CAR_HALF_LENGTH, WHEEL_RADIUS } from '../util/constants';

const AIR_CYAN = 0x19e3ff;
const HEAT_ORANGE = 0xff7a1a;

/** Colours that tell the cars apart. The body stays the same dark metal. */
export interface CarLook {
  /** Colour of the body outline and the nose line. */
  outline: number;
  /** Colour of the tail light bar and the rear flames. */
  tail: number;
}

export const PLAYER_LOOK: CarLook = { outline: AIR_CYAN, tail: HEAT_ORANGE };

/** Side profile of the car in (x = toward the nose, y = up). The nose is at +x here and ends up at -z. */
function bodyProfile(): Shape {
  const s = new Shape();
  s.moveTo(-2, -0.28);
  s.lineTo(2, -0.28);
  s.lineTo(2, -0.02); // nose tip
  s.lineTo(1.0, 0.12);
  s.lineTo(0.45, 0.42); // windscreen base, roof front
  s.lineTo(-0.6, 0.42); // roof rear
  s.lineTo(-1.2, 0.14);
  s.lineTo(-2, 0.18);
  s.closePath();
  return s;
}

/**
 * A low wedge car built from primitives (original design). Local axes match the physics body:
 * the car faces -z, right is +x, up is +y, and the origin is the body centre.
 */
export class CarModel {
  readonly group = new Group();
  private readonly wheels: Mesh[] = [];
  private readonly flames: Mesh[] = [];
  private wheelAngle = 0;
  private ghost = false;

  constructor(look: CarLook = PLAYER_LOOK) {
    const width = 1.9;
    const bodyGeo = new ExtrudeGeometry(bodyProfile(), { depth: width, bevelEnabled: false });
    bodyGeo.translate(0, 0, -width / 2);
    bodyGeo.rotateY(Math.PI / 2); // profile x becomes -z, extrusion depth becomes x
    const body = new Mesh(
      bodyGeo,
      new MeshStandardMaterial({ color: 0x16212c, metalness: 0.6, roughness: 0.35 }),
    );
    const outline = new LineSegments(
      new EdgesGeometry(bodyGeo, 25),
      new LineBasicMaterial({ color: look.outline }),
    );
    this.group.add(body, outline);

    // Light bars: orange tail, cyan accent line down the nose.
    const tail = new Mesh(
      new BoxGeometry(1.6, 0.1, 0.05),
      new MeshBasicMaterial({ color: look.tail }),
    );
    tail.position.set(0, 0.1, CAR_HALF_LENGTH + 0.02);
    const accent = new Mesh(
      new BoxGeometry(0.1, 0.03, 1.4),
      new MeshBasicMaterial({ color: look.outline }),
    );
    accent.position.set(0, 0.425, -0.05);
    this.group.add(tail, accent);

    // Thruster nozzles: two at the rear, two underneath. Flames show while boosting.
    const nozzleMat = new MeshStandardMaterial({ color: 0x0a0f14, metalness: 0.8, roughness: 0.3 });
    const flameMat = new MeshBasicMaterial({ color: look.tail, transparent: true, opacity: 0.9 });
    for (const x of [-0.55, 0.55]) {
      const rear = new Mesh(new CylinderGeometry(0.16, 0.2, 0.3, 14), nozzleMat);
      rear.rotation.x = Math.PI / 2;
      rear.position.set(x, 0.02, CAR_HALF_LENGTH + 0.05);
      const flame = new Mesh(new ConeGeometry(0.15, 1.6, 12), flameMat);
      flame.rotation.x = Math.PI / 2; // cone tip points toward +z, away from the car
      flame.position.set(x, 0.02, CAR_HALF_LENGTH + 0.95);
      flame.visible = false;
      this.flames.push(flame);
      this.group.add(rear, flame);

      const under = new Mesh(
        new CylinderGeometry(0.2, 0.15, 0.1, 14),
        new MeshBasicMaterial({ color: look.outline }),
      );
      under.position.set(x * 1.3, -0.29, 0.2);
      this.group.add(under);
    }

    // Wheels are visual only.
    const wheelGeo = new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.32, 20);
    wheelGeo.rotateZ(Math.PI / 2); // axle along x
    const wheelMat = new MeshStandardMaterial({ color: 0x080b0f, metalness: 0.4, roughness: 0.6 });
    const hubGeo = new CylinderGeometry(0.16, 0.16, 0.34, 10);
    hubGeo.rotateZ(Math.PI / 2);
    const hubMat = new MeshBasicMaterial({ color: look.tail });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const wheel = new Mesh(wheelGeo, wheelMat);
        wheel.add(new Mesh(hubGeo, hubMat));
        wheel.position.set(sx * 1.04, -0.04, sz * 1.3);
        this.wheels.push(wheel);
        this.group.add(wheel);
      }
    }
  }

  /** Turns this model into a translucent single-colour ghost: no lighting, no flames. */
  makeGhost(color: number, opacity: number): this {
    const ghostMaterial = (): Material =>
      new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    this.group.traverse((node) => {
      if (node instanceof LineSegments) {
        node.material = new LineBasicMaterial({ color, transparent: true, opacity: opacity * 2 });
      } else if (node instanceof Mesh) {
        node.material = ghostMaterial();
      }
    });
    this.ghost = true;
    return this;
  }

  /** Places the car at an interpolated pose. `forwardSpeed` (m/s, signed) spins the wheels. */
  update(
    position: Vector3,
    quaternion: Quaternion,
    forwardSpeed: number,
    frameTime: number,
    boosting: boolean,
  ): void {
    this.group.position.copy(position);
    this.group.quaternion.copy(quaternion);
    this.wheelAngle -= (forwardSpeed / WHEEL_RADIUS) * frameTime; // wheels roll forward (-z)
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;
    for (const f of this.flames) {
      f.visible = boosting && !this.ghost;
      if (boosting) f.scale.y = 0.8 + Math.random() * 0.5;
    }
  }
}
