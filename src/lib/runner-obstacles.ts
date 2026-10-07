/**
 * Obstacle art for the hero runner: flickering candles.
 *
 * The simulation's obstacles are still plain rects (`{x, y, w, h}` from
 * `view().obstacles`) and the candle is drawn *at* that rect, never in place of
 * it: the wax body's top is `o.y`, its bottom is `o.y + o.h`, so a ground kind
 * sits exactly on the ground line and a flying kind floats at its clearance.
 * Collision is untouched — the body rect is the collider, and the flame is
 * decorative art *above* it. Nothing here special-cases ground versus flying;
 * drawing at the rect is what makes both read correctly. The wax spans the rect's
 * full height and is centred horizontally within its width; the sub-unit sliver
 * this leaves at some widths is called out below.
 *
 * A unit candle is one body column (`CANDLE_BODY_WIDTH` = 2 world units) plus a
 * one-unit gap (`CANDLE_GAP`) before the next candle, so the pitch is
 * `CANDLE_PITCH = CANDLE_BODY_WIDTH + CANDLE_GAP` = 3. Wide obstacles become a
 * row of unit candles:
 *   count = max(1, floor((o.w + CANDLE_GAP) / CANDLE_PITCH))
 * and the row is centred: `start = (o.w - rowWidth) / 2`, candle `i` at
 * `o.x + start + i * CANDLE_PITCH`. For the widths the spawner produces that is
 * `w=3 -> 1`, `w=4 -> 1`, `w=6 -> 2`, `w=9 -> 3`, `w=10 -> 3`. Body height is
 * `o.h` for every candle. Because every candle keeps the same 2-unit width, a
 * width that is not a multiple of the pitch (`w=4` and `w=10`) leaves at most
 * **1.0 world unit** of the collider undrawn per side (the others 0.5) —
 * deliberately: that sliver is the price of a constant candle width, and the
 * 1-unit gap is what stops adjacent candles from reading as one solid block. The
 * collider itself is still the full rect; only the drawn wax is inset.
 *
 * The flicker is *simulation-driven*, not wall-clock: `runner.ts` advances each
 * obstacle's `frame` modulo `OBSTACLE_FRAME_COUNT` inside `step`, and this module
 * maps that frame to one of `FLAME_VARIANTS`. Within a row each candle is offset
 * `(o.frame + candleIndex) % FLAME_VARIANT_COUNT` so neighbours are out of phase.
 * Because the phase comes from `step`, the flames freeze with the simulation
 * (death, hidden tab, reduced motion) and there is no `performance.now()`.
 *
 * Colour. The module owns the palette, the way the moon SVG and the sprite sheet
 * own theirs; there are no `Theme` fields. Each spawn carries a seeded `tint`
 * (see `OBSTACLE_TINT_COUNT` in `runner.ts`), and within a row the colour is
 * `WAX_COLORS[(o.tint + candleIndex) % WAX_COLORS.length]`: an obstacle is a
 * random wax colour per spawn, while adjacent candles in one row are guaranteed
 * different because consecutive indices step by one. `WAX_COLORS` has exactly
 * `OBSTACLE_TINT_COUNT` entries (the harness asserts it).
 *
 * The wax is two tones, matching the two 1-unit columns the constant 2-unit body
 * shows: the full-width `wax` body mass (the base mixed `0.26` toward white,
 * visible as the left column once the shade edge overlays its right half) and the
 * 1-unit `waxShade` right edge (the base mixed `0.34` toward black). Those mixes
 * are exact formula outputs, not hand-tuned hexes — the tuning was in the base
 * colours, chosen together with the mix ratios until every `wax` tone clears 3:1
 * against the hero sky `#e7e5e4`, which the flying candles float against. The
 * `wax` tone is the binding one (lightening cuts sky contrast); the darker
 * `shade` tone clears it with room to spare. Every visible wax tone clears 3:1
 * against the sky (WCAG relative luminance, the same formula used here), and the
 * two reference background tones are exported (`CANDLE_CONTRAST_SKY` /
 * `CANDLE_CONTRAST_GROUND`) so the harness checks the real colours rather than
 * hand-copied literals:
 *
 *   colour   tone    hex        vs sky   vs ground   note
 *   red      wax     #c75e59    3.23:1   1.62:1      left body column
 *   red      shade   #761914    8.71:1   4.36:1      right edge column
 *   pink     wax     #d25486    3.12:1   1.56:1      worst wax tone vs sky
 *   pink     shade   #80103c    8.13:1   4.07:1
 *   violet   wax     #9156b4    3.99:1   2.00:1
 *   violet   shade   #461266    10.87:1  5.44:1
 *   blue     wax     #4c77b9    3.60:1   1.80:1
 *   blue     shade   #092f6a    10.28:1  5.15:1
 *   green    wax     #56885a    3.30:1   1.65:1
 *   green    shade   #123e15    9.69:1   4.85:1
 *   teal     wax     #42898c    3.22:1   1.61:1
 *   teal     shade   #003f42    9.35:1   4.68:1
 *   wick             #3a2a1a   10.96:1   5.49:1      dark, reads on any wax
 *   flameOuter       #d9481c    3.42:1   1.71:1      flame silhouette
 *   flameMid         #f59d1b    1.72:1   1.16:1      interior, inside the above
 *   flameCore        #ffe9a8    1.04:1   2.09:1      hottest, inside both
 *
 * The flame stays a fixed warm ramp (outer/mid/core) precisely so it contrasts
 * with every wax colour; only its outer tone has to read against the sky, and
 * mid/core sit inside that silhouette and merely add heat, so their low sky
 * contrast is intentional. Every wax tone is also a saturated hue against the
 * neutral grey band (`CANDLE_CONTRAST_GROUND`), so a ground candle's colour is
 * carried by its hue even where the luminance ratio against the ground is modest.
 *
 * This module is pure data plus one blit helper. The only `CanvasRenderingContext2D`
 * reference is type-only, so a Node script can import the layout without a canvas
 * (see `scripts/verify-runner.ts` and `scripts/preview-obstacles.ts`).
 */

