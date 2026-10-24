# Decisions

One line of reasoning each, for things the spec left open or got wrong.

## Milestone 1

- **Repo layout.** Git root is `car-game/`, the app is in `flying-cars/`. Keeps the spec, design docs and mockups next to the game.
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

## Milestone 2

- **The car's box no longer collides with the track.** The first version rested the box on the track, with the spring as a helper. Two things broke it: the box edge catching seams between triangles (a sideways "ghost" contact that stopped the car dead at the loop entry), and any small tilt lag on a rolling road digging a box corner in and flinging the car up. Now the box has no collisions and the ride spring along the normal (with a stiff bump stop under 0.3 m) carries the whole weight, as the spec's jitter fix suggests. Rapier still integrates the car and the track is still in the world for the surface ray casts. Consequence: nothing can bump the car sideways. If side barriers are wanted later they need their own handling.
- **Ride height is 0.48 m, not 0.4.** The spec's 0.4 equals the box half-height, so it would sit on its own contact. 0.48 is where the spring settles the car at 0.44 on a floor and 0.47 on a ceiling.
- **Suction sigma is 3.0, not 1.5.** At ride height the fade leaves the spec's 1.5 only 0.1 mg over gravity on a ceiling, and a car lifted a little could not come back. At 3.0 the margin is about 1 mg, and suction still beats gravity out to 1.0 m from the surface.
- **Wheels hold the car against gravity sideways.** On a surface, the part of gravity that points across the road is removed. Without that, a car on a banked wall slid down it at 1.5 m/s (gravity against the sideways grip term). Gravity along the direction of travel is still felt, so climbing a wall slows the car.
- **Self-levelling has a feed-forward.** The car's spin is the levelling spin plus the rate the surface normal is turning, capped at 6 rad/s. With levelling alone the car lagged 10 to 15 degrees behind a rolling road.
- **Road up vectors: level on flat stretches, transported on steep ones.** The spec transports the up vector and spreads the closing twist evenly over the whole track. That tilts every flat stretch when a loop shifts the road sideways (the twist left behind is shift / radius, about 37 degrees for 18 m on a 28 m loop). So on stretches within 25 degrees of horizontal the up vector is locked to level (upright or upside down, whichever the road arrived as). On the steep stretches between them it is transported, and the leftover is spread evenly along that stretch. A track with no flat stretch falls back to the spec's even spread over the whole loop. A track that returns to its start upside down throws an error.
- **The test track has two mirrored loops.** One shifts the road 18 m left and the other 18 m right, so the road comes back where it started. It is 12 m wide and 1251 m round, with the wall section on the first straight and the ceiling between the loops. Control points are every 5 m and the road is sampled every 1 m.
- **Track slab is 1 m thick.** The spec asks for at least 0.5 m. Closed, with top, bottom and sides, and one welded mesh per track.
- **No ground under a track.** The flat floor is only for the sandbox (`?track=flat`). Under a track the floor is drawn 25 m below the lowest point, and the car respawns (3 s penalty, "OFF TRACK") if it falls 60 m below it.
- **Default page is the test track.** `?track=flat` is the Milestone 1 sandbox.
- **The camera bug.** The up-vector turn used `slerpQuaternions` with the same object as input and output, which silently does nothing, so the camera never turned. Fixed and covered by a test.
- **Test autopilot.** `tests/helpers/autopilot.ts` steers at a point ahead on the centre line and holds a speed. It is the seed of the Milestone 3 AI.

## Milestone 3

