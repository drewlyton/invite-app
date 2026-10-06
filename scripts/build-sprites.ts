/**
 * Build the hero runner's player art from the source sprite sheet.
 *
 *   node --experimental-strip-types scripts/build-sprites.ts
 *
 * Source: `src/assets/runner/skateboard-sheet.jpg` — one AI-generated sheet with
 * two caption rows: "SKATEBOARD IDLE" (two standing frames, board held) and
 * "SKATEBOARD / JUMP / MOVEMENT" (a crouch, an airborne frame, and two riding
 * frames). This script:
 *
 *   1. removes the sheet's light-grey background with a flood fill seeded from
 *      the image border, so interior light pixels (glasses lenses, highlights)
 *      survive;
 *   2. finds the frames by geometry — sprite-height row bands, then the
 *      non-empty column runs inside each band — so no frame coordinates are
 *      hard-coded;
 *   3. writes each cut frame as a trimmed, transparent PNG to
 *      `src/assets/runner/frames/` (palette-quantised — the art is a single
 *      greyscale ramp, so 64 colours are lossless enough at a third the size);
 *   4. downsamples every frame to the simulation's 16x22 player box, quantising
 *      onto the module palette, and splices the resulting `Bitmap` literals into
 *      `src/lib/runner-sprites.ts` between the `generated:start/end` markers.
 *
 * The sheet supplies six frames. Two poses the game needs are not on it and are
 * derived here rather than left blank:
 *
 *   - `push[1]`: the crouch frame with the rider's upper body sagged one pixel
 *     (one row), the board planted. The same one-pixel bob the idle pose uses.
 *   - `dead[0]`: a hand-authored crashed frame in the module palette (seated,
 *     light lenses, board upright). The sheet has no crash art.
 *
 * Re-run after editing the sheet; the module's helpers and docs are untouched.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHEET_PATH = path.join(ROOT, "src/assets/runner/skateboard-sheet.jpg");
const FRAMES_DIR = path.join(ROOT, "src/assets/runner/frames");
const SPRITES_TS = path.join(ROOT, "src/lib/runner-sprites.ts");

/** The simulation's player box; every generated bitmap is exactly this size. */
const PLAYER_W = 16;
const PLAYER_H = 22;

/** Background test: near-white and near-neutral. */
const BG_MIN_LUMA = 200;
const BG_MAX_CHROMA = 18;
/** Row bands shorter than this are caption text, not sprites. */
const MIN_BAND_HEIGHT = 100;
/** Downsampled cells below this alpha (0-255) stay transparent. */
const ALPHA_CUTOFF = 110;

/**
 * Palette the art quantises onto: the site's existing stone ramp, darkest
 * first. Keys are ramp positions, not parts, because the sheet is a single warm
 * greyscale figure. Keep in sync with the generated block's `PLAYER_PALETTE`.
 */
const PALETTE: ReadonlyArray<readonly [string, string]> = [
	["o", "#1c1917"], // darkest: outline, hair, board
	["d", "#44403c"], // dark: hair body, pants, board top
	["m", "#78716c"], // mid: jacket
	["s", "#a8a29e"], // soft: skin, face
	["l", "#d6d3d1"], // light: highlights, glasses lenses
];

/**
 * The crashed `dead` frame, hand-authored because the sheet has none. Seated on
 * the ground with the board upright beside it, matching the pose the animation
 * contract expects. 16x22, palette keys only.
 */
const DEAD: readonly string[] = [
	"................",
	"................",
	"................",
	"................",
	"................",
	"................",
	"................",
	"................",
	"................",
	"...ddddddd......",
	"..ddddddddd.....",
	"..ddsssssdd.....",
	"..doooooood.....",
	"..dollollod.....",
	"..dsssssssd.....",
	"..ddddddddd.....",
	"...ssssss.......",
	"..mmmmmmmmmm.dd.",
	"..mmmmmmmmmm.dd.",
	".ddddddddddd.ddl",
	"ddd......dddddd.",
	"ooo.......oo.dd.",
];

