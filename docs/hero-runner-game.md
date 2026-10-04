# Hero Runner Game

Plan for replacing the bottom parallax cloud layer of the `game-night-light` hero
with an endless runner in the spirit of the browser 404 page's game: a player
character runs along the ground and jumps over ground obstacles and low flyers,
while high flyers pass harmlessly overhead. **Jump is the only move** — there is
no duck. Scope is the hero background only — the RSVP form, page
content, `.ics` generation, and OG images are untouched.

Status: **planned, not implemented.**

## Decisions

| Question | Decision |
| --- | --- |
| Idle behaviour | Static scene. A player block sits at the left edge of the canvas and nothing moves until input. |
| Start trigger | Tapping the hero **or** pressing space while the game region is focused. |
| Input safety | Must never interfere with the invitee's ability to read the invite or fill out the RSVP form. |
| Mobile | Same as desktop: tap the hero. No separate touch controls. |
| Controls | **Jump only** — one button. Space / tap jumps; Space / Enter restarts when dead. No duck, no second action. |
| Clouds | Game replaces the bottom (large, fast) cloud layer. The top distant-cloud strip stays. |
| Sprite art | Hand-authored pixel bitmaps defined in code, recolourable from the theme. |
| Milestone (optional) | Score 30 → confetti + "Happy 30th!", reusing `canvas-confetti`. |
| Playfield width | **Dynamic**: `worldWidth = canvasWidth / pixelScale`. Difficulty is constant in world units; warning time varies with viewport and is guarded by a minimum playfield width. |
| Prototype boundary | Steps 1–2 only (`runner.ts` + a throwaway debug renderer), to settle the tuning numbers. |

## Why canvas, and not the existing CSS approach

The clouds are pure CSS `translateX(0) → -50%` loops, which is correct for
decoration. It is the wrong tool here: a CSS-animated obstacle's position lives
in the compositor, so collision detection would mean reading transforms back out
every frame. By then we would have rebuilt a worse game loop. One `<canvas>` plus
`requestAnimationFrame` gives full control for the same amount of code.

The existing `image-rendering: pixelated` idiom carries over, and the pixel
aesthetic stays consistent with `public/clouds/*.svg`.

## Module layout

```
src/lib/runner.ts              pure simulation — physics, spawns, collision, scoring
src/lib/runner-sprites.ts      sprite bitmaps + blit helper
src/components/RunnerGame.tsx  React island — canvas, clock, input, lifecycle
src/lib/themes.ts              add `runner` to the Theme type
src/components/Invite.astro    render <RunnerGame client:idle /> when theme.runner
src/pages/events/[eventId].astro  unchanged (themeStyle already flows through)
```

`runner.ts` must have **zero DOM and zero React dependencies**. Its whole surface is:

```ts
type Input = { jump: boolean };                        // one button: no duck

type Game = {
  phase: "idle" | "running" | "dead";
  score: number;
  highScore: number;
  // everything else is private to this module: player, obstacles[], speed,
  // distance, spawn timer, seeded rng
};

type Pose = "idle" | "run" | "dead";                    // no duck pose

type ObstacleKind =
  | "ground-narrow" | "ground-wide" | "ground-cluster"
  | "flying-low" | "flying-mid" | "flying-high";

// Rectangles are top-left + size in world units, matching ctx.fillRect.
type Rect = { x: number; y: number; w: number; h: number };

// The complete read surface available to the renderer. Geometry is part of it, so
// the renderer never recomputes `pixelScale` or rediscovers the world size.
type RenderState = {
  phase: Game["phase"];
  score: number;
  highScore: number;
  pixelScale: number;                         // CSS px per world unit
  worldWidth: number;
  worldHeight: number;
  groundY: number;
  groundOffset: number;                       // scrolled distance, for tiling the ground
  player: Rect & { pose: Pose; frame: number; airborne: boolean };
  obstacles: (Rect & { kind: ObstacleKind; frame: number })[];
};

type Geometry = { bandHeight: number; canvasWidth: number };

// Single source of truth for every number in "Starting constants". Exported so the
// debug page, the harness, and step 2's component read the real values instead of
// keeping copies — hand-copied mirrors are what produced the stale assertions in
// the first prototype round.
export const TUNING: { /* readonly tuning record */ };
export type Tuning = { -readonly [K in keyof typeof TUNING]: number };
export const AIR_TIME: number;              // nominal 2 * |jumpVelocity| / gravity

function createGame(
  opts: Geometry & { highScore?: number; seed?: number; tuning?: Partial<Tuning> },
): Game;
function step(game: Game, dt: number, input: Input): Game;   // pure, no mutation
function start(game: Game): Game;
function restart(game: Game): Game;
function resize(game: Game, geometry: Geometry): Game;       // keeps the run alive
function view(game: Game): RenderState;                      // renderer's only read path
function hitboxes(game: Game): Rect[];                       // collision debug + harness
```

**Renderer contract.** `view(game)` is the renderer's *only* read path. The
component must never reach into `Game` internals — do that and the purity
boundary stops buying anything. `hitboxes()` is collision-debug and harness only:
it is inset by design, so drawing sprites from it produces visibly wrong shapes.
`view()` is called once per rAF frame and may return a reused mutable object; the
renderer must consume it within the frame and not retain it.

Anchoring is resolved inside `view()`: `player.y` is already the top-left of the
current pose's box with the feet planted on `GROUND_Y`, so the renderer never
converts between anchors. It only ever does
`ctx.fillRect(s.x * px, s.y * px, s.w * px, s.h * px)`.

**Determinism.** All randomness comes from `seed`. `runner.ts` must never call
`Math.random()` or `Date.now()`; the component derives the default seed and
passes it in. This is what makes the harness reproducible.