- **Every racer has its own physics world, and cars do not collide.** Four cars in one world would need car-to-car handling the spec does not describe. Separate worlds are simple, each costs about 25 microseconds a step, and the cars can pass through each other. If bumping is wanted later, that is a new feature.
- **A lap runs from line to line.** The start line is 40 m into the first straight, with a standing grid behind it (two rows of two, 8 m apart). A car starts its first lap when it first crosses the line. The race clock runs from the go signal and is what the timer and the finishing time use, so the run to the line counts in the race time but not in any lap time. Lap times are from line to line, which makes them comparable for the ghost.
- **Penalties are added to the race time.** The timer on screen includes them, and so does the finishing time. A crash, the R key and falling off all cost 3 s and put the car back at the last gate passed.
- **Checkpoint gates are boxes, not infinite planes.** About one every 100 m. A car passes a gate by crossing its plane forward, inside the road width plus 3 m, and not more than 10 m above or 3 m below the road surface. That is what stops the far side of a loop, 18 m away, from counting as the gate on the straight. Only the gate a car is waiting for is checked, so passing gates out of order, or skipping one, does nothing until the car goes back through the one it missed. Crossing times are worked out to a fraction of a step.
- **Distance round the track is unwrapped.** Each racer keeps a running distance (negative on the grid) from its nearest road sample. Positions rank by it, and the ghost gap uses the distance covered in the current lap. Using the plain position along the track gave a 44 s glitch at the start line, where it wraps.
- **The ghost is the best lap, kept in localStorage.** One pose every 1/30 s (time, position, orientation, distance covered), plus an exact sample at the start and end of the lap so there is no stale stretch there. Replaying it matches where the car really was to within 0.5 cm. The ghost gap compares times at the same distance covered. The best lap time, best race time and ghost survive a page reload. All of it is guarded, so blocked or full storage just means nothing is saved.
- **The AI plans its speed round the whole track.** The cornering speed is sqrt(a_lat / curvature), as in the spec, then a backward pass makes sure it starts braking in time (at 14 m/s squared, well under what the car can do). The skill factor scales that plan.
- **The AI is slower on twisting road.** The road may not turn under the car faster than 1.6 rad/s. A car off-centre sits on a surface that moves at (offset x roll rate), and at about 9 m/s the suction cannot follow, so the car peels off. The AI also does not boost where the road turns, because boost pushes along a slightly pitched nose. The same limit applies to a human: at 50+ m/s through the ceiling twist, you fall off.
- **AI cars use lanes.** Each aims 2.5 m, minus 2.5 m, or 1.2 m to one side of the centre line, fading to the centre where the road rolls steeply. Without this all four cars share one line and drive through each other.
- **Finished cars cruise.** After finishing, a car slows to 12 m/s and keeps following the road. Before this, finished cars kept their speed and drove off the next corner.
- **The AI asks for a respawn if it is stuck** below 1.5 m/s for 4 s.
- **Results wait for the AI.** When the player finishes, the results screen waits up to 6 s for the others, so the standings show their times. Anyone still racing after that shows as "racing".
- **The road surface mesh is cut into 12 strips.** A twisting road is a twisted ribbon, and one triangle across the whole width tilts 25 degrees along the road on a steep roll. The surface sensor read that tilt as the road normal, and a car sitting still on the twist was launched. The strips fix that. Away from the centre the true surface normal of a twisting road does tilt (atan of distance times roll rate), which is correct, not an error.
- **`placeCar` clears the surface smoothing.** After a respawn the first reading is used as it is, not blended with the old location.
- **Test trials use steering noise.** "10 of 10 trials" runs with seeded random steering noise on every driver, so the trials differ but every run is the same.

## Playtest changes (after the first hands-on feedback)

The first playtest said the game was hard to stay on the road, hard to read when the screen flips, and that the flying part did not matter. What changed:

