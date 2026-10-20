# Decisions

One line of reasoning each, for things the spec left open or got wrong.

## Milestone 1

- **Repo layout.** Git root is `car-game/`, the app is in `airhop/`. Keeps the spec, design docs and mockups next to the game.
- **Axes.** The car faces -z, right is +x, up is +y. It matches the three.js camera convention, so nothing needs flipping.
- **Air drag.** Drag is multiplied by `AIR_DRAG_FACTOR` (0.25) while airborne. With full drag a hop at top speed would lose about a third of its speed in 1.7 s, which punishes the main move.
- **Extra modules.** `Sim.ts` (one physics step, no DOM, so tests can run it headless), `Input.ts`, `landing.ts` and `flips.ts` were added to the spec's list so the pure logic is unit-testable.
- **Flip counter keeps the overshoot.** At 2 pi it subtracts one turn instead of resetting to zero, so fast spins do not lose angle.
- **Boost is paid per step.** A step only boosts if the tank can pay that step's 20/60 air. Otherwise a regen trickle at an empty tank would give full-power boost forever. An empty tank now boosts about a fifth of the time, which matches 4 air/s regen against 20 air/s burn.
- **Landing is judged at attach, 1.5 m from the surface.** That is where the spec's numbers work: a plain hop hits at 7.69 m/s, under the 8 m/s Perfect limit with 0.31 m/s to spare. It is a tight margin on purpose, tune `LAND_SAFE_SPEED` if hops feel unfairly Rough.
- **Cushion needs a surface within 3 m.** The ray reaches 3 m (`CUSHION_RANGE`) so the cushion can see the ground. Attachment still needs under 1.5 m.
- **One extra world step at start.** Rapier builds its ray structure on the first step, so the first surface check missed and the car "landed" on step 1 with a free speed boost. `Sim` steps once in its constructor.
- **Respawn goes to the start.** There are no checkpoints until Milestone 3. R and a crash both cost 3 s.
- **Ground is 40 km square.** So the flat M1 sandbox does not have an edge a player can drive off in a few minutes.
- **Camera heading follows velocity, not the nose.** A flip pitches the nose through vertical, which would swing a nose-following camera around. Below 3 m/s along the surface it follows the nose.
- **Fonts via `@fontsource`.** Self-hosted from npm, no network at runtime. Chakra Petch and Saira Extra Condensed, as in `ART_DIRECTION.md`.
- **`window.__game` in debug mode.** Lets a console or browser test step the game by hand. Only exists with `?debug=1`.

## Spec issues to revisit

- **Ceiling hold margin is smaller than the spec says.** The spec's "(sigma - 1) m g = 0.5 mg" assumes distance 0. At ride height (0.4 m) suction is 1.1 mg, a net of only 0.1 mg against gravity. It stays positive, but a bump could shake the car off a ceiling. Check this first in Milestone 2 (raise `SUCTION_SIGMA`, or measure distance from the car's underside).
- **Box collider versus spring-damper.** M1 uses plain box contact on flat ground and it is steady. The risk table's spring-damper along the normal is probably needed once the surface is not flat.
- **Bundle size.** `rapier3d-compat` embeds its WebAssembly as base64, so the JS bundle is about 4.9 MB (1.8 MB gzipped). Fine for v1, look at it in Milestone 5.
