# AirHop: Build Spec for Claude Code

Oct 20, 2026 · @Karthikeshwar

AirHop is a browser racing game where a car sticks to walls and ceilings and spends a limited air tank on hops, boosts and flips. This spec is complete enough to build it milestone by milestone.

## Overview

AirHop is a single-player, browser-based racing game. The car is a grasshopper, not a butterfly: it drives on any surface, then spends a limited tank of compressed air to hop, boost and flip. The idea is inspired by the flying car Tesla showed in October 2026, which used compressed-air thrusters and a suction fan. The game uses an original car and original names. Do not use Tesla or SpaceX names, logos or car shapes.

**Core loop**

1. Drive on floors, walls and ceilings. Suction keeps the car stuck to the surface.
2. Burn air to hop over gaps, cut corners or boost.
3. Flip in the air for bonus air, but land on the wheels.
4. Air refills slowly, and faster on charge strips.

**Scope of v1**

- Desktop browser, keyboard controls, 60 frames per second target.
- No backend. Everything runs client-side and best times live in localStorage.
- Three tracks, a lap timer, a ghost of your best lap, and three AI racers.

**Definition of done for v1**

- A player can finish a 3-lap race on each track against AI and see their time.
- Hop, boost, flip and landing all feel responsive. No input lag, no jitter.
- The game starts from `npm run dev` and builds with `npm run build`.

## Tech stack and setup

Use TypeScript, Vite, Three.js and Rapier. Everything runs in the browser, so the finished game can be shared as a static site.

| Piece | Choice | Why |
| --- | --- | --- |
| Language | TypeScript, strict mode | Catches vector and quaternion mix-ups at compile time |
| Bundler | Vite | Instant reload while tuning feel |
| Rendering | Three.js | The standard 3D library for the web |
| Physics | Rapier (`@dimforge/rapier3d-compat`) | Fast 3D rigid bodies in WebAssembly, with custom forces |
| Track curves | `THREE.CatmullRomCurve3` | Smooth closed splines, built in |
| Audio | Web Audio API | No library needed for engine hum and thruster hiss |
| Tests | Vitest | Unit tests for the math and physics modules |
| Lint and format | ESLint, Prettier | Keeps Claude Code's edits consistent |

**Scaffold commands**

```bash
npm create vite@latest airhop -- --template vanilla-ts
cd airhop
npm i three @dimforge/rapier3d-compat
npm i -D @types/three vitest eslint prettier
```

**Two setup rules**

- Set Rapier's world gravity to zero. The game applies gravity itself, because "down" changes with the surface the car is on.
- Run physics at a fixed step of 1/120 s with an accumulator, and render at the display rate. This keeps the car's behavior identical on slow and fast machines.

## Project structure

Keep physics, track, rendering and UI in separate folders. Physics and track code must never import from `render/` or `ui/`, so they can be unit-tested without a browser.

```text
airhop/
  index.html
  src/
    main.ts              boots the game and starts the loop
    game/
      Game.ts            state machine: menu, countdown, racing, finished
      Loop.ts            fixed-timestep accumulator
      Race.ts            laps, checkpoints, positions, timer, ghost
    physics/
      world.ts           Rapier setup, zero gravity
      CarBody.ts         rigid body and wheel raycasts
      surface.ts         finds the surface under the car and its normal
      forces.ts          gravity, suction, drive, steering, drag
      thrusters.ts       air tank, hop, boost, flip torque
    track/
      Track.ts           spline, banking frame, mesh and collider builder
      checkpoints.ts     gate positions along the spline
      tracks/            one data file per track
    ai/
      Racer.ts           waypoint-following controller
    render/
      scene.ts           lights, sky, fog
      carModel.ts        original low-poly car built in code
      camera.ts          smooth chase camera
      effects.ts         thruster puffs, speed lines, landing dust
    input/
      keyboard.ts        key state to a plain Input object
    ui/
      hud.ts             air gauge, speed, lap, timer
      menu.ts            track select and results
    audio/
      sfx.ts             engine hum, hiss, landing thud
    util/
      math.ts            quaternion and vector helpers
      constants.ts       every tuning number (see Tuning constants)
  tests/                 Vitest files that mirror src/
```

**Data flow each physics step**