- **The ride damper reads the change in distance to the road, not the speed against the surface normal.** The old damper treated a road whose slope was changing (a twist, a loop entry, a ramp) as an impact and threw the car off it. The change in distance is relative to the road, so following a slope costs nothing. The wall twist now holds at 70 m/s and the ceiling twist at 40.
- **The road is 16 m wide and the sideways grip is stronger.** `TRACK_WIDTH` 12 to 16, `GRIP_TAU` 0.15 to 0.10. It was easy to drift off, and the spec says these are starting values.
- **The camera follows faster by default, with three speeds on C.** Smooth (3 per second, the spec), quick (8, the default) and locked (30). The choice is saved.
- **A small arrow shows which way is really up** once the view is tilted more than 20 degrees.
- **Nothing runs until you say go.** A start screen (or the track menu) waits for Enter, so the clock and the AI do not run behind your back. It also lists every control.
- **Stuck keys are cleared.** Focus loss, a hidden tab, and a Shift that the browser says is not down (a screenshot shortcut can swallow its key-up).
- **Glide.** Hold Space for 0.25 s in the air: gravity drops to 35%, it costs 10 air a second, and the direction of flight swings toward the way the car points at up to 1.4 rad/s. At 50 m/s a held glide carries about 200 m instead of 94 m for about 45 air. A tap is still a hop. The AI does not glide.

## Milestone 4 (tracks, so far)

- **Three tracks, each with a wall, a ceiling and a gap.** Warm-up (wide and gentle, 2100 m), Spiral Tower (climbs 45 m in a spiral with the ceiling near the top, then a long descent with a wall and a gap, 2150 m), Gap Run (two gaps, a banked wall turn, a loop and a ceiling, 2000 m). The test track stays, reachable at `?track=test`.
- **A gap is a hole with a ledge.** The road has a hole across it, apart from a 4 m ledge on one side. A car can hop the hole, or drive the ledge slowly. That is how every track can be finished without a hop, only slower. Gaps are 25 to 30 m, which a hop at 25+ m/s clears. The mesh really has a hole, so the surface sensor finds nothing there and a car that drives in falls, respawns at the last gate and pays 3 s.
- **What the AI does at a gap.** It hops 8 m before it, by default. With hops off it moves over to the ledge as the gap approaches and holds 18 m/s through it. Without hops the laps are slower by 3 s (Warm-up), 3 s (Spiral Tower) and 6 s (Gap Run).
- **Charge strips** are 4 m wide runs of the road in the middle lane, 35 to 40 m long, placed within 120 m before every gap. A car over one refills 40 air a second. The air gauge glows lime while it does.
- **The road shows what it is.** Lime line to hop from, cyan line to land on, a red edge along the ledge, lime and dim-lime bars on charge strips.
- **Climbing tracks.** The Pen can climb (`straight` and `turn` take a rise, eased in and out so the slope starts and ends at zero), and `closeStadium()` closes a stadium shaped track exactly by taking up any sideways shift in the last turn.
- **Finished cars take the ledges.** A car that has finished slows to 12 m/s, and at that speed a hop would not clear a gap, so it drives the ledge.
- **The results show the penalty at the moment of finishing.** A car cruising on after the finish line could pick up penalties that should not count.
- **The menu opens on load.** Arrow keys choose, Enter races, H shows the controls, Backspace goes back to the menu from pause or the results. `?track=<id>` skips the menu (and waits on the start screen) and `?track=flat` is the sandbox.

## Bug fixes found in playtesting

- **Falling forever in a gap.** Checkpoint gates were spaced evenly with no regard for gaps, so on Warm-up and Gap Run one gate sat inside the hole. A respawn there put the car over the hole, it fell, respawned at the same gate, and so on. Gates now slide back until they have 30 m of solid road ahead and are on road flatter than 20%, and a gate with no safe spot (inside a loop) is left out. A test checks every gate of every track, and that a respawn there keeps the car attached.
- **Falls end sooner.** Dropping faster than 22 m/s in the air (about 2 s of free fall) counts as off the track. Before, the car had to fall 60 m below the lowest road, which took 5 s or more. A glide falls slowly, so it never trips this.
- **The surface ray could leak through a seam in the road mesh.** The centre line of the road is a seam between triangles, and a ray exactly on it could slip through and come out of the underside, reading one slab thickness (1 m) too far. That fed a bogus "moving away at 120 m/s" into the ride damper and kicked the car. The sensor now always casts the main ray plus two a hair to each side and takes the closest hit.

