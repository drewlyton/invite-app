/**
 * Hand-authored pixel art for the hero runner.
 *
 * A sprite is a `Bitmap`: an array of equal-length strings, one string per
 * pixel row. Each character is a palette key; `.` — or any character that is
 * not a key in the palette — is transparent. The bitmaps are authored at the
 * simulation's own scale, so a player bitmap is exactly
 * `PLAYER_SPRITE_WIDTH` x `PLAYER_SPRITE_HEIGHT` and blits 1:1 onto the
 * player's world box with no anchoring maths.
 *
 * This module is data plus one blit helper. It has no DOM dependency: the only
 * reference to `CanvasRenderingContext2D` is type-only, so the file can be
 * imported by Node (see `scripts/verify-sprites.ts`) without a canvas.
 *
 * Colours are chosen so the character reads on the white `game-night-light`
 * hero: black curly hair and beard, light freckled skin, black square glasses
 * with pale lenses, a blue shirt that is clearly distinct from the muted grey
 * obstacle colour (`#d6d3d1`), and an amber board.
 */

import type { Pose } from "./runner";

export type Bitmap = readonly string[];

/** Every player bitmap is authored at the simulation's player box size. */
export const PLAYER_SPRITE_WIDTH = 16;
export const PLAYER_SPRITE_HEIGHT = 22;

/**
 * Character key -> CSS colour. Keys are semantic (hair, skin, board) rather
 * than literal so a re-colour is a one-line change and the bitmaps stay
 * readable. `o` is the darkest tone: an outline where an edge needs it, and
 * the "dead" X eyes.
 */
export const PLAYER_PALETTE: Readonly<Record<string, string>> = {
	o: "#0c0a09", // outline / dead eyes
	h: "#1c1917", // black curly hair and beard
	s: "#f0c8a0", // skin
	f: "#cf9b72", // freckle (subtle: a shade darker than skin)
	g: "#27272a", // glasses frame (charcoal, just off the hair black)
	l: "#bfe3f5", // glasses lens
	c: "#2563eb", // clothing (blue shirt; distinct from the grey obstacles)
	p: "#1e3a8a", // pants (dark denim)
	e: "#57534e", // shoe
	b: "#f59e0b", // board deck
	w: "#292524", // wheel
	W: "#a8a29e", // wheel highlight (spin frame)
};

// --- bitmaps ---------------------------------------------------------------
//
// Layout convention, shared by every pose: the sprite's bottom row is the
// ground contact. `idle` stands the character directly on it with the board
// held vertically beside the right leg (columns 13-14). `push`, `ride` and
// `jump` move the board to the bottom of the box, so the character sits a
// little higher within it. `dead` slumps the character onto the ground.

/**
 * The head, shared by every upright pose: black curly hair (the second row
 * flares wider than the first to read as curls), a freckled face, square black
 * glasses with pale lenses, and a short black beard. Eight rows; the caller
 * places the neck row beneath it.
 */
const HEAD: readonly string[] = [
	"...hh.hhh.hh....",
	"..hhhhhhhhhhh...",
	"...hhssssshh....",
	"...hgggggggh....",
	"...hgllgllgh....",
	"...hgggggggh....",
	"...hsfsssfsh....",
	"...hhhhhhhhh....",
];

/** Idle, settled. Neutral stance, board held vertically at the right leg. */
const IDLE_0: Bitmap = [
	...HEAD,
	"......sss.......",
	"....ccccccc.....",
	"...ccccccccc....",
	"...cccccccccbbb.",
	"...ccccccccc.bb.",
	"...cccccccccsbbw",
	"....ccccccc..bb.",
	"....ppppppp..bb.",
	"....ppp.ppp..bb.",
	"....ppp.ppp..bb.",
	"....ppp.ppp..bbW",
	"....ppp.ppp..bb.",
	"...eeee.eeeebbb.",
	"...eeee.eeee....",
];

/** Idle, bobbed down. Upper body sags one pixel; feet stay planted. */
const IDLE_1: Bitmap = [
	"................",
	...HEAD,
	"......sss.......",
	"....ccccccc.....",
	"...cccccccccbbb.",
	"...ccccccccc.bb.",
	"...ccccccccc.bb.",
	"...cccccccccsbbw",
	"....ppppppp..bb.",
	"....ppp.ppp..bb.",
	"....ppp.ppp..bb.",
	"....ppp.ppp..bbW",
	"....ppp.ppp..bb.",
	"...eeee.eeeebbb.",
	"...eeee.eeee....",
];

/** Push, foot planted. Board rolling; back foot down behind the board. */
const PUSH_0: Bitmap = [
	...HEAD,
	"......sss.......",
	"....ccccccc.....",
	"..cccccccccc....",
	"..cccccccccc....",
	"..cccccccccc....",
	"..cccccccccc....",
	"...pppppppp.....",
	"..ppp....ppp....",
	"..pp......ppp...",
	".pp.......ppp...",
	".pp.......eee...",
	".pp.bbbbbbbbb...",
	".pp.bbbbbbbbb...",
	"eee..ww....ww...",
];

/** Push, foot lifted. Back foot swings up; wheel highlight spun. */
const PUSH_1: Bitmap = [
	...HEAD,
	"......sss.......",
	"....ccccccc.....",
	"..cccccccccc....",
	"..cccccccccc....",
	"..cccccccccc....",
	"..cccccccccc....",
	"...pppppppp.....",
	"..ppp....ppp....",
	"..pp......ppp...",
	".pp.......ppp...",
	".pp.......eee...",
	".pp.bbbbbbbbb...",
	"eee.bbbbbbbbb...",
	".....Ww....wW...",
];

