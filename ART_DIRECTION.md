# AirHop: Art Direction

Dark industrial neon, in the manner of *Distance*, with a small, clean HUD in the manner of *Trackmania*. Built from code only, no licensed assets, nothing that costs frame rate.

Mockups (open from `ui-mockups/`, serve with `python -m http.server`):
- `hud.html`: in-race HUD with a state switcher (cruise, boost, low air, flip, perfect, rough, crash).
- `menu.html`: track select. Arrow keys and Enter work.
- `results.html`: post-race results.
- `tokens.css`: the source of truth for colours and type.

## The one idea

The player sits in a dark room looking at a glowing track. Everything on screen is either **dark ground** or **light that means something**. Colour is never decoration. Each accent has exactly one job.

## Colour

| Token | Hex | Job |
| --- | --- | --- |
| `--ground` | `#06080b` | Page and scene base, blue-black |
| `--panel` / `--panel-2` | `#0c1116` / `#121a21` | UI panels |
| `--line` / `--line-strong` | `#22303a` / `#34495a` | Dividers, outlines |
| `--text` / `--text-dim` | `#eaf1f5` / `#93a4af` | Text. Dim is 7:1 on panels |
| `--air` | `#19e3ff` cyan | The air tank, UI focus, selected item |
| `--heat` | `#ff7a1a` orange | Speed, boost, the player, primary action |
| `--charge` | `#b8ff3c` lime | Charge strips, ahead, Perfect, new record |
| `--alarm` | `#ff2e63` red-pink | Low air, crash, behind |
| `--ghost` | `#a99bff` violet | The ghost lap only |

In the 3D scene the same colours carry the same meaning: cyan left edge and orange right edge on the road (so "which way is up and forward" reads at a glance on a wall or ceiling), lime for charge strips, cyan for hop markers.

## Type

- **Chakra Petch** for UI text and labels. Squared, slightly technical, readable at small sizes.
- **Saira Extra Condensed** for every number (speed, timer, air, positions) and for titles. Tall and narrow so big numerals fit without crowding the track. Numbers use tabular figures so they do not jitter as they change.
- Labels are small, uppercase and tracked. Numbers carry the weight.
- Self-host both (OFL licence). The mockups load them from Google Fonts only for convenience. The game must make no network calls.

## Shape and material

- **Chamfered corners** (cut diagonal corners, never rounded) on panels, buttons and the selected track. This is the one shape signature, it reads industrial, and it costs nothing.
- Panels are flat and semi-opaque dark. No glass, no backdrop blur over the canvas, no gradient text.
- The only glow is on things that are lit in the world: road edges and the air segments. Glow on UI chrome is avoided.
- Depth comes from layering dark values, not shadows.

## In-race HUD

Reads at a glance, never rotates with the car, covers little of the screen.

| Element | Position | Notes |
| --- | --- | --- |
| Air gauge | Left, vertically centred | 20 segments plus a number. Cyan. Turns red, pulses and shows LOW under 20. The biggest element of the HUD |
| Speed | Bottom centre | Large number with KM/H and a thin orange bar. Number turns orange while boosting |
| Lap and timer | Top centre | Lap count small, timer large |
| Ghost gap | Under the timer | Signed (`-0.42`, `+0.37`), green ahead, red behind |
| Position | Top left | "2nd / 4" |
| Event pop-ups | Above the car | PERFECT (lime, +5 AIR), ROUGH (orange), CRASH (red, +3.0 s), +10 AIR (cyan). In and out within about 1.25 s |

Crash adds a red edge vignette. Nothing else flashes.

## Menus

- **Track select:** list on the left, big preview on the right (track name, what it teaches, wall/ceiling/gap/loop tags, outline map with start line, charge strips and hop markers, best lap, best race, ghost status). The selected track fills cyan and slides right. The orange RACE button is the only orange block on the screen. Footer: Sound, Camera shake and Ghost toggles, with key hints.
- **Results:** a giant orange finishing place, total time with any crash penalty stated, a lime "New best lap" tag, lap splits against the ghost, standings with the player highlighted, then Race again (primary), Next track and Menu.

## Motion

Few, authored moments, all ease-out and under about a second: the track outline drawing itself on selection, results rows rising in, event pop-ups, the low-air pulse. Respect `prefers-reduced-motion` (the pulse and entrances turn off).

## Accessibility

Colour never carries meaning alone: low air also pulses and says LOW; ahead/behind carries a sign; positions carry text. Text over the scene sits on a dark plate. Focus rings are cyan.

## 3D scene direction (for Milestone 4)

- Near-black sky with a faint horizon glow, distant dark tower silhouettes, fog to hide draw distance.
- Road surface dark and slightly reflective. Glowing edge strips (cyan left, orange right), dashed centre line.
- Car: low wedge, dark body with an orange thruster glow and cyan accent line, from primitives (`carModel.ts`). The ghost is the same car in translucent violet.
- Post-processing: bloom on emissive materials only, a mild vignette, and a quality toggle to turn bloom off on integrated graphics.
- Particles: thruster puffs, speed lines and landing dust as instanced meshes.

## Still open

- Final car colours for the three AI racers (names used in the mockup, Kestrel, Marrow and Dune, are placeholders).
- A logo beyond the type-only wordmark (AIR in white, HOP in cyan).
- Sound design (Milestone 4).