## Spec issues to revisit

- **A human can still fall off the twist at speed.** See "The AI is slower on twisting road". If playtesting shows it is too harsh, the options are a longer twist, or making the ride spring follow the motion of the surface.

- **Ceiling hold margin was smaller than the spec says.** The spec's "(sigma - 1) m g = 0.5 mg" assumes distance 0. At ride height suction is 1.1 mg with sigma 1.5, a net of only 0.1 mg. Fixed in Milestone 2 by raising sigma to 3.0 (see above).
- **The spec's closing-twist fix is not enough on its own** for tracks with loops. See the road up vectors decision above.
- **Grip limits flat corners.** With `GRIP_TAU` 0.15 s, a car on a 60 m radius turn slides outward by v squared times tau over R: 7.5 m/s at 55 m/s, enough to leave a 12 m road. Laps complete at every target speed from 10 to 40 m/s, but not at 55. Corners on the real tracks need to be wide, banked, or the grip retuned.
- **Bundle size.** `rapier3d-compat` embeds its WebAssembly as base64, so the JS bundle is about 4.9 MB (1.8 MB gzipped). Fine for v1, look at it in Milestone 5.

## Milestone 4: gas effects

- Compressed-air puffs are soft glowing points from a fixed pool (1400 particles), so nothing is allocated while racing. Code: `render/particles.ts`, `render/effects.ts`.
- Gas comes from: both underside nozzles on a hop or landing cushion, the two rear nozzles while boosting, the underside while gliding, and small corner jets while tilting or steering in the air (each jet throws gas the opposite way to the push).
- AI cars get the same puffs as the player. Puffs freeze when the game is paused and clear when a race starts or the menu opens.
- Speed lines are not done yet.
- Landing dust was tried and removed (felt fake for the neon look); puffs made brighter.

## Thruster moves and hazards (the "make the thrusters matter" round)

New moves, all paid from the one air tank:
- **Side dash**: double-tap A or D (within 0.25 s). 16 m/s sideways, 12 air, 0.7 s cooldown. On the road, sideways grip drops to 15% for 0.3 s so the car really slides (about 5 m); in the air it pushes along the car's right.
- **Brake jet**: hold S above 8 m/s. Extra 38 m/s^2 of braking for 14 air a second. The AI never uses it (it has no keyboard S: the keyboard sets `Input.retro`, the AI leaves it off).
- **Slam**: hold X in the air. Pulls the car toward the surface below it (60 m/s^2, 18 air a second, up to 30 m/s, stops 2.5 m from the surface). A landing within 0.35 s of a slam counts as soft, so it is a perfect landing if the angle is right. A separate long probe ray (14 m) finds the surface, so the normal surface sensor stays at 3 m.
- **Hop styles**: hold Shift while hopping for a long low hop (45 degrees forward, x1.25 speed, x1.2 cost); hold S for a steep high hop (x1.3 height, x1.3 cost).
- Heat (overheating nozzles) was cut by the owner. Sound comes later.

Hazards (data in `TrackDef`: `rings`, `barriers`, `slots`; logic in `track/hazards.ts`, checked in `Race`):
- **Rings** hang over the road. Flying through one (airborne only, so driving under a low ring does nothing) gives +30 air and +6 m/s along the direction of travel, once per lap. Gap arcs are three rings along a hop's path; high rings (8 m) need a high hop or a glide.
- **Hurdles** (1.1 m, full width): a hit costs 2 s and 55% of the speed. The AI hops them (a hop marker 12 m before each).
- **Slot walls** (9 m tall, a 7 m opening): the AI lines up with the opening over the last 50 m. Walls are kept 110 m or more after any hop, because a hop flies about 100 m at racing speed and the car cannot steer in the air; a test checks this for every track.
- AI lap times went up slightly (about 41 to 53 s). Without hops the AI takes the hurdle penalties.