import type { ObstacleKind, Rect } from "./runner";

/**
 * Body width of one unit candle, in world units. Constant across every candle —
 * that is what makes a wide obstacle read as a row of identical candles rather
 * than one slab.
 */
export const CANDLE_BODY_WIDTH = 2;

/**
 * Horizontal gap between unit candles in a wide obstacle, in world units. The
 * row leaves this much background between neighbouring bodies so stacked candles
 * do not touch.
 */
export const CANDLE_GAP = 1;

/**
 * Horizontal spacing from one candle's left edge to the next, in world units.
 * Derived, so the gap and the body can never drift apart.
 */
export const CANDLE_PITCH = CANDLE_BODY_WIDTH + CANDLE_GAP;

/**
 * Flame width, in world units. Same as the body, so the flame reads as sitting
 * on the wick rather than hovering beside it, and a pitch of 3 leaves a 1-unit
 * gap between neighbouring flames.
 */
export const FLAME_WIDTH = 2;

/**
 * The two background tones the wax colours are checked against: the hero sky
 * (which the flying candles float against) and the ground band's near tone (which
 * the ground kinds stand on). Exported so `scripts/verify-runner.ts` and
 * `scripts/preview-obstacles.ts` use the real reference colours instead of
 * hand-copied literals.
 */
export const CANDLE_CONTRAST_SKY = "#e7e5e4";
export const CANDLE_CONTRAST_GROUND = "#a6a3a1";

/**
 * The roles a candle is assembled from. A part is one axis-aligned world-unit
 * rect in world units; the two renderers (`drawObstacle` on the canvas, the SVG
 * preview) fill these parts with their resolved `color` and nothing else, which
 * is what keeps the preview honest.
 */
export type CandleRole =
	| "wax"
	| "waxShade"
	| "wick"
	| "flameOuter"
	| "flameMid"
	| "flameCore";

/**
 * One coloured rect of a candle, in world units. `color` is resolved here so the
 * renderers never need a role->colour lookup: wax parts carry the obstacle's
 * tinted palette entry, wick and flame carry `CANDLE_PALETTE`.
 */
export type CandlePart = Rect & { role: CandleRole; color: string };

/**
 * The obstacle rect plus the fields the layout reads from `view().obstacles`.
 * `Rect`'s doc comment ("top-left + size in world units, matching ctx.fillRect")
 * applies unchanged to the rect: it is still the collider. `tint` is the seeded
 * wax colour index (see `OBSTACLE_TINT_COUNT`). The wax spans this rect's full
 * height and is centred horizontally within its width; at `w=4` and `w=10` the
 * constant 2-unit candle width leaves at most 1.0 world unit undrawn per side.
 */
export type ObstacleArt = Rect & {
	kind: ObstacleKind;
	frame: number;
	tint: number;
};

