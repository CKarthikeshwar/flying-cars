import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three';
import { RING_RADIUS, SLOT_BLOCK_DEPTH } from '../util/constants';
import { isHurdle } from '../track/hazards';
import type { Track } from '../track/Track';

const LOW_RING = new Color(0xb8ff3c); // lime, like the charge strips: air
const HIGH_RING = new Color(0x19e3ff); // cyan: the high ones
const DANGER = new Color(0xff2e63); // red: alarm, as in ART_DIRECTION.md
const WALL = 0x3a1020;
const POST = new Color(0x19e3ff);

/** Rings and barriers for a track, as one group, with the rings that pulse and the ones already taken hidden. */
export class Hazards {
  readonly group = new Group();
  private readonly rings: { group: Group; phase: number }[] = [];
  private time = 0;

  constructor(track: Track) {
    const toward = new Vector3(0, 0, 1);

    for (const ring of track.rings) {
      const g = new Group();
      const color = ring.h > 6 ? HIGH_RING : LOW_RING;
      const band = new Mesh(
        new TorusGeometry(RING_RADIUS * 0.85, 0.22, 10, 40),
        new MeshBasicMaterial({ color }),
      );
      // a thin outer circle marks how close to the middle you need to be
      const reach = new Mesh(
        new TorusGeometry(RING_RADIUS, 0.05, 6, 40),
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }),
      );
      g.add(band, reach);
      g.position.copy(ring.position);
      g.quaternion.setFromUnitVectors(toward, ring.normal);
      this.group.add(g);
      this.rings.push({ group: g, phase: ring.index * 0.37 });
    }

    const basis = new Matrix4();
    const turn = new Quaternion();
    const wallMaterial = new MeshStandardMaterial({
      color: WALL,
      roughness: 0.6,
      metalness: 0.2,
      transparent: true,
      opacity: 0.88,
    });
    const edgeMaterial = new LineBasicMaterial({ color: DANGER });
    const stripe = new MeshBasicMaterial({ color: DANGER });
    for (const barrier of track.barriers) {
      const frame = track.frames[barrier.index];
      if (!frame) continue;
      const width = barrier.right - barrier.left;
      const centre = (barrier.left + barrier.right) / 2;
      const box = new BoxGeometry(width, barrier.height, SLOT_BLOCK_DEPTH);
      const mesh = new Mesh(box, wallMaterial);
      const edges = new LineSegments(new EdgesGeometry(box), edgeMaterial);
      const g = new Group();
      g.add(mesh, edges);
      if (isHurdle(barrier)) {
        // a bright bar along the top, so a low barrier is easy to see from far off
        const top = new Mesh(new BoxGeometry(width, 0.14, SLOT_BLOCK_DEPTH + 0.1), stripe);
        top.position.y = barrier.height / 2;
        g.add(top);
      }
      g.position
        .copy(frame.position)
        .addScaledVector(frame.binormal, centre)
        .addScaledVector(frame.up, barrier.height / 2);
      basis.makeBasis(frame.binormal, frame.up, frame.tangent.clone().negate());
      g.quaternion.copy(turn.setFromRotationMatrix(basis));
      this.group.add(g);

      // cyan posts mark the edges of an opening, so the way through stands out
      if (barrier.slot) {
        const lo = barrier.slot.centre - barrier.slot.width / 2;
        const hi = barrier.slot.centre + barrier.slot.width / 2;
        for (const edge of [lo, hi]) {
          if (edge !== barrier.left && edge !== barrier.right) continue;
          const post = new Mesh(
            new BoxGeometry(0.3, barrier.height, 0.3),
            new MeshBasicMaterial({ color: POST }),
          );
          post.position
            .copy(frame.position)
            .addScaledVector(frame.binormal, edge)
            .addScaledVector(frame.up, barrier.height / 2);
          post.quaternion.copy(g.quaternion);
          this.group.add(post);
        }
      }
    }
  }

  /** Pulses the rings and hides the ones the player has flown through this lap. */
  update(dt: number, taken: ReadonlySet<number> | null): void {
    this.time += dt;
    this.rings.forEach((ring, i) => {
      ring.group.visible = !taken?.has(i);
      const pulse = 1 + 0.06 * Math.sin(this.time * 4 + ring.phase);
      ring.group.scale.setScalar(pulse);
    });
  }
}