1. `keyboard.ts` produces an `Input` object: steer, throttle, brake, hop, boost, pitch, roll.
2. `surface.ts` finds the surface under the car and returns its normal.
3. `forces.ts` and `thrusters.ts` add forces and torques to the Rapier body.
4. Rapier steps the world.
5. `Race.ts` checks checkpoints, and `render/` and `ui/` read the new state.

## Game design

Every special move costs air from one shared tank of 100 units. The player is always choosing between spending air now and saving it for later.

| Mechanic | Input | What it does | Air cost or limit |
| --- | --- | --- | --- |
| Drive and steer | W, S, A, D | Accelerate, brake and turn on whatever surface the car touches | Free |
| Suction | Automatic | Pulls the car onto any surface within 1.5 m, even upside down | Free, off while far from every surface |
| Hop | Space | One upward burst along the surface normal | 15 units, 0.4 s cooldown |
| Boost | Hold Shift | Forward thrust along the car's heading | 20 units per second |
| Air control | W, S pitch; Q, E roll; A, D yaw | Rotates the car in the air | 3 units per second while held |
| Flip bonus | Complete a full rotation | Refunds air | +10 units per full pitch or roll turn |
| Refill | Automatic | Slow regeneration on surfaces | +4 units per second, 0 in the air |
| Charge strip | Drive over it | Fast refill | +40 units per second |

**Landing outcomes**

The landing check compares the car's up direction with the surface normal and measures speed into the surface. Thresholds are in the tuning table.

| Landing | Condition | Result |
| --- | --- | --- |
| Perfect | Angle under 30 degrees and impact speed under 8 m/s | +5 air and a short speed boost |
| Rough | Angle 30 to 60 degrees, or impact speed 8 m/s or more | Speed multiplied by 0.6 |
| Crash | Angle over 60 degrees | Respawn at the last checkpoint after 1.5 s, plus a 3 s time penalty |

**Design rules**

- Hops and flips should be the fastest way past gaps and tight corners, but never the only way to finish a track.
- Every track needs at least one wall section, one ceiling section and one gap that rewards a hop.
- The air gauge is always visible. The player should never be surprised by running dry.

## Physics and math

Notation: m is the car mass, g is 9.81 m/s² times the gravity scale, **n̂** is the unit surface normal pointing from the surface to the car, **û** is the car's up direction, **f̂** is the car's forward direction. All forces are applied inside the fixed 1/120 s physics step.

**1. Surface detection**

Cast a ray of length r\_s along the car's down direction (−û). If it misses, cast a fan of six more rays (forward, back, left, right, up, and down-forward) and take the closest hit. The hit gives **n̂** and the distance d. Smooth **n̂** over a few frames so the car does not twitch at seams between wall and floor. The car is "attached" when a hit is found with d below r\_s.

**2. Gravity and suction**

World gravity always pulls along −y. Suction pulls toward the surface and fades with distance:

```latex
F_s(d) = \sigma \, m g \left(1 - \frac{d}{r_s}\right), \qquad 0 \le d < r_s, \qquad \sigma > 1
```

Intuition: on a ceiling, gravity pulls the car off with force mg, so suction must beat it. That is why σ must be above 1. The fade means the car lets go smoothly as it hops away. After a hop, disable suction for 0.25 s so it cannot pull the car straight back down.

**3. Driving**

Project the forward direction onto the surface so the car drives along it, not into it:

```latex
\hat t = \frac{\hat f - (\hat f \cdot \hat n)\,\hat n}{\left\lVert \hat f - (\hat f \cdot \hat n)\,\hat n \right\rVert}
```

The drive force combines throttle, quadratic drag, and a sideways grip term that removes sliding:

```latex
\mathbf F = m\,a_{max}\,u_{throttle}\,\hat t \;-\; c_d \lVert \mathbf v \rVert\, \mathbf v \;-\; \frac{m\,\mathbf v_{lat}}{\tau_g}, \qquad \mathbf v_{lat} = \mathbf v - (\mathbf v\cdot\hat t)\,\hat t - (\mathbf v\cdot\hat n)\,\hat n
```

Steering sets a yaw rate about **n̂**: ω = u\_steer · ω\_max · min(1, ‖v‖ / v\_ref). Intuition: you cannot turn at standstill, and turning saturates at speed.

