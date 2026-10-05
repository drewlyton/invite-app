/**
 * Sprite storage and blitting for the hero runner.
 *
 * A sprite is a `Bitmap`: an array of equal-length strings, one string per
 * pixel row. Each character is a palette key; `.` — or any character that is
 * not a key in the palette — is transparent. Bitmaps are authored at the
 * simulation's own scale, so a player bitmap is exactly
 * `PLAYER_SPRITE_WIDTH` x `PLAYER_SPRITE_HEIGHT` and blits 1:1 onto the
 * player's world box with no anchoring maths.
 *
 * The pose graph, frame counts and blit path are wired end to end (see
 * `runner.ts`'s `Pose`, `RunnerGame.tsx`'s draw loop, and the two scripts
 * below). **The bitmaps themselves are placeholders**: every pose draws the
 * same neutral box, so the infrastructure is complete and the game runs, but no
 * character art exists yet. Replace `PLACEHOLDER` / `PLAYER_SPRITES` with the
 * real art; nothing else here should need to change.
 *
 * `PLAYER_PALETTE` is deliberately a small greyscale ramp drawn from colours
 * the site already uses, so the finished sprite reads as part of the
 * `game-night-light` monochrome hero rather than as a new colour system.
 *
 * This module is data plus one blit helper. It has no DOM dependency: the only
 * reference to `CanvasRenderingContext2D` is type-only, so the file can be
 * imported by Node (see `scripts/verify-sprites.ts`) without a canvas.
 */

import type { Pose } from "./runner";

export type Bitmap = readonly string[];

/** Every player bitmap is authored at the simulation's player box size. */
export const PLAYER_SPRITE_WIDTH = 16;
export const PLAYER_SPRITE_HEIGHT = 22;

/**
 * Palette key -> CSS colour. A three-step greyscale ramp built from colours the
 * page already uses: `o` is the hero's ink, `m` is the ground tone, `l` is the
 * runner/cloud tone. Add keys here if the art needs a fourth step.
 */
export const PLAYER_PALETTE: Readonly<Record<string, string>> = {
	o: "#1c1917", // darkest: outline, hair, eyes, shoes
	m: "#a8a29e", // mid: clothing, shading
	l: "#d6d3d1", // light: skin, highlights
};

/**
 * PLACEHOLDER: a plain hollow box, identical for every pose and frame. It
 * exists only so the wiring, the verifier and the game loop have something
 * valid to draw. Delete it when the real character art lands.
 */
function placeholder(): Bitmap {
	const rows: string[] = [];
	for (let y = 0; y < PLAYER_SPRITE_HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < PLAYER_SPRITE_WIDTH; x++) {
			const onLeft = x === 2;
			const onRight = x === 13;
			const onTop = y === 2;
			const onBottom = y === 19;
			const border = onLeft || onRight || onTop || onBottom;
			const inside = x > 2 && x < 13 && y > 2 && y < 19;
			row += border ? "o" : inside ? "l" : ".";
		}
		rows.push(row);
	}
	return rows;
}

const PLACEHOLDER = placeholder();

/**
 * Every pose's frames. Animated poses cycle two frames; `jump` and `dead` hold
 * a single frame. The simulation indexes this by `player.frame % frames.length`.
 *
 * The frame counts are part of the pose contract (`scripts/verify-sprites.ts`
 * asserts them); only the bitmap contents are placeholders.
 */
export const PLAYER_SPRITES: Readonly<Record<Pose, readonly Bitmap[]>> = {
	idle: [PLACEHOLDER, PLACEHOLDER],
	push: [PLACEHOLDER, PLACEHOLDER],
	ride: [PLACEHOLDER, PLACEHOLDER],
	jump: [PLACEHOLDER],
	dead: [PLACEHOLDER],
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
 * `x`/`y` are the bitmap's top-left in world units and `px` is CSS px per world
 * unit, so the caller passes `s.player.x`, `s.player.y` and `pixelScale`
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
