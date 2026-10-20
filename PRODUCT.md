# Product

<!-- impeccable:product-schema 1 -->

> Written from `AirHop Build Spec for Claude Code.md` and the user's chat. The user delegated remaining choices ("go ahead with what you like"), so items marked (assumed) were inferred, not confirmed.

## Platform

web

## Stack

TypeScript, Vite, Three.js, Rapier (fixed by the build spec). Game UI is plain HTML/CSS layered over the WebGL canvas. Self-hosted fonts only, no network calls at runtime.

## Users

Single player at a desktop browser with a keyboard, sitting close to a monitor, mid-race at 60 fps. They read the UI in glances measured in tenths of a second, so the HUD has to be understood peripherally. Menus and results are used between races, calmly.

## Product Purpose

A browser racing game where the car sticks to floors, walls and ceilings and spends one shared air tank (100 units) on hops, boosts and flips. Success: a player finishes 3 laps on each of three tracks against three AI racers, sees their time, and wants to beat their ghost.

## Positioning

The only thing to manage is air: every special move draws from one visible tank, and flips and perfect landings refund it. The UI must make that tank the most legible thing on screen.

## Operating Context

Desktop browser, keyboard only for v1. No backend; best times live in localStorage. Game name: AirHop. Three tracks: Warm-up, Spiral Tower, Gap Run. Three AI racers plus the player, so position is "Nth of 4".

## Capabilities and Constraints

- HUD elements are fixed by the spec: vertical air gauge at left (red and pulsing below 20), speed in km/h bottom centre, lap count (e.g. 2/3) and race timer at top, race position top left, ghost gap (green ahead, red behind), pop-up text PERFECT / ROUGH / CRASH / "+10 AIR".
- Menu: track select with best times, mute control. Results screen after each race.
- Camera rotates on walls and ceilings, so the HUD stays screen-fixed and never rotates with the car.
- Original assets only. No Tesla or SpaceX names, logos or car shapes.
- 60 fps target on integrated graphics: UI effects must be cheap (no heavy backdrop blur over the canvas).

## Brand Commitments

Name: AirHop. Visual direction pinned by the user in chat: dark industrial neon in the manner of the game Distance, a few saturated accents, and a small, clean Trackmania-style HUD (assumed from "go ahead with what you like" after the user was shown three directions and a recommendation).

## Evidence on Hand

No existing art, logo or screenshots. Reference games viewed in the browser: Distance, Redout 2, Trackmania. Track outlines and sample times in the mockups are synthetic placeholders.

## Product Principles

1. Air is the star: the gauge is the most readable thing on screen at every moment.
2. Glanceable at speed: few elements, large numerals, no reading mid-race.
3. The HUD never gets in the way of seeing the track, which can be above, beside or behind the car.
4. Feedback is instant and short: events appear and clear within about a second.
5. Honest feel: no decoration that costs frame rate.

## Accessibility & Inclusion

Colour is never the only signal: low air also pulses and shows a number; ahead/behind carries a +/- sign; positions carry text. Respect `prefers-reduced-motion` (no pulsing or shake). Text contrast at least 4.5:1 against the dark panels; the in-race HUD sits over a moving scene, so it keeps dark backplates behind text.