**4. Thrusters**

A hop is a velocity change along the surface normal. Its apex height follows from energy:

```latex
\Delta \mathbf v = \Delta v_h \, \hat n, \qquad h = \frac{\Delta v_h^{2}}{2g}
```

Boost thrust shrinks as the tank empties, like a real pressure tank:

```latex
\mathbf F_b = m\, a_b \left(0.4 + 0.6\,\frac{A}{A_{max}}\right) \hat f
```

Air changes continuously and with one-time costs for hops and cushions, always clamped to \[0, A\_max\]:

```latex
\frac{dA}{dt} = r_{regen}\,[\text{attached}] - r_{boost}\,[\text{boosting}] - r_{att}\,[\text{air control}] + r_{strip}\,[\text{on strip}]
```

**5. Flips**

Torque rotates the car according to Iα = τ. Apply torque from input about the car's own axes, cap the angular speed at ω\_cap, and add light angular damping. Count flips by accumulating rotation about the car's local right axis **r̂** (pitch) and forward axis (roll) while airborne:

```latex
\theta \leftarrow \theta + (\boldsymbol{\omega} \cdot \hat r)\,\Delta t, \qquad \text{one flip when } |\theta| \ge 2\pi\ \text{(then reset } \theta\text{)}
```

Store orientation as a quaternion and never use Euler angles. This avoids gimbal lock when the car is upside down.

**6. Landing check**

On the step where the car goes from airborne to attached, compute:

```latex
\alpha = \arccos(\hat u \cdot \hat n), \qquad v_n = -\,\mathbf v \cdot \hat n
```

Then classify with the landing table in Game design. Cushion assist: if the car is airborne, descending, within 3 m of a surface and the player presses Hop, apply an impulse that cuts v\_n by 60% and costs 5 air, once per jump. Intuition: a short counter-burst is the soft landing the real car demonstrated.

**7. Track geometry**

A track is a closed Catmull-Rom spline γ(t). Its tangent is **T** = γ′/‖γ′‖. Build an up vector **U** along the spline by parallel transport, which turns **U** by the smallest rotation as **T** changes. Then add a banking angle φ(t) that rotates **U** about **T**:

```latex
\mathbf B = \mathbf T \times \mathbf U, \qquad S(t, w) = \gamma(t) + w\,\mathbf B(t), \qquad w \in \left[-\tfrac{W}{2}, \tfrac{W}{2}\right]
```

The road is the ribbon S(t, w). A wall is φ = 90 degrees, a ceiling is φ = 180 degrees, and a loop is a spline that curls back on itself. Sample γ finely (about one point per metre), build the mesh from the ribbon, and add it to Rapier as a triangle-mesh collider.

## Controls and HUD

The same keys do different things on a surface and in the air. Read input into one plain `Input` object each step, so the AI can fill the same object.

| Key | On a surface | In the air |
| --- | --- | --- |
| W | Accelerate | Pitch nose down |
| S | Brake and reverse | Pitch nose up |
| A, D | Steer left and right | Yaw left and right |
| Q, E | Not used | Roll left and right |
| Space | Hop | Cushion burst when descending near a surface |
| Shift (hold) | Boost | Boost |
| R | Respawn at last checkpoint, 3 s penalty | Same |
| Esc | Pause | Pause |

**HUD elements**

- Air gauge: a vertical bar at the left of the screen. It turns red and pulses below 20 units.
- Speed in km/h at the bottom centre, lap count (for example 2/3) and race timer at the top.
- Race position (for example 2nd of 4) at the top left.
- Ghost gap: the time difference to the best lap, green when ahead and red when behind.
- Pop-up text for events: PERFECT, ROUGH, CRASH, and "+10 AIR" after a flip.

**Camera**

- A chase camera sits behind and above the car along the car's own up direction **û**.
- Rotate the camera's up vector toward **û** at a slow rate, about 3 per second with spherical interpolation. A fast turn would make wall and ceiling driving nauseating.
- Widen the field of view from 70 to 85 degrees as speed rises, and add a brief shake on landings.

## Milestones

Build in this order. Each milestone ends with a game that runs, a git commit, and a short note on what to try. Do not start the next milestone until every "Done when" item passes.