const PALETTE_RGB = PALETTE.map(([key, hex]) => {
	const n = Number.parseInt(hex.slice(1), 16);
	return { key, r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
});

type Box = { x0: number; y0: number; x1: number; y1: number };

// --- source raster + background mask ---------------------------------------

const { data, info } = await sharp(SHEET_PATH)
	.removeAlpha()
	.raw()
	.toBuffer({ resolveWithObject: true });
const SW = info.width;
const SH = info.height;
const C = info.channels;

const pixel = (x: number, y: number): [number, number, number] => {
	const i = (y * SW + x) * C;
	return [data[i], data[i + 1], data[i + 2]];
};

const isBackground = (r: number, g: number, b: number): boolean => {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	return max > BG_MIN_LUMA && max - min < BG_MAX_CHROMA;
};

/**
 * Flood-fill the light background from the border. Seeding from the edges (not
 * thresholding every pixel) is what keeps light pixels *inside* the character —
 * glasses lenses, jacket highlights — opaque.
 */
const isBg = new Uint8Array(SW * SH);
{
	const stack: number[] = [];
	for (let x = 0; x < SW; x++) stack.push(x, (SH - 1) * SW + x);
	for (let y = 0; y < SH; y++) stack.push(y * SW, y * SW + SW - 1);
	while (stack.length > 0) {
		const index = stack.pop() as number;
		if (index < 0 || index >= SW * SH || isBg[index]) continue;
		const [r, g, b] = pixel(index % SW, Math.floor(index / SW));
		if (!isBackground(r, g, b)) continue;
		isBg[index] = 1;
		const x = index % SW;
		if (x > 0) stack.push(index - 1);
		if (x < SW - 1) stack.push(index + 1);
		stack.push(index - SW, index + SW);
	}
}

// --- frame detection --------------------------------------------------------

/** Non-empty row bands (caption rows included; filtered by height). */
function detectBands(): [number, number][] {
	const bands: [number, number][] = [];
	let start = -1;
	for (let y = 0; y <= SH; y++) {
		let filled = 0;
		if (y < SH) {
			for (let x = 0; x < SW; x++) filled += isBg[y * SW + x] ? 0 : 1;
		}
		const on = filled > 0;
		if (on && start === -1) start = y;
		if (!on && start !== -1) {
			if (y - start >= MIN_BAND_HEIGHT) bands.push([start, y - 1]);
			start = -1;
		}
	}
	return bands;
}

/** Non-empty column runs within a row band, as tight boxes. */
function detectFrames(band: [number, number]): Box[] {
	const [top, bottom] = band;
	const boxes: Box[] = [];
	let start = -1;
	for (let x = 0; x <= SW; x++) {
		let filled = 0;
		if (x < SW) {
			for (let y = top; y <= bottom; y++) filled += isBg[y * SW + x] ? 0 : 1;
		}
		const on = filled > 0;
		if (on && start === -1) start = x;
		if (!on && start !== -1) {
			// Tighten vertically to this run's own content.
			let y0 = top;
			let y1 = bottom;
			while (y0 < y1 && !rowHasContent(y0, start, x - 1)) y0++;
			while (y1 > y0 && !rowHasContent(y1, start, x - 1)) y1--;
			boxes.push({ x0: start, y0, x1: x - 1, y1 });
			start = -1;
		}
	}
	return boxes;
}

function rowHasContent(y: number, x0: number, x1: number): boolean {
	for (let x = x0; x <= x1; x++) if (!isBg[y * SW + x]) return true;
	return false;
}

const frames: Box[] = detectBands().flatMap(detectFrames);
if (frames.length !== 6) {
	throw new Error(
		`build-sprites: expected 6 frames on the sheet, detected ${frames.length}. ` +
			"If the sheet changed, check MIN_BAND_HEIGHT and the caption rows.",
	);
}

// Reading order: idle-0, idle-1, push-0, jump-0, ride-0, ride-1.
const NAMES = [
	"idle-0",
	"idle-1",
	"push-0",
	"jump-0",
	"ride-0",
	"ride-1",
] as const;

// --- extraction, downsampling, quantisation --------------------------------

/** Copy a box out of the full-resolution sheet into a standalone RGBA buffer. */
function cropRGBA(box: Box): Buffer {
	const w = box.x1 - box.x0 + 1;
	const h = box.y1 - box.y0 + 1;
	const out = Buffer.alloc(w * h * 4);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const s = (box.y0 + y) * SW + box.x0 + x;
			const [r, g, b] = pixel(box.x0 + x, box.y0 + y);
			const o = (y * w + x) * 4;
			out[o] = r;
			out[o + 1] = g;
			out[o + 2] = b;
			out[o + 3] = isBg[s] ? 0 : 255;
		}
	}
	return out;
}

