import { ArrowHelper, Scene, Vector3 } from 'three';
import type { Sim } from '../physics/Sim';
import { MS_TO_KMH } from '../util/constants';

/** True when the page was opened with ?debug=1. */
export function debugEnabled(): boolean {
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

/**
 * Debug mode: surface normals as arrows, the air value, speed, landing angle, and slow motion (T).
 * Tuning depends on it.
 */
export class DebugOverlay {
  private readonly normal = new ArrowHelper(
    new Vector3(0, 1, 0),
    new Vector3(),
    3,
    0x19e3ff,
    0.6,
    0.35,
  );
  private readonly smooth = new ArrowHelper(
    new Vector3(0, 1, 0),
    new Vector3(),
    2.2,
    0xb8ff3c,
    0.5,
    0.3,
  );
  private readonly up = new ArrowHelper(
    new Vector3(0, 1, 0),
    new Vector3(),
    2.6,
    0xff7a1a,
    0.5,
    0.3,
  );
  slowMo = false;
  private readonly panel: HTMLElement;
  private frames = 0;
  private frameClock = 0;
  private fps = 0;

  constructor(scene: Scene, panel: HTMLElement) {
    this.panel = panel;
    scene.add(this.normal, this.smooth, this.up);
    panel.style.display = 'block';
  }

  toggleSlowMo(): void {
    this.slowMo = !this.slowMo;
  }

  update(sim: Sim, frameTime: number, extra: string[] = []): void {
    this.frames++;
    this.frameClock += frameTime;
    if (this.frameClock >= 0.5) {
      this.fps = this.frames / this.frameClock;
      this.frames = 0;
      this.frameClock = 0;
    }

    const p = sim.car.position;
    this.normal.position.copy(p);
    this.smooth.position.copy(p);
    this.up.position.copy(p);
    this.normal.visible = sim.sensor.found;
    this.smooth.visible = sim.sensor.found;
    if (sim.sensor.found) {
      this.normal.setDirection(sim.sensor.normal);
      this.smooth.setDirection(sim.sensor.smoothNormal);
    }
    this.up.setDirection(sim.car.up);

    const l = sim.lastLanding;
    const lines = [
      `fps       ${this.fps.toFixed(0)}`,
      `air       ${sim.air.value.toFixed(1)}`,
      `speed     ${sim.speed.toFixed(1)} m/s  ${(sim.speed * MS_TO_KMH).toFixed(0)} km/h`,
      `state     ${sim.crashed ? 'crashed' : sim.attached ? 'attached' : 'airborne'}`,
      `surface   ${sim.sensor.found ? sim.sensor.distance.toFixed(2) + ' m' : 'none'}`,
      `flips     pitch ${sim.flips.pitchAngle.toFixed(2)}  roll ${sim.flips.rollAngle.toFixed(2)}`,
      `landing   ${l ? `${l.kind}  ${l.angleDeg.toFixed(1)} deg  ${l.impactSpeed.toFixed(1)} m/s` : '-'}`,
      `penalty   ${sim.penalty.toFixed(1)} s`,
      `slow-mo   ${this.slowMo ? 'ON' : 'off'}  (T)`,
    ];
    this.panel.textContent = [...lines, ...extra].join('\n');
  }
}
