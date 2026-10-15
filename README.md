<img src="assets/icon.svg" width="64" height="64" alt="">

# DRAW THE MAP

**An FPS where you draw the map.** A browser game inspired by
[@bonkbureau's "fps where the map is drawn by players" reel](https://www.instagram.com/reel/Deev6OXRk38/):
every match starts with 60 seconds where everyone draws the arena in orbit above the Earth, then you
fight on whatever got drawn.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/
npm test           # geometry, physics and bot tests
```

The dev server only listens on localhost; to reach it from other devices on your LAN, run `npm run dev -- --host`.

Every start opens on a title screen with a short how-to. **TUTORIAL** walks you through drawing,
moving, gliding and shooting with a checklist (no time pressure, the target dummies don't shoot back).
**PLAY** opens the mode menu: **4 VS 4**, **10 VS 10** or **FREE FOR ALL**. The other players are bots
that draw (and fight) alongside you.

### 1. Draw the map (60 s)

| Input | Action |
| --- | --- |
| Left-drag | Draw |
| `1` **RIBBON** | Draws in the air facing you; the stroke becomes a wide band extruded away from you. Flat lines become floors, slopes become ramps, loops become hoops |
| `2` **GROUND** | Paints flat, walkable paths on the surface you start on (empty space counts as bridge level). Close a loop (overshooting is fine) and it becomes a platform |
| `3` **WALL** | Draws on the floor: lines become cover walls, loops become rings |
| `Tab` | Cycle tools |
| Right-drag (Mac: Ctrl-drag) / `A` `D` | Rotate the view (draw ramps toward the enemy from the side) |
| `W` `S` / wheel | Tilt / zoom |
| `Q` `E` | Lower / raise GROUND and WALL strokes by 1.5 m (shown in the hint) |
| `Z` | Undo your last stroke (refunds ink) |
| `Enter` | Ready (skip to the fight) |

Ink is limited and the spawn rings are no-draw zones.

### 2. Fight on it

| Input | Action |
| --- | --- |
| Mouse / `WASD` | Look / move |
| `Space` | Jump, press again in the air to double-jump, then keep holding to glide on the jet (fuel bar under your health, refills on the ground) |
| `Shift` | Sprint |
| LMB | Fire |
| RMB (Mac: two-finger click) | Aim: the laser rifle zooms into its scope, the plasma lobber zooms a little. Hold to aim, or tap once to keep aiming until the next press. Ctrl+click (Mac) toggles aiming. Pure toggle mode is in the pause menu |
| `1` `2` `Q` / wheel | Laser rifle / plasma lobber (arcing orbs, splash damage and knockback, so you can rocket-jump) |
| `R` | Reload |
| `Esc` | Pause |

Falling off the map is a death; whoever hit you last gets the kill. First team to the score limit
wins. Afterwards, **KEEP DRAWING** adds another round of drawing on top of the same map.

**Free aim:** the game asks the browser to capture the mouse (pointer lock) when you deploy. If the
browser refuses, the game switches to free aim instead. Embedded previews such as T3 Code's preview pane,
sandboxed iframes and unfocused windows always refuse. In free aim, moving the mouse turns the view.
Resting the cursor at a screen edge keeps turning, clicks fire, and `Esc` pauses. For the best feel,
open the game in a normal Chrome/Safari/Firefox tab.

## How it's built

Vanilla JS, [three.js](https://threejs.org) and [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh), bundled with Vite.

- `src/strokes.js`: turns stroke points into geometry. Bands sweep a rounded-rect profile along the path; slabs are extruded loops.
  Material group 0 is the broad face, group 1 the edge trim. The fight phase whitens only the faces,
  which gives the white-with-coloured-trim look.
- `src/drawPhase.js`, `src/botArtist.js`: the drawing phase, plus bots that plan shapes (ramps,
  platforms, hoops, springs, letters, castle walls) and draw them with name-tagged cursors.
- `src/physics.js`: every stroke and the arena are merged into one BVH, with sub-stepped capsule collision.
- `src/jet.js`, `src/aim.js`: the glide jet and aim-down-sights input as small pure functions.
- `src/intro.js`, `src/tutorial.js`: the title screen and the tutorial checklist director.
- `src/fight.js`, `src/player.js`, `src/bot.js`: combat, the first-person controller and viewmodel,
  and bot AI with ledge probes, landing prediction and arena waypoints.
- `src/space.js`: procedural Earth (continents, domain-warped clouds, atmosphere) and stars.
- `src/audio.js`: every sound is synthesised with WebAudio, so there are no asset files.

On software renderers (e.g. SwiftShader) the game drops to a low-quality path automatically. You can force it with `?low`.