/** Ride, wheels at rest. Both feet on the board, board on the ground. */
const RIDE_0: Bitmap = [
	...HEAD,
	"......sss.......",
	"....ccccccc.....",
	"...ccccccccc....",
	"...ccccccccc....",
	"...ccccccccc....",
	"....ccccccc.....",
	"....ppppppp.....",
	"....ppp.ppp.....",
	"....ppp.ppp.....",
	"....ppp.ppp.....",
	"...eeee.eeee....",
	".bbbbbbbbbbbbb..",
	".bbbbbbbbbbbbb..",
	"...ww....ww.....",
];

/** Ride, wheels spun. Same stance; the highlight moves around the wheel. */
const RIDE_1: Bitmap = [
	...HEAD,
	"......sss.......",
	"....ccccccc.....",
	"...ccccccccc....",
	"...ccccccccc....",
	"...ccccccccc....",
	"....ccccccc.....",
	"....ppppppp.....",
	"....ppp.ppp.....",
	"....ppp.ppp.....",
	"....ppp.ppp.....",
	"...eeee.eeee....",
	".bbbbbbbbbbbbb..",
	".bbbbbbbbbbbbb..",
	"...Ww....wW.....",
];

/** Jump. Airborne, knees tucked, board kicked up under the feet. */
const JUMP_0: Bitmap = [
	...HEAD,
	"......sss.......",
	"..cccccccccc....",
	".cccccccccccc...",
	"..cccccccccc....",
	"...cccccccc.....",
	"...pppppppp.....",
	"..pppp..pppp....",
	"..ee......ee....",
	"..bbbbbbbbbbbb..",
	"..bbbbbbbbbbbb..",
	"...ww......ww...",
	"................",
	"................",
	"................",
];

/** Dead. Crashed: seated on the ground, dark eyes, board upright beside. */
const DEAD_0: Bitmap = [
	"................",
	"................",
	"................",
	"................",
	"................",
	"................",
	"................",
	"................",
	"................",
	"...hhhhhhh......",
	"..hhhhhhhhh.....",
	"..hhssssshh.....",
	"..hgggggggh.....",
	"..hgoogoogh.....",
	"..hsssssssh.....",
	"..hhhhhhhhh.....",
	"...ssssss.......",
	"..cccccccccc.bb.",
	"..cccccccccc.bb.",
	".ppppppppppp.bbW",
	"ppp......ppppbb.",
	"eee.......ee.bb.",
];

/**
 * Every pose's frames. Animated poses cycle two frames; `jump` and `dead` hold
 * a single frame. The simulation indexes this by `player.frame % frames.length`.
 */
export const PLAYER_SPRITES: Readonly<Record<Pose, readonly Bitmap[]>> = {
	idle: [IDLE_0, IDLE_1],
	push: [PUSH_0, PUSH_1],
	ride: [RIDE_0, RIDE_1],
	jump: [JUMP_0],
	dead: [DEAD_0],
};

/**
 * Structural guard, run once at import. A wrong-sized bitmap would silently
 * mis-anchor the player (the box is fixed at 16x22 and the blit assumes 1:1),
 * so fail loudly instead of drawing a sheared character.
 */
function assertBitmapSizes(): void {
	for (const [pose, frames] of Object.entries(PLAYER_SPRITES)) {
		frames.forEach((bitmap, index) => {
			if (bitmap.length !== PLAYER_SPRITE_HEIGHT) {
				throw new Error(
					`runner-sprites: ${pose}[${index}] has ${bitmap.length} rows, expected ${PLAYER_SPRITE_HEIGHT}`,
				);
			}
			bitmap.forEach((row, y) => {
				if (row.length !== PLAYER_SPRITE_WIDTH) {
					throw new Error(
						`runner-sprites: ${pose}[${index}] row ${y} has ${row.length} columns, expected ${PLAYER_SPRITE_WIDTH}`,
					);
				}
			});
		});
	}
}
assertBitmapSizes();

/**
 * Blit a bitmap to the canvas as batched rects.
 *
 * `x`/`y` are the bitmap's top-left in world units and `px` is CSS px per
 * world unit, so the caller passes `s.player.x`, `s.player.y` and `pixelScale`
 * unchanged. Cells are grouped by colour first and each colour is drawn with a
 * single `beginPath()` / `rect()`-per-cell / `fill()`, matching the ground
 * texture's idiom: one rasterisation per colour instead of one per pixel.
 * Transparent cells (any key missing from `palette`) are skipped.
 */
export function drawBitmap(
	ctx: CanvasRenderingContext2D,
	bitmap: Bitmap,
	palette: Record<string, string>,
	x: number,
	y: number,
	px: number,
): void {
	const groups = new Map<string, { x: number; y: number }[]>();
	for (let row = 0; row < bitmap.length; row++) {
		const line = bitmap[row];
		for (let col = 0; col < line.length; col++) {
			const colour = palette[line[col]];
			if (colour === undefined) continue;
			let cells = groups.get(colour);
			if (cells === undefined) {
				cells = [];
				groups.set(colour, cells);
			}
			cells.push({ x: col, y: row });
		}
	}
	for (const [colour, cells] of groups) {
		ctx.fillStyle = colour;
		ctx.beginPath();
		for (const cell of cells) {
			ctx.rect((x + cell.x) * px, (y + cell.y) * px, px, px);
		}
		ctx.fill();
	}
}
