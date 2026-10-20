import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_DT } from '../util/constants';

export { RAPIER };

/** Loads the Rapier WebAssembly module. Call once, and wait for it, before creating a world. */
export async function initPhysics(): Promise<void> {
  await RAPIER.init();
}

/**
 * Zero gravity: the game applies gravity itself, because "down" changes with the surface
 * the car is on. Fixed step so the car behaves the same on slow and fast machines.
 */
export function createWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = PHYSICS_DT;
  return world;
}

/** A large flat floor with its top face at y = 0. At least 1 m thick so fast cars cannot tunnel. */
export function addFlatGround(world: RAPIER.World, halfSize = 20000): RAPIER.Collider {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  const desc = RAPIER.ColliderDesc.cuboid(halfSize, 0.5, halfSize)
    .setFriction(0)
    .setRestitution(0);
  return world.createCollider(desc, body);
}