**Death and continuing simulation.** `step` keeps integrating after a collision —
obstacles keep scrolling, and the speed ramp and spawner keep running — so the
harness can observe spawn behaviour across the whole speed range without an
autopilot. Stopping the loop is the component's job in step 2, not the
simulation's.

**Geometry is simulation state.** Obstacles spawn at `worldWidth + spawnMargin`,
so the spawner cannot run without the world size. That is why `createGame` takes
it and why `resize` is a simulation function rather than a renderer concern.

Keeping `step` pure and DOM-free is the difference between a game you can debug
and a game you can only squint at. It also means it can be exercised without a
test framework — see [Verification](#verification).

## Simulation spec

### World geometry

Convention: the world origin is the top-left of the playfield and **y increases
downward**, matching canvas 2D and avoiding sign-flipped gravity. All rectangles
are `{x, y, w, h}` with `(x, y)` the top-left corner. `GROUND_Y` is the ground
line.

Every vertical gameplay quantity — jump apex, obstacle height, flying clearance —
is specified as a **clearance above the ground line** and converted with
`y = GROUND_Y - clearance`. Specifying clearances rather than absolute `y` is what
keeps the numbers meaningful when the band height changes.

Band height is a layout constant (~160–200 CSS px). `pixelScale` is derived from
it, and both terms below are **correctness** constraints, not preferences:

```
pixelScale  = clamp(min(bandHeight  / TARGET_WORLD_HEIGHT,   // never larger: vertical fit
                        canvasWidth / MIN_WORLD_WIDTH),      // never larger: width floor
                    PIXEL_SCALE_MIN, PIXEL_SCALE_MAX)
worldHeight = bandHeight  / pixelScale
worldWidth  = canvasWidth / pixelScale      // dynamic, see Decisions
GROUND_Y    = worldHeight - GROUND_MARGIN
```

Starting values: `TARGET_WORLD_HEIGHT = 95`, `MIN_WORLD_WIDTH = 260`,
`PIXEL_SCALE_MIN = 1.5`, `PIXEL_SCALE_MAX = 3`, `GROUND_MARGIN = 24`.

`GROUND_MARGIN` is the distance from the bottom of the band up to the ground line,
so **raising the ground means increasing it**. It lives in world units and therefore
scales with `pixelScale` automatically.

Both terms are **upper bounds** on `pixelScale`, and taking their `min` is what
makes each one hold:

- **Vertical fit.** `pixelScale <= bandHeight / TARGET_WORLD_HEIGHT` guarantees
  `worldHeight >= TARGET_WORLD_HEIGHT`. The composition needs
  `worldHeight >= playerHeight + apex + GROUND_MARGIN`, which at the floor of 95 and
  a margin of 24 is `22 + 45.02 + 24 = 91.02`.

  This puts a ceiling on how far the ground can be raised:
  **`GROUND_MARGIN <= worldHeight - apex - playerHeight ≈ 27.98`** at the tightest
  geometry, so 24 leaves under **4 units** of nominal headroom (a little over 5 by
  the measured apex, which the integrator undershoots). Past the ceiling the
  player's head leaves the top of the band mid-jump. Assertion 6 in
  [Verification](#verification) guards this, because it is exactly the kind of
  number a later re-tune would push past silently.

  **If the ground needs to go higher, `TARGET_WORLD_HEIGHT` is the only lever** — it
  buys ceiling roughly 1:1. **Do not reach for the band height:** while the height
  term binds, `worldHeight = bandHeight / (bandHeight / TARGET_WORLD_HEIGHT) =
  TARGET_WORLD_HEIGHT`, so band height cancels out entirely, and the tightest case
  is always the floor of 95. Swept and confirmed: `worldHeight` stays exactly 95.000
  for every band height up to 285px. The cost of the real lever is that `pixelScale`
  falls, so sprites shrink and `worldWidth` grows (slightly easier, more warning).
  The remaining levers are art/physics: reduce `playerHeight`, or reduce the apex
  by raising gravity relative to jump velocity.
- **Width floor.** `pixelScale <= canvasWidth / MIN_WORLD_WIDTH` guarantees
  `worldWidth >= MIN_WORLD_WIDTH`, which is what preserves reaction time on a
  phone.

Both constraints cannot hold below `canvasWidth = MIN_WORLD_WIDTH *
PIXEL_SCALE_MIN` (= 390 CSS px with the starting values). Below that, either lower
`PIXEL_SCALE_MIN` to keep the playfield wide, or accept a shorter `tWarn`. That is
an explicit trade, not an oversight. Within the documented band-height range the
absolute `PIXEL_SCALE_*` clamps never bind; they are safety rails for
out-of-range inputs.

Two consequences worth stating plainly, because both are easy to "fix" the wrong
way:

- **There is no wide-screen ceiling.** `pixelScale` cannot rise above
  `bandHeight / TARGET_WORLD_HEIGHT`, so a wide viewport gets a wider playfield
  and therefore *more* warning time — the game is easier on desktop. Do **not**
  raise `pixelScale` to compensate: that shrinks `worldHeight` until the jump
  leaves the band.
- **A `max()` here is a bug.** `max(bandHeight / TARGET_WORLD_HEIGHT,
  canvasWidth / MIN_WORLD_WIDTH)` picks the larger scale, which breaks the width
  floor *and* the vertical fit on wide screens. An earlier revision of this
  document specified exactly that error; the prototype caught it.

**Resize.** Geometry is simulation state, not a renderer concern (see
[Module layout](#module-layout)). Call `resize(game, { bandHeight, canvasWidth })`,
which recomputes `pixelScale` and the world size and **keeps the run alive** —
redraw immediately, do not reset the run.

What is and is not invariant across a resize, since the implementation revealed
this to be narrower than the sentence above first claimed:

- **Horizontal positions, gaps, distance, score, and spawn counters are
  untouched.** Obstacles live in world units, so the window changes and the run
  does not.
- **Vertical positions shift** by `ΔgroundY` so that clearances from the ground
  line are preserved. "Only the visible window changes" is true horizontally
  only.
- **The already-scheduled next spawn is now exactly fairness-invariant**, and this
  is worth understanding because it was not always so. Its gap is solved using
  `travelDistance = worldWidth + spawnMargin − playerX`, so if the band *widens*
  mid-run, that obstacle's arrival distance grows and a gap computed under the old
  geometry can fall short of the constraint. Narrowing was always conservative;
  widening was the hole, masked by the gap jitter. The fix: the state records
  `prevSpawnDistance` plus the jitter factor used for the pending spawn, and
  `resize()` re-solves `nextSpawnDistance` against the new geometry — guarded by
  `nextSpawnDistance > distance`, since an obstacle already in flight must not be
  moved. Assertion 5b covers a mid-run widening; assertion 5 alone only checks
  invariance at fixed geometry and would not have caught this.

### Units and scaling

All simulation happens in **world units** where one unit is one sprite pixel of a
22-unit-tall player. Rendering multiplies by `pixelScale` (CSS px per unit) at
blit time, and nowhere else. Screen size therefore changes the picture; it never
changes the jump arc.

`pixelScale` is derived by the formula above, not chosen by hand, and is tunable
only through the five constants listed with it.

### Frame independence

`step(game, dt, input)` integrates with `dt` in seconds, driven by a fixed-step
accumulator (~1/120 s) inside the island's rAF loop. Never assume 60 fps: a 144 Hz
monitor or a background tab must not change the physics.

### Starting constants

Starting values. Those marked *pinned* were unspecified in the first revision of
this document and were chosen by the prototype:

| Constant | Value | Notes |
| --- | --- | --- |
| Player height | 22 units | Reference for everything else |
| Player width | 16 units | *Pinned.* The sprite example above is 16 columns wide. |
| Player x (spawn) | 8 units | *Pinned.* Bounds the warning constraint: `(MIN_WORLD_WIDTH - playerX - playerWidth) / maxSpeed >= reactionBudget + airTime` forces `playerX <= 31.2` at the round-1 constants. |
| Gravity | 1384 units/s² | Round 1: raised together with jump velocity to cut hang time at constant apex. |
| Jump velocity | -353 units/s | Round 1: `v' = v/k`, `g' = g/k²` with `k = 0.85`. Apex stays ~45 units. |
| Start speed | ~90 units/s | |
| Max speed | 280 units/s | Round 1: up from 260 (+7.7%). Ceiling imposed by the warning constraint is ~310 u/s at round-1 airtime. |
| Speed ramp | 0.05 units/s per unit | *Pinned.* Reaches max speed at 3800 units of travel. |
| Spawn margin | 8 units | *Pinned.* Obstacles spawn at `worldWidth + spawnMargin`. |
| Score | `floor(distance / 10)` | Arcade convention |
| Player hitbox inset | ~20% per side | See below |
| Nominal `airTime` | 0.5101 s | `2·\|jumpVelocity\|/gravity`. The semi-implicit integrator yields 0.5000 s, so the constraint is slightly conservative. |

**Tuning round 1** cut hang time at roughly constant apex by scaling velocity and
gravity together. Watch the direction, because it is easy to get backwards:
`airTime = 2v/g`, so cutting airtime by `k` needs the **reciprocal** — `v' = v/k`
and `g' = g/k²`. The naive `v' = k·v, g' = g/k²` *increases* hang time by `1/k`,
the opposite of the intent. Apex is `v²/(2g)` and is unchanged either way.

Vertical fit is guaranteed by the geometry formula rather than by a band-height
check: `worldHeight >= 95` and the tallest composition needs 71 units.

### Spawn algorithm and fairness constraints

Obstacles spawn at `worldWidth + spawnMargin` and travel left at the current
speed. Gaps are sampled as `gap = minGap * uniform(1, GAP_JITTER_MAX)` with
`GAP_JITTER_MAX ≈ 2`. Three constraints decide whether that random gap is fair —
the naive single inequality is not enough on its own.

**1. Spacing.** The player needs a full jump arc between consecutive obstacles,
so the gap must account for the obstacle's own width:

```
minGap >= speedAtArrival * airTime + obstacleWidth
```

**2. Sample the speed at arrival, not at spawn.** Speed ramps with distance, so a
gap that is fair when it is created is *not* automatically fair when the player
reaches it: by then the speed is higher and the time between obstacles is shorter.
The arrival speed depends on the whole travel from the spawn point to the player,
**not** on the gap alone. Solving over `gap / speed` under-estimates the arrival
speed and therefore the required gap — in the unsafe direction.

Because the ramp is linear in distance, the constraint is a linear equation in
`gap` and is solved exactly rather than iterated:

```
gap >= speedAtDistance(distanceAtPreviousSpawn + travelDistance + gap) * airTime
       + obstacleWidth

// with speedAtDistance(d) = min(maxSpeed, startSpeed + ramp * d), and
// denom = 1 - ramp * airTime  (> 0), this rearranges to:
gap >= ((startSpeed + ramp * (distanceAtPreviousSpawn + travelDistance)) * airTime
        + obstacleWidth) / denom
```

The result is then capped at `maxSpeed * airTime + obstacleWidth`, the value it
approaches once the ramp saturates. Note the `gap` on both sides of the original
inequality: that self-reference is exactly what the naive `gap / speed` form
drops.

**3. Warning time.** Independently of spacing, the player must *see* the obstacle
in time to react:

```
tWarn = (worldWidth - playerX - playerWidth) / speed
tWarn >= reactionBudget + airTime          // reactionBudget ≈ 0.25 s
```

Check this at max speed on the narrowest playfield the `MIN_WORLD_WIDTH` term
permits. This is the constraint the dynamic-width decision leans on, and it is an
acceptance criterion for the prototype rather than a runtime check.

Obstacle clusters count as one spawn carrying the cluster's full width, so
`obstacleWidth` is never a per-unit width.

### Obstacles

Sizes below are **clearances above the ground line** (see
[World geometry](#world-geometry)) and they are *derived* from the hitbox numbers
rather than chosen independently. If player height, the inset, or the jump arc
changes, recompute all of them from the inequalities below.

Hitbox reference, all that is needed now that there is no duck pose: the standing
box spans clearances **4.4–17.6** units, and at the apex the feet reach ~45 units,
so the hitbox bottom reaches **49.4**. Both follow from a 22-unit player and a 20%
per-side inset.

With jump as the only move there are exactly two viable classes, and every
obstacle kind must fall into one of them:

- **must jump** ⇔ `bottomClearance < 17.6` (the standing box collides) **and**
  `topClearance < 49.4` (the box clears at apex)
- **run under** ⇔ `bottomClearance > 17.6`

| Obstacle | Occupies (clearance) | Width | Required solution | Derivation |
| --- | --- | --- | --- | --- |
| Ground, narrow | 0–10 | 4 | jump | top well under the apex |
| Ground, wide | 0–16 | 10 | jump | still under the apex |
| Ground, cluster | 0–16 | 3 per block, 1–3 blocks | jump | width is handled by the spacing rule |
| Flying, low | 4–18 | 6 | jump | `4 < 17.6` and `18 < 49.4` — easy tier |
| Flying, mid | 12–26 | 6 | jump | `12 < 17.6` and `26 < 49.4` — tightest must-jump tier |
| Flying, high | 28–42 | 6 | run under | `28 > 17.6` |

Widths were *pinned* by the prototype; the clearances are derived as described
above.

The three flying heights are difficulty **tiers of the same required action**, not
different actions: low and mid both require a jump, with mid demanding the tighter
timing window (9 frames before contact versus 6 at the round-1 constants). High is
the only kind that needs no input. The harness checks this per kind rather than
only for the tallest and widest variant.

At `airTime ≈ 0.51 s` a jump covers ~46 units of ground at start speed and ~143
units at max speed. That is the reference for how wide a cluster the spacing rule
will permit.

**Ground line.** A tiled dash/pebble strip — the only scrolling element in the
idle state, and even that is frozen while idle.

### Collision

AABB with deliberately shrunken boxes (~20% inset per side). The original game is
famously forgiving here, and players read pixel-perfect boxes as broken rather
than hard.

## Rendering

- Canvas backing store = CSS size × `min(devicePixelRatio, 2)`.
- Game math in world units, converted at blit time (see above).
- Sprites blitted as batched rects: one `beginPath()`, a `rect()` per filled
  pixel, one `fill()`. Cheaper than N `fillRect()` calls and keeps the pixel grid
  crisp.
- **Score is drawn on the canvas**, arcade style (`HI 00000  00012`), **top-left**,
  and **not drawn at all during `idle`** — there is no score until the player has
  started a game, and it stays up through `running` and `dead` so the final score is
  readable. Gating on the phase from `view(game)` keeps it out of React state.
  This matters: it means zero React re-renders during play. React state is only
  used for phase transitions that change DOM (hint text, game-over overlay).
- High score persists in `localStorage` under `runner:hi:<eventId>`, wrapped in
  `try/catch` (private browsing throws). A number only — no user data.
- Optional inverted-palette phase at score milestones is **off by default**: it
  flips to a dark background and fights both the white page and the contrast
  rules in [Accessibility](#accessibility).
- **The ground is filled, not just a line.** Raising `GROUND_MARGIN` lifts the
  ground line, and a bare dash strip floating there would leave dead white space
  beneath it. The band from `groundY` down to the bottom of the band is filled
  with `theme.runner.ground` at `globalAlpha = 0.22` (≈ `#ecebe9` over the white
  hero), with the dash strip drawn at full opacity along the top edge. That alpha
  is an unmeasured feel knob and the single place to adjust the fill's weight.
  Keep it muted, or it eats the hero text's contrast on short screens.

## Sprites

Bitmaps are arrays of strings in `runner-sprites.ts`, `#` = fill, anything else =
transparent:

```ts
export const PLAYER_RUN_1 = [
  "....#####.......",
  "....#....#......",
  ...
];
```

Recolour by drawing with `fillStyle = theme.runner.color` — one bitmap serves
every theme. Required frames:

| Sprite | Frames |
| --- | --- |
| Player idle | 1 |
| Player run | 2 |
| Player dead | 1 |
| Ground obstacle small / large / cluster | 1 each (cluster = repeats) |
| Flying obstacle | 2 (wing up / wing down) |
| Ground dashes | 1 (tiled) |

**Prototype with placeholder rects.** Ship the first working version with a plain
square for the player and rectangles for obstacles so the jump feel and spawn
fairness can be tuned before any art exists. Keep the blit interface stable so
swapping in real bitmaps is a no-op for callers.

Do not copy the original game's sprite assets. Hand-authored bitmaps keep the art
original, themeable per event, and reviewable in a diff.

## Interaction and input

This is where the "don't break RSVP" requirement is won or lost.

### Focus scoping, not window listeners

A window-level `keydown` listener would swallow space inside the RSVP form's
inputs — someone typing their name gets a jumping character. Instead:

- The game region is a **focusable** element with an accessible name and the
  offscreen control instructions. The spec originally said `tabindex="0"`; in
  practice the region carries `role="application"` (plain `aria-label` is invalid
  on a generic focusable `div`) and the server emits `tabindex="-1"`, upgraded to
  `0` on hydration, because the reduced-motion decision is only knowable in the
  browser. That leaves a short post-load window, and a JS-disabled case, where the
  region is not a tab stop.
- Keys are handled on that element's own `keydown`, so the RSVP form is
  untouched *by construction* rather than by a growing blocklist.
- Space / ArrowUp / `W` → jump, Space / Enter → restart when dead. There is one
  game input and no second action, so the handler has exactly one mapping.

Note: `<section class="hero">` is not focusable by default, so "while the hero is
focused" needs a real focusable region to mean anything. That region is the game
band.

### Tab order

Tab order follows DOM order. The hero content currently renders after the cloud
layers, so if the game element were placed first it would take the **first** tab
stop, ahead of the RSVP link. Render the game element **last in DOM order** and
position it with `absolute bottom-0 z-0`. Explicit `z-index` means paint order is
independent of DOM order, so we get the right tab order and the right stacking.

### Tap-to-play without breaking scroll or links

Listening for taps on the hero section (`data-hero` attribute, resolved by the
island via `closest("[data-hero]")`), with these guards:

1. Ignore events whose target is inside an interactive element (`a`, `button`,
   `input`, `select`, `textarea`, `[contenteditable]`). Tapping the "RSVP by…"
   link must navigate.
2. Distinguish a tap from a drag: `pointerdown` → `pointerup` with < 10 px of
   movement and < 300 ms duration. This is what lets a phone user scroll the
   hero without the player jumping on every touch.
3. No `touch-action: none` on the hero — that would trap scrolling. We add
   nothing, or `touch-action: manipulation` at most.
4. `preventDefault()` only while a game is actually in the `running` phase.

### Autoplay is off

Nothing animates and no rAF loop runs until the visitor chooses to play. This is
both the requested behaviour and the reason the page stays cheap.

## Hero and layout integration

- Delete the bottom `hero-clouds` (large/fast) block, its `animate-cloud-scroll-fast`
  usage, and the now-dead `.hero-clouds + .hero-clouds .hero-cloud-*` rules. That
  sibling-combinator selector depends on the two cloud divs being adjacent
  siblings, so it becomes dead CSS the moment a third layer enters the hero —
  remove it rather than leaving a trap.
- The game occupies a bottom band (`clamp(160px, 22svh, 200px)` as implemented,
  hidden below a ~640px viewport height). The hero content block gains bottom
  padding so text never collides with the player on a short screen, and the
  padding resets when the band is hidden.
- Game sits at `z-0`, `.hero-content` stays `z-10`.
- Colour: render in the same muted tone family as the clouds (`#d6d3d1`-ish) from
  `theme.runner.color`, not a bold dark silhouette.

### Hero composition and below-the-fold details

The hero holds the invitation, not the logistics: eyebrow, title, and subtitle
centred, with the game band pinned to the bottom of the viewport. The `<hr>`, the
date / time / location block, and the "RSVP by …" link are extracted into
`EventDetails.astro` and rendered **either** inside the hero **or** in their own
section between the hero and `#rsvp`, selected by `detailsBelowFold`.

This is opt-in per theme because it changes what a visitor sees before scrolling,
and it applies to `game-night-light` only. `default`, `game-night`, and `birthday`
render the details inside the hero exactly as before.

### The play prompt

A visible prompt sits **below the subtitle**: `Click / Space / Tap to Play`. It
lives in the hero content rather than the canvas band, because that is where the
eye already is, and the band's own space is needed for the game.

It is hidden while a run is in flight by pure CSS off the hero's existing
`data-running` attribute — `[data-running] .play-prompt { display: none }` — so
starting a run does not re-render the island. It is also hidden under
`prefers-reduced-motion`, where play is never offered.

The band keeps its own **contextual** game-over line (`Game over — press space to
retry`), which belongs near the action. The idle string that used to live there is
gone; the same message is not shown twice.

**Known wart:** `data-running` is only set while `running`, so the hero prompt
reappears during `dead` alongside the band's game-over line. Hiding it in `dead` too
would need a phase attribute rather than a boolean one.

### Two consequences of the layout split

- **The hero loses its scroll cue.** The "RSVP by …" link with its bouncing
  chevrons was the only thing signalling that more content existed below. In the
  `detailsBelowFold` layout nothing in the hero says so, beyond the play prompt. It
  is a deliberate trade, not an oversight.
- The title/subtitle spacing overrides that exist for the pixel themes were sized
  for a stacked block that has since moved out, so that gap needed re-checking by
  eye rather than being left to the old values.

## Sky parallax

Cloud and star layers translate in proportion to how far the player has run, which
gives the sky depth against the ground scrolling in the canvas. Horizontally only —
jumping does not move the sky.

### Two nested transforms, and why

Each layer is an **outer** element plus an **inner** strip, and which of the two
carries a CSS ambient drift differs by layer family:

```
.hero-sky-layer[data-parallax="<rate>"]   /* CSS ambient drift (clouds only) */
  .hero-sky-strip[data-parallax-strip]     /* JS transform, one section modulo */
    .hero-sky-section × SKY_COPIES         /* identical copies */
```

- **Clouds** drift ambiently in CSS *and* take the player-driven offset.
- **Stars** have **no ambient motion at all**. They are completely stationary until
  the player moves, and their only positional change is the player-driven offset.
  Keep the twinkle — it is an opacity pulse in place, not motion, so it does not
  conflict with "stationary".

The split is load-bearing. Cloud ambient drift stays a **CSS** animation because
clouds must keep drifting while the game is idle, and while idle there is
deliberately **no rAF loop running**. Moving it into JS would freeze the clouds for
every visitor who never plays. Stars need no such mechanism, which is why they lose
the CSS animation entirely rather than merely being slowed down — a slow drift is
still motion.

### Wrap period and copy count

The strip is divided into identical sections, and the wrap period is **exactly one
section width**. Where a layer has both a CSS drift and a JS offset, the nested
transforms **add**, so their combined shift can reach two sections rather than one.
That is what forces **three** copies (`SKY_COPIES = 3`, each `flex: 1 0 33.3333%`):
with only two, the far edge of the viewport goes blank whenever the ambient drift
and the player offset overlap near their maxima. Verified in the DOM at the worst
case (ambient ~99% plus player ~99%) rather than assumed.

Stars are the weaker case — with no ambient drift their shift never exceeds one
section, so two copies would do — but the constant is deliberately shared at 3 for
all layers. **Do not "optimise" the cloud layer down to two.**

### Cloud count

The cloud layer renders **4 clouds per section**, down from 7. Because the sections
must stay byte-identical for the wrap to be seamless, the pattern repeats exactly,
and fewer clouds makes that repetition more visible: the four clouds cluster in the
left ~58% of each section, leaving a ~585px cloudless run every hero-width. At max
speed the combined ambient-plus-player travel is ~182px/s, so the identical clump
recurs roughly every 7s. This is the accepted trade for a lighter sky, not a bug —
but it is the reason the repetition is noticeable, and varying the sections would
break the wrap rather than fix it.

### Star colour and the origin speck

Stars are painted with `currentColor` in both their `box-shadow` specks and their
fill, so the colour comes from `color: var(--star-color)` on the star rules.
`--star-color` is set on the hero from `theme.stars.color`. This was **dead for a
while**: the variable was set but never consumed, so the stars silently painted
hero text (`#1c1917`) instead of the configured `#44403c`. If star colour ever
looks wrong, check that the layers still read `color`, not a hardcoded value.

The `.hero-stars-*` elements are the **origin** of the speck field — the scattered
specks are box-shadow offsets, and the element's own border box used to paint one
more solid speck at the top-left of every section. Because the field is now a
3-copy strip the island translates, that origin speck slid along the hero's top
edge for the whole of a run, reading as a stray dot rather than a star. Dropping
the element's own `background` removes it: outer box-shadow is not painted inside
the border box, so the origin disappears and the scattered specks are untouched.
Measured as an exact 16-pixel difference at `(0,0)–(3,3)` with zero pixels added
elsewhere.

### Driving the offset

- Source: `view(game).groundOffset`, which is world distance.
- Convert to CSS px via `pixelScale`, or parallax speed will not match on-screen
  world speed.
- Accumulate **incrementally** from the frame delta, not from the absolute
  `groundOffset`: `pixelScale` changes on resize, and an absolute recomputation makes
  every layer jump at that moment.
- Advances only while `phase === "running"`, so it holds on death and resumes on the
  next run.
- **Restart pauses and resumes; it must not snap.** A restart zeroes `groundOffset`,
  so the next delta would be a large *negative* value and yank every layer
  backwards. Re-point the stored previous offset at the new `groundOffset` while
  **keeping** the accumulated offsets. Zeroing the offsets — the obvious fix —
  instead snaps the sky back to the section origin, which is the most visible thing
  the stars ever do now that they have no ambient motion of their own.
- The transform is cleared entirely at offset 0 rather than written as
  `translateX(0px)`, so an idle star layer genuinely has no transform.
- Reduced motion gets no parallax at all.
- Rates come from the markup so each layer owns its depth: 4px stars `0.10`, 2px
  stars `0.05`, clouds `0.30` (larger and nearer moves faster). The clouds' ambient
  drift is `90s`; stars have none.

### The cloud seam bug this had to fix

`@keyframes cloud-scroll` animated `translateX(0 → -50%)` while being applied to
`.hero-clouds`, which is `inset-x-0` and therefore only **100% of the hero** wide.
One section is also 100% of the hero, so a seamless loop needs a full section of
travel; `-50%` moved half a section and then snapped back, giving the ambient drift
a visible seam every cycle. The keyframe had been written as if it applied to the
strip's width. It now ends at `-100%`.

The general lesson for this file: **percentages in a transform resolve against the
transformed element's own width**, so keyframes and the element they run on have to
agree about which box is being measured.

## Theme wiring

Add to the `Theme` type in `src/lib/themes.ts`:

```ts
runner: {
  color: string;        // sprite + ground line
  ground: string;       // optional, defaults to color
  celebrateAt?: number; // optional milestone
  celebrationMessage?: string;
} | null;

detailsBelowFold: boolean;   // required: true renders EventDetails after the hero
```

`detailsBelowFold` is `true` only on `game-night-light`.

Set it on `game-night-light` (and leave `null` on `default`, `game-night`, and
`birthday`). `Invite.astro` renders `{theme.runner && <RunnerGame client:idle … />}`.
`client:idle` keeps the game off the critical path — it must not compete with
first paint or LCP.

The optional milestone lives in the theme, not the event frontmatter, so it needs
no `content.config.ts` schema change. Score 30 + "Happy 30th!" is coupled to this
event, which is acceptable because `game-night-light` is this event's theme.

## Accessibility

- Canvas is decorative-with-a-name: `aria-hidden` is **not** valid on a
  focusable element, so the focusable region carries a real accessible name and
  offscreen instructions instead.
- The invite's information is fully present in the DOM text. The game is never
  the only route to anything.
- **`prefers-reduced-motion: reduce`**: render the idle scene and do not offer
  play at all — no rAF, no hint text, no extra tab stop. This falls out for free
  because idle is already a static single draw.
- Contrast: `#1c1917` body text must keep its ratio over the sprite colour.
  Verify the muted grey against white before picking it.
- The game region is keyboard-operable, and the band is **autofocused on load**
  (see below). An earlier revision gave it a visible focus indicator, but because the
  band is full-width and flush with the bottom of the viewport, only the ring's **top
  edge** ever rendered somewhere visible — a dashed line floating above the game area
  that read as a rendering glitch. It was **deliberately removed** in favour of no
  indicator at all, with `outline-none` retained so the browser default ring does not
  appear in its place. Pressing Space visibly starts the game, so a keyboard user
  still gets feedback from the game itself. This is a knowing departure from the
  usual "focus must be visible" rule — if the band's position or size ever changes,
  revisit it.
- **Focus is taken on load, and that is load-bearing rather than cosmetic.** Space is
  the only button, and Space with nothing focused is the browser's page-down — so an
  unfocused band means Space scrolls instead of playing. The band is therefore
  focused on mount when the game is interactive, **with `preventScroll: true`** so the
  viewport does not move, and only when the band has layout and nothing else already
  holds focus. The hero's tap-to-play path focuses it too; without that, tapping to
  start would leave focus on the body and the very next Space would both fail to jump
  and scroll the page. Under reduced motion there is no autofocus and no tab stop.

  Two consequences, both deliberate:
  - It **supersedes the earlier "tab order reaches the RSVP link before the game
    region" requirement.** DOM order is unchanged — the game region is still last —
    but initial focus now lands on the band, and the RSVP link is reached forward
    with Tab.
  - The region is `role="group"`, **not** `role="application"`. `application`
    promises assistive tech that keyboard input is being handed over, and since the
    region is now focused automatically on load, that would drop a screen-reader user
    into application mode before they read a word of the invitation — backwards for a
    page whose primary content is the invite and whose game is optional. `group`
    still permits the accessible name and `aria-describedby`, and the key handling
    depends on focus plus `preventDefault`, not on application semantics. The honest
    cost: a screen-reader user in browse mode may find Space scrolls until they switch
    modes. Biome's `a11y/useSemanticElements` wants `<fieldset>` for `role="group"`,
    which is form semantics and wrong here, hence one inline `biome-ignore` with that
    reason.

## Performance and lifecycle

- Idle = **one draw call**, no rAF. The loop starts on `start()` and stops on
  death.
- Pause on `document.visibilitychange` and when the hero leaves the viewport
  (`IntersectionObserver`, threshold 0). A rAF loop running while someone fills
  out the RSVP form is pure waste.
- On resume after pause, clamp `dt` so a long pause cannot teleport obstacles
  through the player.
- DPR capped at 2. Redraw on `resize` (debounced) and on the idle frame.
- No React re-render per frame — see [Rendering](#rendering).

## Implementation order

1. `src/lib/runner.ts` — pure sim with placeholder rects; tune jump arc and the
   spawn and fairness constraints by hand.
2. `RunnerGame.tsx` — canvas sizing/DPR, single idle draw, start on space/tap, rAF
   loop, pause handling.
3. Wire `theme.runner`, `Invite.astro`, and the `data-hero` attribute; delete the
   bottom cloud layer and its dead CSS.
4. Swap placeholder rects for real bitmaps in `runner-sprites.ts`.
5. Focusable region, offscreen instructions, reduced-motion branch, contrast pass.
6. Optional: score-30 confetti milestone.
7. `npm run lint` and a `astro build`.

## Prototype boundary

The prototype is **steps 1–2 only**: `runner.ts` plus a throwaway debug renderer.
No theme wiring, no `Invite.astro` changes, no sprite art, no a11y polish, no
milestone. Its whole purpose is to settle the numbers in this spec — jump arc,
spawn rhythm, and the three fairness constraints — by hand.

`view()` is needed only far enough to draw debug rectangles, but it is specified
in full above so the seam is frozen before implementation starts. Getting it wrong
now is cheap; getting it wrong at step 4 means reshaping the module after the
component depends on it.

**Known divergences between this spec and the implementation**, recorded rather
than hidden:

- `resize()` is now **implemented** and keeps the run alive, with the caveats
  noted under [World geometry](#world-geometry).
- `createGame`'s geometry arguments are optional in the code (defaulting to
  `bandHeight 190`, `canvasWidth 640`); the spec above treats them as required.
- The geometry formula was corrected after the prototype found the `max()` bug.
  The code matches the corrected `min()` form, and the assertions guard the
  breakpoint where the width floor stops holding.
- The throwaway debug page was **deleted**; it sat in `src/pages` under
  `output: "server"` and would have shipped. The assertions now live in
  `scripts/verify-runner.ts`, run with
  `node --experimental-strip-types scripts/verify-runner.ts` (non-zero exit on
  failure), and derive from `TUNING` rather than copies.
- `public/clouds/cloud-large.svg` and `public/favicon.svg` were both unreferenced
  and are **deleted**. (`Layout.astro` uses inline data-URI icons, so nothing
  referenced the favicon file; it also tripped `a11y/noSvgWithoutTitle`.)
- `npx astro check` is clean (0 errors, 0 warnings, 0 hints) and
  `npx biome check .` passes, after adding `@types/canvas-confetti` and enabling
  `css.parser.tailwindDirectives`. The repo-wide Biome pass also reformatted
  unrelated files, including `cloud-small.svg` (26 rects before and after — pure
  whitespace churn).
- Sprites are still placeholder rectangles; step 4 is unbuilt.
- `SKY_COPIES = 3`, shared by all layers. Only the cloud layer strictly needs 3
  (its ambient and player-driven shifts add and can reach two sections); stars
  carry the player offset only and would be safe with 2. Keep 3 — see
  [Sky parallax](#sky-parallax).
- The star speck field is still `vw`/`vh` box-shadow offsets inside a section that
  is currently exactly viewport width. Periodicity holds only while the hero is at
  least as wide as the viewport; a narrower hero would need the specks re-expressed
  relative to the section.
- **`will-change` is gated, not always on.** `.hero-sky-strip` carries no static
  hint; `[data-running] .hero-sky-strip { will-change: transform }` applies only
  while a run is in flight, and the component sets/removes `data-running` on the
  hero with the phase. Measured with CDP `LayerTree` at 800×800: idle went from 46
  layers (7 promoted) to **27 with 1**; during a run it is 45 with all 7 promoted.
  Dropping `will-change` outright is **not** equivalent — with the JS-written
  transform but no hint, Chrome promoted none of the six star strips during play,
  so that shortcut trades idle cost for lost play-time compositing.
- The star layers were restructured into the periodic multi-copy form for **every**
  theme that declares `stars`, which includes `game-night`. It no longer gains any
  motion (stars have no ambient drift), so the only difference there is structural.
  No live page is affected: only `30th-bday` and `first-bday` have content, and
  `game-night` is unreferenced.
- The ground fill's `globalAlpha = 0.22` is an unmeasured guess, since no browser
  was available to check contrast against the hero text.
- `TUNING`, `Tuning`, and `AIR_TIME` are exported, and `createGame` accepts
`tuning?: Partial<Tuning>`. This is a deliberate addition to the surface described
above: it lets the debug page and harness read real values instead of hand-copied
mirrors. The spawner must recompute airtime from the *active* tuning rather than
the module default, or per-run overrides would silently break the gap guarantee.
- Duck is gone as of tuning round 1; the implementation follows the jump-only
input model specified above.

## Verification

There is no test runner in this repo, so:

- **Pure sim**: runnable standalone under Node ≥ 22.12 with
  `node --experimental-strip-types` against a scratch script that drives `step`
  with a scripted input sequence. No new dependency, and this is the payoff for
  keeping `runner.ts` DOM-free. Assert:
  - **Purity**: the same seed plus the same input sequence produces an identical
    state hash, and `step` never mutates the `game` it is given.
  - **Spacing**: across ≥10,000 generated spawns spanning the full speed range,
    `gap >= speedAtArrival * airTime + obstacleWidth`.
  - **Warning**: at max speed, `tWarn >= reactionBudget + airTime` on the
    narrowest playfield `MIN_WORLD_WIDTH` permits.
  - **Clearability, per obstacle kind**: every kind is viable. For each must-jump
    kind, a *latest clearing jump frame* exists, is strictly before the first
    contact frame, and jumping one frame later collides; for each run-under kind,
    the player survives on no input at all.

    "The last frame before contact" is **not** the literal `contactFrame - 1`: the
    inset hitbox starts 4.4 units above the ground while ground obstacles are
    10–16 units tall, so a jump needs several frames of rise before the boxes
    would overlap at all. The two readings differ and the literal one is
    unsatisfiable; use the definition above.
  - **Resize**: the run survives a geometry change — distance, score, phase,
    obstacle `x`, and ground clearances are unchanged, and the run keeps
    progressing.
  - **Resize widening keeps the pending spawn fair**: widen the band between two
    spawns and assert the pending gap still satisfies
    `gap >= speedAtArrival * airTime + obstacleWidth`, keeping the jitter factor.
    This is the case assertion 5 cannot see, because it holds geometry fixed.
  - **Vertical fit at the tightest geometry**: sweep the band-height clamp and a
    spread of widths, take the smallest `worldHeight`, and assert
    `groundMargin <= worldHeight - apex - playerHeight` plus that the sprite top at
    apex stays inside the band. **Measure the apex in that geometry** rather than
    using the nominal value — the integrator undershoots it (43.56 vs 45.02 units),
    so the nominal bound is the conservative one and the measured one has ~1.5
    units more headroom. The sweep must widen if the band clamp ever changes, or it
    could miss a new tightest case.

  Assertions and reported numbers must be **derived from `TUNING`**, never
  hand-copied. A hardcoded airtime in the harness is the bug class that produced
  the stale `MIN_WORLD_WIDTH` narrative, and a stale airtime makes the spacing
  assertion stricter than the spawner actually guarantees.
- **No autopilot required**: an "autopilot" that plays the game unattended is
  deliberately not needed — it is roughly as hard to write as the game itself, and
  the assertions above cover the same risk deterministically.
- **Parallax and sky**, which the Node harness cannot reach because they live in the
  component: verify in a real page rather than by reading code.
  - Idle: star layers have `animation-name: none` and no transform; the cloud layer
    still has its `90s` drift. This is the check that would have caught the star
    drift being left in place.
  - Death: sample the strip transforms at death and again ~500ms later; they must be
    identical, i.e. frozen.
  - Restart: the accumulated offsets must be **continuous** across the transition
    (no snap in either direction) and then resume at the normal per-frame rate.
    Watch the *deltas*, not the absolute values.
- **`astro check`** for types, **`npm run lint`** for the Biome rules
  (`recommended` + organize-imports), and **`astro build`**.

Manual checklist (applies from step 3 onward, once the game is wired into the
hero):

- [ ] Typing a name and toggling party size in the RSVP form never moves the player.
- [ ] On load the band holds focus and Space neither scrolls nor jumps the viewport.
      (This supersedes the older "tab order reaches the RSVP link first" check — DOM
      order still puts the game last, but initial focus is the band by design.)
- [ ] Blur the band by clicking the page background, then click the hero: focus
      returns to the band and Space jumps rather than scrolling.
- [ ] Tapping the "RSVP by…" hero link navigates and does not start the game.
- [ ] On a phone, scrolling through the hero does not trigger a jump.
- [ ] With reduced motion emulated, the hero is a static pixel scene with no play
      prompt, no autofocus, no tab stop, and no way to start the game.
- [ ] Scrolling to the RSVP form stops the rAF loop.
- [ ] No obstacle is ever unclearable at max speed.
- [ ] Hero text stays readable over the sprites.
- [ ] The play prompt sits under the subtitle, is legible, and disappears once a run
      starts.
- [ ] No score is drawn before the first play; it appears at the top-left after
      starting and remains through the game-over state.
- [ ] The ground fill reads as ground rather than a grey slab, and the dash strip is
      still distinguishable against it.
- [ ] The raised ground does not make the playfield feel cramped above the line.
- [ ] Idle: stars are completely still; clouds still drift slowly.
- [ ] Death and restart: the sky holds position and resumes smoothly, with no snap.

## Non-goals

No backend, no leaderboard, no sound, no mobile-specific controls, no inverted
palette, no changes to OG image generation, `.ics` output, or the RSVP API.