/**
 * The roles that make the candle body, i.e. the parts that must span the collider
 * rect's full height. Exported so `scripts/verify-runner.ts` can assert the
 * property without a hand-copied role list.
 */
export const CANDLE_BODY_ROLES: readonly CandleRole[] = ["wax", "waxShade"];

/**
 * One wax colour: a full-width `wax` mass and a `shade` right-edge column. The
 * two tones are exact mixes of a chosen base — `wax` is the base `0.26` toward
 * white and `shade` is the base `0.34` toward black (see the contrast table in
 * the module header). The tuning was in the base choices, not in tweaking the
 * mixed hexes. Every visible tone clears 3:1 against the sky.
 */
export type WaxColor = {
	name: string;
	wax: string;
	shade: string;
};

/**
 * The wax palette. Its length must equal `OBSTACLE_TINT_COUNT` in `runner.ts`;
 * `scripts/verify-runner.ts` asserts that, so a new tint count cannot silently
 * index past the end. Order matters for the per-candle offset: consecutive
 * entries must be different colours, which is what guarantees adjacent candles
 * in a row never match. Red, pink and violet are deliberately separated from
 * blue, green and teal so neighbours also differ in hue, not just in value.
 */
export const WAX_COLORS: readonly WaxColor[] = [
	{ name: "red", wax: "#c75e59", shade: "#761914" },
	{ name: "pink", wax: "#d25486", shade: "#80103c" },
	{ name: "violet", wax: "#9156b4", shade: "#461266" },
	{ name: "blue", wax: "#4c77b9", shade: "#092f6a" },
	{ name: "green", wax: "#56885a", shade: "#123e15" },
	{ name: "teal", wax: "#42898c", shade: "#003f42" },
];

/**
 * The roles whose colour is fixed rather than tinted: the dark wick and the warm
 * flame ramp. Exported so the preview and the harness can colour a fixed part
 * without reaching into the layout.
 */
export type CandleFixedRole = "wick" | "flameOuter" | "flameMid" | "flameCore";

/** Fixed colours: the wick and the warm flame ramp, from the header table. */
export const CANDLE_PALETTE: Readonly<Record<CandleFixedRole, string>> = {
	wick: "#3a2a1a",
	flameOuter: "#d9481c",
	flameMid: "#f59d1b",
	flameCore: "#ffe9a8",
};

/**
 * One flame shape. All variants share the same family — a 2-unit-wide base, a
 * 1-unit-wide shoulder and tip, and the same three tones — and differ only in how
 * tall the flame is and which of the body's two columns the tip leans into.
 */
export type FlameVariant = {
	/** Flame height above the body top, in world units. */
	height: number;
	/** Horizontal lean of the tip, in world units: -1, 0 or 1. */
	lean: -1 | 0 | 1;
};

/**
 * The flame cycle. Its length is asserted to equal `OBSTACLE_FRAME_COUNT`: the
 * simulation's obstacle `frame` indexes straight into this list, so the two
 * cannot drift. Heights stay within 2 units (4, 5, 6, 5) — variations of one
 * flame, not different flames — and the leans keep the tips moving.
 */
export const FLAME_VARIANTS: readonly FlameVariant[] = [
	{ height: 4, lean: 0 },
	{ height: 5, lean: 1 },
	{ height: 6, lean: 0 },
	{ height: 5, lean: -1 },
];

/** Length of the flame cycle, so callers need not reach for `.length`. */
export const FLAME_VARIANT_COUNT = FLAME_VARIANTS.length;

/** Clamp a tint to an index into `WAX_COLORS`, tolerating out-of-range input. */
function waxColorAt(index: number): WaxColor {
	return WAX_COLORS[
		((index % WAX_COLORS.length) + WAX_COLORS.length) % WAX_COLORS.length
	];
}

/**
 * Break one obstacle into the candle parts that draw it, in world units. Pure
 * and DOM-free: the canvas renderer and the SVG preview both consume this list,
 * so they cannot disagree about what a candle is. The returned parts are already
 * in **back-to-front paint order** (body mass, then its shade edge, then the wick
 * and the outward-in flame layers), so a renderer only has to fill them in array
 * order — there is no separate order table to keep in sync. The wax spans the
 * obstacle rect's full height and is centred horizontally within its width; the
 * flame is decorative art above `o.y`. Each candle's wax colour is
 * `WAX_COLORS[(o.tint + candleIndex) % WAX_COLORS.length]`, so a spawn's tint is
 * constant while a row's neighbours always differ.
 */
