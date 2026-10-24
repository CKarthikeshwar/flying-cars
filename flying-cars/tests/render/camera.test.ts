import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { ChaseCamera } from '../../src/render/camera';
import { CAM_UP_RATE, CAM_UP_RATES, FOV_MAX, FOV_MIN } from '../../src/util/constants';

const FRAME = 1 / 60;

function setup() {
  const camera = new PerspectiveCamera(70, 16 / 9, 0.3, 3500);
  return { camera, chase: new ChaseCamera(camera) };
}

/** A car pose upside down: rolled half a turn about its forward axis. */
const upsideDown = new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), Math.PI);

describe('ChaseCamera', () => {
  it('sits behind and above an upright car and looks along the way it faces', () => {
    const { camera, chase } = setup();
    const pos = new Vector3(0, 0.5, 0);
    for (let i = 0; i < 120; i++)
      chase.update(FRAME, pos, new Quaternion(), new Vector3(0, 0, -20), 20);
    expect(camera.position.z).toBeGreaterThan(pos.z + 4); // behind (the car faces -z)
    expect(camera.position.y).toBeGreaterThan(pos.y + 1); // above
    expect(camera.up.y).toBeGreaterThan(0.99);
  });

  it('turns its up vector toward an upside-down car, but only slowly', () => {
    const { camera, chase } = setup();
    const pos = new Vector3();
    const v = new Vector3(0, 0, -20);
    chase.update(FRAME, pos, new Quaternion(), v, 20); // start upright
    const before = camera.up.clone();
    chase.update(FRAME, pos, upsideDown, v, 20);
    const firstFrame = Math.acos(Math.min(1, camera.up.dot(before)));
    // one frame turns at most the fraction 1 - exp(-rate dt) of the half turn
    expect(firstFrame).toBeLessThan(Math.PI * (1 - Math.exp(-CAM_UP_RATE * FRAME)) * 1.05);
    expect(CAM_UP_RATE).toBeGreaterThanOrEqual(CAM_UP_RATES[0] ?? 0);
    expect(firstFrame).toBeGreaterThan(0.01); // and it does turn

    for (let i = 0; i < 90; i++) chase.update(FRAME, pos, upsideDown, v, 20);
    expect(camera.up.y).toBeLessThan(-0.99); // after 1.5 s it has followed the car over
  });

  it('follows faster in the quick and locked modes than in the smooth one', () => {
    const turned = (rate: number) => {
      const { camera, chase } = setup();
      chase.upRate = rate;
      const v = new Vector3(0, 0, -20);
      chase.update(FRAME, new Vector3(), new Quaternion(), v, 20);
      for (let i = 0; i < 20; i++) chase.update(FRAME, new Vector3(), upsideDown, v, 20);
      return Math.acos(Math.max(-1, Math.min(1, camera.up.y)));
    };
    const [smooth, quick, locked] = CAM_UP_RATES;
    expect(turned(quick ?? 0)).toBeGreaterThan(turned(smooth ?? 0));
    expect(turned(locked ?? 0)).toBeGreaterThan(turned(quick ?? 0));
  });

  it('never produces a bad position, even when the car is stopped and upside down', () => {
    const { camera, chase } = setup();
    for (let i = 0; i < 300; i++) chase.update(FRAME, new Vector3(), upsideDown, new Vector3(), 0);
    for (const c of [camera.position.x, camera.position.y, camera.position.z])
      expect(Number.isFinite(c)).toBe(true);
  });

  it('widens the field of view from 70 to 85 degrees as speed rises', () => {
    const { camera, chase } = setup();
    chase.update(FRAME, new Vector3(), new Quaternion(), new Vector3(), 0);
    expect(camera.fov).toBeCloseTo(FOV_MIN, 1);
    chase.update(FRAME, new Vector3(), new Quaternion(), new Vector3(0, 0, -85), 85);
    expect(camera.fov).toBeCloseTo(FOV_MAX, 1);
  });
});