### Milestone 1: Hop and land on flat ground (2 to 3 days)

Goal: prove that hopping, boosting, flipping and landing feel good. This is the make-or-break step.

**Tasks**

- Scaffold the Vite project and add the fixed-timestep loop, Rapier with zero gravity, a Three.js scene, a large flat ground, lights and sky.
- Add the car as a box collider of 2 m × 0.8 m × 4 m with mass 800 kg. Wheels are visual only.
- Implement driving, steering, drag and sideways grip from the Physics and math section.
- Implement the air tank, hop, boost, regeneration, air control, flip counting, landing check and cushion assist.
- Add the chase camera, the air gauge, and pop-up text for landings and flips.
- Put every number in `constants.ts`.

**Done when**

- Top speed on flat ground is between 55 and 65 m/s.
- A hop from standstill reaches an apex of 4.1 m, give or take 0.4 m.
- A player can complete one flip in a single hop and still land with a Perfect rating.
- Vitest passes for the landing classifier, the flip counter and the air clamp (air never leaves 0 to 100).
- The game holds 60 frames per second on a mid-range laptop.

### Milestone 2: Walls, ceilings and spline tracks (about 1 week)

Goal: make the car stick to any surface and drive on a track built from a spline.

**Tasks**

- Build `Track.ts`: sample the spline, build the up-vector frame by parallel transport, apply banking, and generate the ribbon mesh and a triangle-mesh collider.
- Fix the closed-loop twist: after transporting **U** once around the loop it may not match the start. Spread the leftover angle evenly along the spline.
- Add surface detection with the ray fan and a smoothed normal, plus suction with distance fade and the 0.25 s lockout after a hop.
- Add the camera up-vector interpolation and the respawn key.
- Make a test track: straight, 90 degree wall, ceiling section and a full loop.

**Done when**

- The car drives up the wall at 20 m/s or more and stays attached.
- The car completes the loop at 25 m/s without detaching.
- A stationary car placed on the ceiling stays attached for 10 s.
- Unit tests confirm that **U** is perpendicular to **T** and that ‖**B**‖ = 1 at every sample, within 1e-6.

### Milestone 3: Racing, ghost and AI (about 1 week)

Goal: turn the driving model into a race.

**Tasks**

- Add checkpoint gates as planes at fixed spline positions. A lap counts only when every gate is passed in order.
- Add a 3-2-1 countdown, the race timer, lap counter and results screen. Save the best lap in `localStorage`.
- Record the player's position and orientation every 1/30 s and replay the best lap as a translucent ghost.
- Write the AI in `Racer.ts`: aim at a point on the spline a lookahead distance L = 8 m + 0.2 v ahead, steer by the angle error, and set target speed from curvature κ by v\_target = √(a\_lat / κ). Use boost on straights when air is above 50, and hop at hop markers stored in the track data.
- Add three AI racers with skill factors of 0.85, 0.90 and 0.95 applied to v\_target.

**Done when**

- A headless run of each AI finishes 3 laps on the test track in 10 of 10 trials.
- Skipping a gate does not count a lap.
- The ghost matches the recorded positions within 5 cm.
- The best lap time is still there after reloading the page.

### Milestone 4: Content and feel (about 1 week)

Goal: three real tracks and the sensory polish that makes hopping satisfying.

**Tasks**

- Build three tracks as data files: *Warm-up* (gentle curves and one wall), *Spiral Tower* (a climbing spiral with a ceiling section) and *Gap Run* (gaps that reward hops, plus a loop).
- Add charge strips, placed before sections where the player will want to spend air.
- Build an original car from primitives in `carModel.ts`: a low wedge body, four wheels and visible thruster nozzles underneath and at the rear.
- Add effects: thruster puffs, speed lines, landing dust and camera shake. Add sound: engine hum that rises with speed, thruster hiss, landing thud and flip chime.
- Add the track select menu and results screen with best times.

**Done when**

- Each track has at least one wall section, one ceiling section and one gap that rewards a hop.
- A decent player finishes a lap in 40 to 90 seconds on every track.
- Every track can also be finished without a single hop, only slower.
- All effects and sounds trigger on the right events and can be muted in the menu.

### Milestone 5: Polish, performance and release (open-ended)

Goal: a stable build that anyone can open from a link.