## Sky Islands (the track revamp)

The tracks now ask for the thrusters. Falling still costs 3 s.
- **Island gaps** (`ledge: 'none'`): nothing at all between two stretches of road, 40 to 50 m. A plain hop (8 m before the edge, about 50 m/s) crosses a flat one. No ledge to drive along any more. The ledge code stays in `Track` and is tested, but no track uses it.
- **Sky islands**: a gap up to an island that hangs upside down, 8 m higher (`skyUp`), and a gap back down (`skyDown`). The road rolls 180 degrees while it is missing. Going up needs a high hop (hold S and tap Space, apex 7.4 m) plus a flip (the car must be within 30 degrees of level with the underside for a Perfect landing). Coming down: drive off the end, roll back, tap Space for the cushion (the drop is 8 m, about 12 m/s, which is Rough without it). The 8 m height was chosen so the apex of a high hop lands the car 0.5 to 1.5 m under the surface for any speed from about 40 to 60 m/s.
- **Island ends**: the collision slab is open at the end of an island and thins to a knife edge over 4 samples, so there is no wall to run into. A closing face made the sensor attach to the front of the island and crash the car.
- **Landing guide** (HUD, in the air): the angle to the surface it will land on and the key to press. Green under 30, amber under 60, red over. The surface is the road beyond the next island gap if one is within 30 m, else the road below.
- **AI**: hops the gaps as before, with a high hop when the landing is more than 5.5 m higher; turns in the air to match the landing surface (rate-planned roll and pitch, `turnToward`); steers in the air only while nearly level, because once rolled over a yaw is a sideways spin; does not hop off an upside-down island; taps hop for the cushion on a fast drop.
- **Physics changes this needed**: (1) `RIDE_RATE_JUMP`: the ride damper trusts the car's real speed when the measured distance rate jumps (the sensor switching rays at an island edge was kicking the car away). (2) `GLUE_RATE`: a car attached to a surface loses its speed away from it. (3) `addCeilingHold`: on a ceiling the car's weight no longer pulls it away from the surface, because suction alone gives out about 1 m from a ceiling and a car that bounced on landing floated off.
- Checkpoint gates keep 100 m of road clear before a gap so a respawned car can get up to speed.
- Finished cars still cruise on, so they fall into the first island gap and respawn in the background of the results screen. Harmless; the result is already fixed.
- Rings were made bigger (4.4 m) and are now the flight path: three over a flat gap, two on the way up to a sky island, three on the way down. Slot walls and hurdles stay, one or two per track, kept 110 m after any hop.

## Sound

- All sound is made in code with the Web Audio API (`audio/sfx.ts`), nothing downloaded. It builds itself on the first key press or click, because browsers keep audio silent until then; before that every call is a no-op, and where there is no audio the game is just quiet.
- Continuous: an engine hum (saw, fifth and sub through a filter that opens with speed; quieter in the air, louder boosting) and one thruster hiss whose pitch tells the jet apart (boost, brake jets, slam, glide, air-control jets).
- Effects: hop, refused hop, cushion, flip, perfect, rough and crash landings, dash, ring, barrier hit, respawn, countdown tick, go, lap and finish.
- M toggles sound (saved in localStorage as `airhop.v1.muted`); pausing silences it. Only the player's car makes engine sound.

## Flip assist (making the sky island easier)

- Near an island gap the player's car gets help: a plain Space tap becomes a high hop when the landing is more than 5.5 m higher, and while the player is not pressing roll or pitch the car turns itself toward the landing surface (the same controller the AI uses, `physics/attitude.ts`). Any roll or pitch key press takes over at once. It costs the usual small air for air control.
- It is off everywhere else, so deliberate flips for the +10 air bonus are unchanged. The LAND ANGLE guide still shows, for anyone taking over.