export function obstacleCandleParts(o: ObstacleArt): CandlePart[] {
	// `+ CANDLE_GAP` makes a width that is one short of the next pitch still admit
	// the next candle: `w=6 -> 2`, `w=9 -> 3`, `w=10 -> 3`.
	const count = Math.max(1, Math.floor((o.w + CANDLE_GAP) / CANDLE_PITCH));
	const rowWidth = count * CANDLE_BODY_WIDTH + (count - 1) * CANDLE_GAP;
	// Half the leftover, which is at most 1.0 unit per side for the widths the
	// spawner produces (3, 4, 6, 9, 10): the row sits centred and stays inside.
	const start = (o.w - rowWidth) / 2;
	const parts: CandlePart[] = [];
	for (let i = 0; i < count; i++) {
		const left = o.x + start + i * CANDLE_PITCH;
		const variant = FLAME_VARIANTS[(o.frame + i) % FLAME_VARIANT_COUNT];
		const wax = waxColorAt(o.tint + i);

		// Body, back to front: the full-width `wax` mass first, then the 1-unit
		// `waxShade` right-edge column over it. Together they tile the 2-unit body
		// exactly (left column `wax`, right column `shade`), and both span the
		// collider's full height. The row is centred in the rect, so at `w=4`/`w=10`
		// each side leaves at most 1.0 unit undrawn; the collider is the rect
		// regardless, so collision is unchanged.
		parts.push({
			role: "wax",
			x: left,
			y: o.y,
			w: CANDLE_BODY_WIDTH,
			h: o.h,
			color: wax.wax,
		});
		parts.push({
			role: "waxShade",
			x: left + CANDLE_BODY_WIDTH - 1,
			y: o.y,
			w: 1,
			h: o.h,
			color: wax.shade,
		});

		// Wick: a dark 1-unit strip across the top of the body. A 2-wide body cannot
		// centre a 1-wide wick, so the wick is the full body width — symmetric, and
		// inside the body rect, so it never changes the silhouette.
		parts.push({
			role: "wick",
			x: left,
			y: o.y,
			w: CANDLE_BODY_WIDTH,
			h: 1,
			color: CANDLE_PALETTE.wick,
		});

		// Flame: above the collider. A 2-wide base, then a 1-wide shoulder and tip
		// that lean into one of the body's two columns (left for lean <= 0, right for
		// lean > 0), so no part ever leaves the candle's 2-unit footprint and the tip
		// centre track stays inside the obstacle rect. In paint order: the outer
		// silhouette first, then the mid and core layers building inward.
		const { height, lean } = variant;
		const tipX = left + (lean > 0 ? 1 : 0);
		parts.push({
			role: "flameOuter",
			x: left,
			y: o.y - (height - 2),
			w: FLAME_WIDTH,
			h: height - 2,
			color: CANDLE_PALETTE.flameOuter,
		});
		parts.push({
			role: "flameOuter",
			x: tipX,
			y: o.y - (height - 1),
			w: 1,
			h: 1,
			color: CANDLE_PALETTE.flameOuter,
		});
		parts.push({
			role: "flameOuter",
			x: tipX,
			y: o.y - height,
			w: 1,
			h: 1,
			color: CANDLE_PALETTE.flameOuter,
		});
		// Mid and core: the tip's column, brighter toward the base.
		parts.push({
			role: "flameMid",
			x: tipX,
			y: o.y - (height - 2),
			w: 1,
			h: height - 2,
			color: CANDLE_PALETTE.flameMid,
		});
		parts.push({
			role: "flameCore",
			x: tipX,
			y: o.y - 1,
			w: 1,
			h: 1,
			color: CANDLE_PALETTE.flameCore,
		});
	}
	return parts;
}

/**
 * Blit one obstacle's candle. Maps the shared `obstacleCandleParts` layout to one
 * `fillRect` per part, walked in the array's own back-to-front paint order, and
 * multiplies world units by `px` only here, at blit time. Opaque and drawn back to
 * front so the body stays under the shade edge, the wick and the flame. Per-part
 * fill is deliberate: wax colours vary per candle, so there is no single
 * `fillStyle` per role.
 */
export function drawObstacle(
	ctx: CanvasRenderingContext2D,
	o: ObstacleArt,
	px: number,
): void {
	for (const part of obstacleCandleParts(o)) {
		ctx.fillStyle = part.color;
		ctx.fillRect(part.x * px, part.y * px, part.w * px, part.h * px);
	}
}