**Tasks**

- Remove per-frame allocations: reuse `Vector3` and `Quaternion` objects in the physics loop. Cap the device pixel ratio at 2.
- Add pause, volume and camera-shake settings, and handle window resize.
- Show a friendly message if WebGL is unavailable.
- Tune constants through short playtests and record each change in the commit message.
- Write a README with the controls and the build steps. Deploy the `dist/` folder to Netlify, Vercel or GitHub Pages.

**Done when**

- `npm run build` finishes with no TypeScript errors and no console errors at runtime.
- The game holds 60 frames per second at 1080p on an integrated-graphics laptop.
- A fresh load can play all three tracks from the menu through to the results screen.

## Tuning constants

Put these in `src/util/constants.ts` under the names shown. They are starting values to be tuned by playtesting, and the "Derived checks" below show how they fit together.

| Constant | Value | Meaning |
| --- | --- | --- |
| `PHYSICS_DT` | 1/120 s | Fixed physics step |
| `GRAVITY` | 9.81 m/s² | World gravity along −y |
| `CAR_MASS` | 800 kg | Mass m |
| `A_MAX` | 20 m/s² | Throttle acceleration |
| `DRAG_C` | 4.4 kg/m | Quadratic drag coefficient c\_d |
| `GRIP_TAU` | 0.15 s | Time to kill sideways sliding |
| `STEER_RATE_MAX` | 1.8 rad/s | Maximum yaw rate on a surface |
| `STEER_V_REF` | 15 m/s | Speed at which steering reaches full rate |
| `SURFACE_RANGE` | 1.5 m | Suction and attachment range r\_s |
| `SUCTION_SIGMA` | 1.5 | Suction strength σ in multiples of mg |
| `SUCTION_LOCKOUT` | 0.25 s | Suction off after a hop |
| `AIR_MAX` | 100 | Tank capacity A\_max |
| `HOP_DV` | 9 m/s | Hop velocity change Δv\_h |
| `HOP_COST` | 15 | Air per hop |
| `HOP_COOLDOWN` | 0.4 s | Minimum time between hops |
| `BOOST_ACCEL` | 20 m/s² | Boost acceleration a\_b at a full tank |
| `BOOST_RATE` | 20 per s | Air burned while boosting |
| `ATT_RATE` | 3 per s | Air burned while using air control |
| `AIR_TORQUE_ALPHA` | 14 rad/s² | Angular acceleration from air control |
| `AIR_SPIN_CAP` | 7 rad/s | Maximum spin speed |
| `AIR_SPIN_DAMP` | 0.5 per s | Light angular damping |
| `REGEN_RATE` | 4 per s | Refill while attached |
| `STRIP_RATE` | 40 per s | Refill on a charge strip |
| `FLIP_REFUND` | 10 | Air returned per full flip |
| `LAND_PERFECT_ANGLE` | 30 degrees | Perfect landing limit on α |
| `LAND_CRASH_ANGLE` | 60 degrees | Crash above this α |
| `LAND_SAFE_SPEED` | 8 m/s | Impact speed v\_n limit for Perfect |
| `LAND_PERFECT_REFUND` | 5 | Air returned for a Perfect landing |
| `LAND_PERFECT_BOOST` | 3 m/s | Forward speed added for a Perfect landing |
| `LAND_ROUGH_SPEED_MULT` | 0.6 | Speed multiplier for a Rough landing |
| `RESPAWN_DELAY` | 1.5 s | Wait before respawn after a crash |
| `RESPAWN_PENALTY` | 3 s | Time added to the race clock |
| `CUSHION_RANGE` | 3 m | Height for the cushion burst |
| `CUSHION_CUT` | 0.6 | Fraction of v\_n removed |
| `CUSHION_COST` | 5 | Air per cushion |
| `AI_LOOKAHEAD_BASE` | 8 m | Base lookahead, plus 0.2 × speed |
| `AI_LAT_ACCEL` | 18 m/s² | Cornering limit a\_lat for the AI |
| `AI_BOOST_AIR_MIN` | 50 | AI boosts only above this air |
| `CAM_UP_RATE` | 3 per s | Camera up-vector turn rate |
| `FOV_RANGE` | 70 to 85 degrees | Field of view from stopped to top speed |