## Settings screen

- The pause screen (Esc) now has a settings panel: Volume (0 to 100%, steps of 10, default 80%) and Camera shake (0 to 200%, steps of 25, default 100%). Up and down pick a row, left and right change it, or drag the sliders with the mouse. Saved in localStorage as `airhop.v1.settings` and applied as soon as they change. M still turns sound off and on, separately.
- Esc now works on the track menu and the start screen too (it used to do nothing on the menu), so settings can be reached from anywhere. The pause screen is a layer above the others, and Enter does nothing while it is open.
- Logic is in `game/settings.ts` (`Settings`, `SettingsCursor`) and tested; the screen is `ui/settings.ts`.
- Fixed on the way: the pause screen's controls list was drawn far too large.

## Hints and a friendlier interface

- **On-screen hints** (`game/hints.ts`, drawn by the HUD in the upper middle): as the car nears something, a box says what it is and which key to press: gaps (tap Space at the lime line, then TAP SPACE NOW), sky islands (and PRESS E or Q while rolling, from the landing guide), driving off a sky island, hurdles, slot walls (which side the opening is on), walls, ceilings, loops and charge strips. Each kind stops showing after three clean passes (saved as `airhop.v1.hints`), so it teaches and then gets out of the way. A pass with a fall, crash or hit does not count. A Hints switch in the settings turns them all off.
- **Interface**: the pause screen has Resume, Restart race and Track menu buttons; the track menu footer has clickable Controls and Settings (and tells a new player to start with Warm-up); the start screen has Track menu and Settings links. Everything that had a key still has it.

## Milestone 5: polish and finishing

- Per-frame allocations removed from the race loop: plain loops instead of `forEach`/`some`, `playerPlace` counts racers ahead instead of sorting a copy, and the HUD readout, hint state, hint and effect-stream state are single objects filled in again each frame. Gas puffs use shared direction and range constants, and the air-control jets are cached by control combination (27 lists). The HUD only touches the page when a readout changes (the timer still changes every frame). Events (hop, landing, ring) still make a small object each, because they are rare.
- No WebGL: `main.ts` checks first and shows a plain page ("Your browser cannot show 3D") with what to try. Any other failure while starting shows "AirHop could not start". No fallback renderer.
- Speed lines: a 2D canvas over the 3D view with 34 streaks flying outward from the middle, from 45 m/s (full at 85 m/s, stronger and orange while boosting). They keep clear of the car, freeze while paused, and are off for players whose system asks for reduced motion. Numbers are `SPEED_LINES_*` in `constants.ts`.
- Camera shake: the wobble is now two sine waves at unrelated rates instead of fresh random jitter each frame, so it reads as a shudder and looks the same at any frame rate. Boosting adds a faint steady rumble (`SHAKE_BOOST`). Both follow the Camera shake setting.
- README at the repo root. Publishing the game is not done: it needs the owner's permission.

## Easier jumps, shorter hints, key reminder (after a friend playtest)

- Hints alone did not make the jump easier: the real problem was timing. A Space tap in the last 45 m before any gap edge is now held and released 8 m before the edge (`Race.bufferHop`, `HOP_BUFFER_WINDOW`, `HOP_BUFFER_AT`), keeping the hop style (long, high). Only the player gets it. A tap anywhere else is a normal hop. The hint says TAP SPACE NOW as soon as a tap would be accepted.
- Hint text cut to a title and a few words. No second sentence.
- A small list of the non-driving keys (Esc pause, R respawn, C camera, M sound, Backspace menu) sits in the bottom-left corner during a race.

## Name

- The game is now called Flying Cars on screen (title, logo, no-WebGL page, README). The folder, package and saved-data keys were renamed too (`flying-cars/`, `flyingcars.v1.*`). A one-time copy on start (`game/migrate.ts`) moves anything saved under the old `airhop.v1.*` keys, so best laps and ghosts survive.
