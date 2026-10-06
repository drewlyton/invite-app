/**
 * Visual preview for the hero runner's player frames.
 *
 *   node --experimental-strip-types scripts/preview-sprites.ts [out.png]
 *
 * Renders every pose/frame URL from src/lib/runner-sprites.ts as it exists on
 * disk — the cut, transparent, native-resolution PNGs — one row per pose, so a
 * human or agent can see the art the game actually loads. Default output is
 * `/tmp/runner-sprites.png` so nothing lands in the repo. The machine-checkable
 * invariants live in `scripts/verify-sprites.ts`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import type { Pose } from "../src/lib/runner.ts";
import {
	PLAYER_FRAMES,
	PLAYER_SPRITE_HEIGHT,
	PLAYER_SPRITE_WIDTH,
} from "../src/lib/runner-sprites.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const POSES: readonly Pose[] = ["idle", "push", "ride", "jump", "dead"];
const ROW_H = 150;
const GAP = 18;
const PAD = 16;
const LABEL_H = 30;
const ROW_LABEL_W = 70;

type Cell = { pose: Pose; index: number; href: string; w: number; h: number };

const cells: Cell[] = [];
for (const pose of POSES) {
	for (const [index, url] of (PLAYER_FRAMES[pose] ?? []).entries()) {
		const file = path.join(ROOT, "public", url);
		const meta = await sharp(file).metadata();
		const w = meta.width ?? 0;
		const h = meta.height ?? 0;
		cells.push({
			pose,
			index,
			href: `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`,
			w,
			h,
		});
	}
}

const rowWidth = (pose: Pose): number => {
	const row = cells.filter((c) => c.pose === pose);
	const widths = row.map((c) => (c.w / c.h) * ROW_H);
	return widths.reduce((a, b) => a + b + GAP, 0) - GAP;
};
const contentW = Math.max(...POSES.map(rowWidth));
const width = Math.round(PAD * 2 + ROW_LABEL_W + contentW);
const rowStride = ROW_H + LABEL_H + GAP;
const height = Math.round(PAD * 2 + POSES.length * rowStride - GAP);

const parts: string[] = [
	`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
	`<rect width="${width}" height="${height}" fill="#ffffff"/>`,
];

POSES.forEach((pose, row) => {
	const y = PAD + row * rowStride;
	parts.push(
		`<text x="${PAD}" y="${y + ROW_H / 2}" font-family="monospace" font-size="18" fill="#1c1917">${pose}</text>`,
	);
	let x = PAD + ROW_LABEL_W;
	for (const cell of cells.filter((c) => c.pose === pose)) {
		const w = (cell.w / cell.h) * ROW_H;
		parts.push(
			`<rect x="${x}" y="${y}" width="${w}" height="${ROW_H}" fill="#fafafa" stroke="#e5e5e5"/>`,
			`<image xlink:href="${cell.href}" x="${x}" y="${y}" width="${w}" height="${ROW_H}" preserveAspectRatio="xMidYMid meet"/>`,
			`<text x="${x + w / 2}" y="${y + ROW_H + 20}" text-anchor="middle" font-family="monospace" font-size="14" fill="#57534e">${pose}[${cell.index}] ${cell.w}x${cell.h}</text>`,
		);
		x += w + GAP;
	}
});
parts.push("</svg>");

const out = process.argv[2] ?? "/tmp/runner-sprites.png";
const resvg = new Resvg(parts.join(""), {
	fitTo: { mode: "width", value: width },
});
fs.writeFileSync(out, resvg.render().asPng());
console.log(
	`wrote ${out} (${width}x${height}, ${cells.length} frames; on-screen box ${PLAYER_SPRITE_WIDTH}x${PLAYER_SPRITE_HEIGHT} world units)`,
);
