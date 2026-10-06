/**
 * Build the hero runner's player art from the source sprite sheet.
 *
 *   node --experimental-strip-types scripts/build-sprites.ts
 *
 * Source: `src/assets/runner/skateboard-sheet.jpg` — one AI-generated sheet with
 * two caption rows: "SKATEBOARD IDLE & HOLDING" (two idle frames and two
 * board-holding frames) and "SKATEBOARD / JUMP / MOVEMENT" (a crouch, an
 * airborne frame and two riding frames). This script:
 *
 *   1. removes the sheet's light-grey background with a flood fill seeded from
 *      the image border, so interior light pixels (glasses lenses, highlights)
 *      survive;
 *   2. finds the frames by geometry — sprite-height row bands, then the
 *      non-empty column runs inside each band — so no frame coordinates are
 *      hard-coded;
 *   3. writes each frame to `public/runner/player/<pose>-<n>.png` as a trimmed,
 *      transparent PNG **at the sheet's own resolution**: the sprite art is not
 *      downsampled. The game draws these images into the player's 16x22 world
 *      box at blit time (`drawPlayerFrame` in `runner-sprites.ts`);
 *   4. splices the `PLAYER_FRAMES` URL manifest into `src/lib/runner-sprites.ts`
 *      between the `generated:start/end` markers.
 *
 * `POSE_FRAMES` is the pose -> sheet-frame mapping. The sheet supplies both
 * idle frames, a push pair (board held in front, then the crouched push-off),
 * the jump, both ride frames and one spare standing frame used for `dead`; the
 * sheet has no crash art.
 *
 * Re-run after editing the sheet; the module's helpers and docs are untouched.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHEET_PATH = path.join(ROOT, "src/assets/runner/skateboard-sheet.jpg");
const FRAMES_DIR = path.join(ROOT, "public/runner/player");
const SPRITES_TS = path.join(ROOT, "src/lib/runner-sprites.ts");

/** Background test: near-white and near-neutral. */
const BG_MIN_LUMA = 200;
const BG_MAX_CHROMA = 18;
/** Row bands shorter than this are caption text, not sprites. */
const MIN_BAND_HEIGHT = 100;
/** The expected frame count; a sheet change that alters it should fail loudly. */
const EXPECTED_FRAMES = 8;

/**
 * Pose -> sheet frames, in reading order. The sheet's top row is the idle bob
 * pair followed by two board-holding frames; the bottom row is the crouch, the
 * jump and the two ride frames. `push` uses the held board then the crouched
 * push-off so the intro narrates stand -> step on -> ride; the spare standing
 * frame stands in for the absent crash art.
 */
const POSE_FRAMES: Readonly<Record<string, readonly number[]>> = {
	idle: [0, 1],
	push: [3, 4],
	ride: [6, 7],
	jump: [5],
	dead: [2],
};

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
if (frames.length !== EXPECTED_FRAMES) {
	throw new Error(
		`build-sprites: expected ${EXPECTED_FRAMES} frames on the sheet, detected ${frames.length}. ` +
			"If the sheet changed, check MIN_BAND_HEIGHT and the caption rows.",
	);
}

// --- extraction -------------------------------------------------------------

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

fs.mkdirSync(FRAMES_DIR, { recursive: true });

/** pose -> frame URL list, built as the files are written. */
const manifest: Record<string, string[]> = {};
for (const [pose, indices] of Object.entries(POSE_FRAMES)) {
	manifest[pose] = [];
	for (const [n, index] of indices.entries()) {
		const box = frames[index];
		const name = `${pose}-${n}.png`;
		const url = `/runner/player/${name}`;
		await sharp(cropRGBA(box), {
			raw: {
				width: box.x1 - box.x0 + 1,
				height: box.y1 - box.y0 + 1,
				channels: 4,
			},
		})
			// Palette-quantised: the art is a single greyscale ramp, so 64 colours
			// hold it at a fraction of the full RGBA size. Resolution is untouched.
			.png({ compressionLevel: 9, palette: true, colors: 64 })
			.toFile(path.join(FRAMES_DIR, name));
		manifest[pose].push(url);
	}
}

// --- splice into the module -------------------------------------------------

function urlList(urls: string[]): string {
	return urls.map((url) => `"${url}"`).join(", ");
}

const block = [
	"// --- generated:start ---",
	"// Generated by scripts/build-sprites.ts from",
	"// src/assets/runner/skateboard-sheet.jpg. Do not edit by hand; edit the",
	"// sheet or the generator and re-run it.",
	"",
	"export const PLAYER_FRAMES: Readonly<Record<Pose, readonly string[]>> = {",
	...Object.entries(manifest).map(
		([pose, urls]) => `\t${pose}: [${urlList(urls)}],`,
	),
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

const total = Object.values(manifest).reduce((n, urls) => n + urls.length, 0);
console.log(
	`build-sprites: ${frames.length} frames detected, ${total} native-resolution PNGs ` +
		`written to ${path.relative(ROOT, FRAMES_DIR)}, ${Object.keys(manifest).length} poses ` +
		`spliced into ${path.relative(ROOT, SPRITES_TS)}.`,
);