**Derived checks**

If a tuned value breaks one of these, change the constant, not the check.

- Top speed without boost: √(m · A\_MAX / DRAG\_C) = √(800 × 20 / 4.4) ≈ 60 m/s.
- Top speed with a full tank of boost: √(800 × 40 / 4.4) ≈ 85 m/s.
- Hop apex: HOP\_DV² / (2 · GRAVITY) = 81 / 19.62 ≈ 4.1 m. Hop airtime: 2 · HOP\_DV / GRAVITY ≈ 1.8 s.
- A clean flip needs about 0.5 s to spin up, 0.4 s at full spin and 0.5 s to stop, about 1.4 s in total. That fits inside a 1.8 s hop with 0.4 s to spare, which is tight on purpose.
- Ceiling hold: net suction force is (SUCTION\_SIGMA − 1) · m · g, which is 0.5 mg. It must stay positive.
- A full tank gives 5 s of continuous boost (100 ÷ 20) or 6 hops (100 ÷ 15, rounded down).

## Rules for Claude Code

Read the whole spec before writing code, then work through the milestones in order.

1. Start by creating a `CLAUDE.md` in the repo root that copies the project structure, the commands (`npm run dev`, `npm test`, `npm run build`) and rules 2 to 10 below.
2. Use strict TypeScript with no `any`. Keep modules small and give each one a single job.
3. Put every tuning number in `constants.ts`. Never hard-code a magic number in physics code.
4. Do not allocate objects inside the physics step. Reuse `Vector3` and `Quaternion` instances.
5. `physics/` and `track/` must not import from `render/` or `ui/`.
6. Write Vitest tests together with the code they cover. Before calling a milestone done, run `npm test` and `npm run build`, and check each "Done when" item.
7. Add a debug mode at `?debug=1`. It shows surface normals as arrows, the air value, speed, landing angle, and a slow-motion key (T). Tuning depends on it.
8. Use only assets you create in code or that are free of licence terms. Make no network calls. Do not use Tesla or SpaceX names, logos or car shapes.
9. If the spec is ambiguous, pick the simplest option and record it in `DECISIONS.md` with one line of reasoning.
10. Commit at the end of each milestone with the message `Milestone N: <summary>`.

**Report after each milestone**

- What now works and how to run it.
- Each "Done when" item marked pass or fail, with the number measured where one exists.
- Up to three feel questions for the human to playtest, for example "is the hop too floaty?".

**Known risks and fixes**

| Risk | Symptom | Fix |
| --- | --- | --- |
| Tunneling at high speed | Car falls through the track at about 85 m/s, which is 0.7 m per step | Enable continuous collision detection on the car, keep track colliders at least 0.5 m thick, and rely on the surface raycast for attachment |
| Jitter on the surface | Car vibrates when suction and contact fight | Replace box contact with a spring and damper along the normal: F = k(h₀ − d) − c·v\_n, with ride height h₀ = 0.4 m |
| Snagging at seams | Car bumps where track segments join | Smooth the normal over a few frames and use one welded mesh per track |
| Camera sickness | Camera flips on ceilings and loops | Lower `CAM_UP_RATE` and interpolate the up vector with spherical interpolation |
| Closed-loop twist | Track surface twists at the start and finish | Spread the leftover angle evenly along the spline (Milestone 2) |
| Slow frames | Large frame gaps cause a physics spiral | Cap the accumulator at 0.1 s so the game slows down instead of freezing |

## Later ideas

None of these belong in v1. Do not build them until all five milestones pass.

- **Online ghost leaderboard:** upload best-lap recordings to a small backend and race the world's best ghost.
- **Procedural tracks:** generate random closed splines with a minimum turning radius, then add banking from smooth noise. Reject any track whose loop twist or self-intersection check fails.
- **Multiplayer:** share state over WebSockets with client-side prediction. The fixed 1/120 s physics step already makes the simulation deterministic enough for this.
- **Gamepad and touch controls:** map the same `Input` object to analog sticks and on-screen buttons.
- **Upgrades:** a bigger tank, a stronger hop or faster regeneration, unlocked by finishing races.
- **Track editor:** place spline points and banking in the browser and export the track data file.
- **Daily challenge:** one fixed seed per day with a shared leaderboard.
