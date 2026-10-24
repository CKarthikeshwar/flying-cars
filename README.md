# Flying Cars

A racing game that runs in your browser. Your car sticks to floors, walls and ceilings, and everything special it does (hops, boosts, flips, dashes) spends one shared tank of air. Race three AI drivers on three tracks, then try to beat your own ghost.

Desktop only, keyboard only. No account, no server, no network use while playing. Your best laps are saved in your browser.

## Play it

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
cd flying-cars
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173/). Pick **Warm-up** first.

Add `?debug=1` to the address for debug mode: surface arrows, air, speed, landing angle, and slow motion on **T**.

## Controls

| Key | On the road | In the air |
| --- | --- | --- |
| **W** / **S** | Accelerate / brake (hold S when fast for the front jets) | Tilt the nose down / up |
| **A** / **D** | Steer. Double-tap to dash sideways | Turn. Double-tap to dash sideways |
| **Q** / **E** | | Roll left / right |
| **Space** | Hop. **Shift+Space** long hop, **S+Space** high hop | Tap just before landing for a soft landing. Hold to glide |
| **Shift** | Hold to boost | Boost the way the car points |
| **X** | | Hold to slam down onto the surface below |

Other keys: **R** respawn at the last checkpoint (+3 s), **C** camera mode, **M** sound on or off, **H** controls list on the track menu, **Esc** pause and settings.

Land level for a PERFECT landing (+5 air). A full flip in the air gives +10. Hints appear on screen the first few times you meet something new, and you can turn them off in Settings.

## Making and checking it

Run these from `flying-cars/`:

```bash
npm run dev      # development server
npm test         # all tests, no browser needed
npm run lint     # code checks
npm run build    # type check, then a production build in flying-cars/dist/
npm run preview  # try the production build locally
```

The built game in `flying-cars/dist/` is plain static files, so any static web host can serve it.

## How it is built

TypeScript, [Vite](https://vite.dev/), [Three.js](https://threejs.org/) for the picture and [Rapier](https://rapier.rs/) for the physics. Sounds are made in code with the Web Audio API, fonts are bundled, and there are no image or sound files.

The physics runs at a fixed 120 steps a second, with gravity applied by the game itself so it can point at whatever surface the car is on. Every tuning number lives in `flying-cars/src/util/constants.ts`.

More detail, if you want it:

- `AirHop Build Spec for Claude Code.md`: the original build spec
- `DECISIONS.md`: choices the spec left open, and why
- `PRODUCT.md` and `ART_DIRECTION.md`: what the game is for and how it should look
- `CLAUDE.md`: the code layout and the rules for working on it

## If it will not start

Flying Cars needs WebGL. If the page says your browser cannot show 3D, use a recent Chrome, Edge or Firefox on a desktop computer and make sure hardware acceleration is switched on in the browser settings.