async function toBitmap(
	rgba: Buffer,
	width: number,
	height: number,
): Promise<string[]> {
	const scaled = await sharp(rgba, { raw: { width, height, channels: 4 } })
		.resize({
			width: PLAYER_W,
			height: PLAYER_H,
			fit: "contain",
			position: "south",
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.raw()
		.toBuffer();
	return quantise(scaled);
}

function quantise(rgba: Buffer): string[] {
	const rows: string[] = [];
	for (let y = 0; y < PLAYER_H; y++) {
		let row = "";
		for (let x = 0; x < PLAYER_W; x++) {
			const o = (y * PLAYER_W + x) * 4;
			if (rgba[o + 3] < ALPHA_CUTOFF) {
				row += ".";
				continue;
			}
			let best = PALETTE_RGB[0];
			let bestDistance = Number.POSITIVE_INFINITY;
			for (const entry of PALETTE_RGB) {
				const d =
					(rgba[o] - entry.r) ** 2 +
					(rgba[o + 1] - entry.g) ** 2 +
					(rgba[o + 2] - entry.b) ** 2;
				if (d < bestDistance) {
					bestDistance = d;
					best = entry;
				}
			}
			row += best.key;
		}
		rows.push(row);
	}
	return rows;
}

fs.mkdirSync(FRAMES_DIR, { recursive: true });

const source: Record<string, string[]> = {};
for (let i = 0; i < frames.length; i++) {
	const box = frames[i];
	const rgba = cropRGBA(box);
	const name = NAMES[i];
	await sharp(rgba, {
		raw: {
			width: box.x1 - box.x0 + 1,
			height: box.y1 - box.y0 + 1,
			channels: 4,
		},
	})
		.png({ compressionLevel: 9, palette: true, colors: 64 })
		.toFile(path.join(FRAMES_DIR, `${name}.png`));
	source[name] = await toBitmap(rgba, box.x1 - box.x0 + 1, box.y1 - box.y0 + 1);
}

/** Sag the rider's upper body one row, board planted. */
function bob(bitmap: string[], split: number): string[] {
	const out: string[] = [];
	out.push(".".repeat(PLAYER_W));
	for (let y = 1; y < PLAYER_H; y++) {
		out.push(y <= split ? bitmap[y - 1] : bitmap[y]);
	}
	return out;
}

const sprites: Record<string, string[][]> = {
	idle: [source["idle-0"], source["idle-1"]],
	push: [source["push-0"], bob(source["push-0"], 16)],
	ride: [source["ride-0"], source["ride-1"]],
	jump: [source["jump-0"]],
	dead: [[...DEAD]],
};

// --- splice into the module -------------------------------------------------

function literal(name: string, bitmaps: string[][]): string {
	const framesText = bitmaps
		.map((bitmap) => {
			const rows = bitmap.map((row) => `\t\t\t"${row}",`).join("\n");
			return `\t\t[\n${rows}\n\t\t],`;
		})
		.join("\n");
	return `\t${name}: [\n${framesText}\n\t],`;
}

const block = [
	"// --- generated:start ---",
	"// Generated by scripts/build-sprites.ts from",
	"// src/assets/runner/skateboard-sheet.jpg. Do not edit by hand; edit the",
	"// sheet or the generator and re-run it.",
	"",
	"export const PLAYER_PALETTE: Readonly<Record<string, string>> = {",
	...PALETTE.map(([key, hex]) => `\t${key}: "${hex}",`),
	"};",
	"",
	"export const PLAYER_SPRITES: Readonly<Record<Pose, readonly Bitmap[]>> = {",
	literal("idle", sprites.idle),
	literal("push", sprites.push),
	literal("ride", sprites.ride),
	literal("jump", sprites.jump),
	literal("dead", sprites.dead),
	"};",
	"// --- generated:end ---",
].join("\n");

const module = fs.readFileSync(SPRITES_TS, "utf8");
const START = "// --- generated:start ---";
const END = "// --- generated:end ---";
const from = module.indexOf(START);
const to = module.indexOf(END);
if (from === -1 || to === -1) {
	throw new Error(
		`build-sprites: ${path.relative(ROOT, SPRITES_TS)} is missing the generated markers.`,
	);
}
const next = `${module.slice(0, from)}${block}${module.slice(to + END.length)}`;
fs.writeFileSync(SPRITES_TS, next);

// --- report -----------------------------------------------------------------

for (const [pose, frames] of Object.entries(sprites)) {
	for (const [i, bitmap] of frames.entries()) {
		if (
			bitmap.length !== PLAYER_H ||
			bitmap.some((r) => r.length !== PLAYER_W)
		) {
			throw new Error(
				`build-sprites: ${pose}[${i}] is not ${PLAYER_W}x${PLAYER_H}`,
			);
		}
	}
}
console.log(
	`build-sprites: 6 frames detected, ${NAMES.length} PNGs written to ` +
		`${path.relative(ROOT, FRAMES_DIR)}, ${Object.values(sprites).flat().length} bitmaps spliced ` +
		`into ${path.relative(ROOT, SPRITES_TS)}.`,
);
