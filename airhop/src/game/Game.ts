import { Quaternion, Vector3 } from 'three';
import { Sim, type SimEvent } from '../physics/Sim';
import { Keyboard } from '../input/keyboard';
import { World3D } from '../render/scene';
import { CarModel } from '../render/carModel';
import { ChaseCamera } from '../render/camera';
import { Hud } from '../ui/hud';
import { DebugOverlay, debugEnabled } from '../ui/debug';
import { Loop } from './Loop';
import {
  FLIP_REFUND,
  CUSHION_COST,
  LAND_PERFECT_REFUND,
  RESPAWN_PENALTY,
  SHAKE_CRASH,
  SHAKE_PERFECT,
  SHAKE_ROUGH,
  SLOW_MO_SCALE,
} from '../util/constants';

/** Milestone 1 has one state besides racing. Milestones 3 and 4 add menu, countdown and finished. */
export type GameState = 'racing' | 'paused';

export class Game {
  state: GameState = 'racing';

  private readonly sim = new Sim();
  private readonly keyboard = new Keyboard();
  private readonly view: World3D;
  private readonly carModel = new CarModel();
  private readonly chase: ChaseCamera;
  private readonly hud = new Hud();
  private readonly debug: DebugOverlay | null;
  private readonly loop: Loop;

  private readonly pos = new Vector3();
  private readonly quat = new Quaternion();

  constructor(container: HTMLElement) {
    this.view = new World3D(container);
    this.view.scene.add(this.carModel.group);
    this.chase = new ChaseCamera(this.view.camera);
    this.debug = debugEnabled() ? new DebugOverlay(this.view.scene, this.hud.debugPanel) : null;
    // Debug mode only: expose the game so a console or a browser test can step it by hand.
    if (this.debug) (window as unknown as { __game?: Game }).__game = this;

    this.keyboard.onPause = () => this.togglePause();
    this.keyboard.onSlowMo = () => this.debug?.toggleSlowMo();
    this.keyboard.attach(window);

    this.loop = new Loop(
      () => this.step(),
      (alpha, frameTime) => this.render(alpha, frameTime),
      () => (this.state === 'paused' ? 0 : this.debug?.slowMo ? SLOW_MO_SCALE : 1),
    );
  }

  start(): void {
    this.loop.start();
  }

  togglePause(): void {
    this.state = this.state === 'paused' ? 'racing' : 'paused';
    this.hud.setPaused(this.state === 'paused');
  }

  private step(): void {
    this.sim.step(this.keyboard.poll());
    for (const event of this.sim.events) this.onEvent(event);
  }

  private onEvent(event: SimEvent): void {
    switch (event.type) {
      case 'landing':
        if (event.kind === 'perfect') {
          this.hud.showPopup('perfect', 'PERFECT', `+${LAND_PERFECT_REFUND} AIR`);
          this.chase.addShake(SHAKE_PERFECT);
        } else if (event.kind === 'rough') {
          this.hud.showPopup('rough', 'ROUGH', 'SPEED x0.6');
          this.chase.addShake(SHAKE_ROUGH);
        } else {
          this.hud.showPopup('crash', 'CRASH', `+${RESPAWN_PENALTY.toFixed(1)} S PENALTY`);
          this.chase.addShake(SHAKE_CRASH);
        }
        break;
      case 'flip':
        this.hud.showPopup('flip', `+${FLIP_REFUND * event.count} AIR`, '', true);
        break;
      case 'cushion':
        this.hud.showPopup('flip', `CUSHION -${CUSHION_COST} AIR`, '', true);
        break;
      case 'hopRefused':
        this.hud.flashEmpty();
        break;
      case 'respawn':
      case 'hop':
        break;
    }
  }

  private render(alpha: number, frameTime: number): void {
    const sim = this.sim;
    sim.getRenderPose(alpha, this.pos, this.quat);
    const forwardSpeed = sim.car.velocity.dot(sim.car.forward);
    this.carModel.update(this.pos, this.quat, forwardSpeed, frameTime, sim.boosting);
    this.chase.update(frameTime, this.pos, this.quat, sim.car.velocity, sim.speed);
    this.view.follow(this.pos);
    this.hud.update(sim.air.value, sim.speed, sim.boosting, sim.crashed);
    this.debug?.update(sim, frameTime);
    this.view.render();
  }
}
