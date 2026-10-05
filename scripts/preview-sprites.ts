/**
 * Throwaway visual preview for src/lib/runner-sprites.ts.
 *
 *   node --experimental-strip-types scripts/preview-sprites.ts [out.png]
 *
 * Renders every pose/frame at a large integer scale to a single PNG sheet using
 * the already-installed `@resvg/resvg-js`. Default output is
 * `/tmp/runner-sprites.png` so nothing lands in the repo. This exists for the
 * human (or agent) eye — the machine-checkable invariants live in
 * `scripts/verify-sprites.ts`.
 */

import fs from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import type { Pose } from "../src/lib/runner.ts";
import {
	PLAYER_PALETTE,
	PLAYER_SPRITE_HEIGHT,
	PLAYER_SPRITE_WIDTH,
	PLAYER_SPRITES,
} from "../src/lib/runner-sprites.ts";

const SCALE = 14;
const GAP = 16;
const PAD = 16;
const LABEL_H = 34;

const POSES: Pose[] = ["idle", "push", "ride", "jump", "dead"];

// Flatten to a single row of frames so the silhouettes are easy to compare.
const frames: { pose: Pose; index: number; bitmap: readonly string[] }[] = [];
for (const pose of POSES) {
	PLAYER_SPRITES[pose].forEach((bitmap, index) => {
		frames.push({ pose, index, bitmap });
	});
}

const cellW = PLAYER_SPRITE_WIDTH * SCALE;
const cellH = PLAYER_SPRITE_HEIGHT * SCALE;
const width = PAD * 2 + frames.length * cellW + (frames.length - 1) * GAP;
const height = PAD * 2 + cellH + LABEL_H;

const parts: string[] = [];
parts.push(
	`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
);
parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

frames.forEach((frame, i) => {
	const originX = PAD + i * (cellW + GAP);
	const originY = PAD;

	// Cell background and a subtle checker so transparent pixels are visible.
	parts.push(
		`<rect x="${originX}" y="${originY}" width="${cellW}" height="${cellH}" fill="#fafafa" stroke="#d4d4d4" stroke-width="1"/>`,
	);
	for (let row = 0; row < PLAYER_SPRITE_HEIGHT; row++) {
		for (let col = 0; col < PLAYER_SPRITE_WIDTH; col++) {
			if ((row + col) % 2 !== 0) continue;
			parts.push(
				`<rect x="${originX + col * SCALE}" y="${originY + row * SCALE}" width="${SCALE}" height="${SCALE}" fill="#f0f0f0"/>`,
			);
		}
	}

	for (let row = 0; row < PLAYER_SPRITE_HEIGHT; row++) {
		const line = frame.bitmap[row];
		for (let col = 0; col < line.length; col++) {
			const colour = PLAYER_PALETTE[line[col]];
			if (colour === undefined) continue;
			parts.push(
				`<rect x="${originX + col * SCALE}" y="${originY + row * SCALE}" width="${SCALE}" height="${SCALE}" fill="${colour}"/>`,
			);
		}
	}

	// Ground line: the bitmap's bottom row is the ground contact.
	parts.push(
		`<line x1="${originX}" y1="${originY + cellH}" x2="${originX + cellW}" y2="${originY + cellH}" stroke="#a8a29e" stroke-width="2"/>`,
	);

	const label = `${frame.pose}[${frame.index}]`;
	parts.push(
		`<text x="${originX + cellW / 2}" y="${originY + cellH + 24}" text-anchor="middle" font-family="monospace" font-size="20" fill="#1c1917">${label}</text>`,
	);
});

parts.push("</svg>");

const out = process.argv[2] ?? "/tmp/runner-sprites.png";
const resvg = new Resvg(parts.join(""), {
	fitTo: { mode: "width", value: width },
});
fs.writeFileSync(out, resvg.render().asPng());
console.log(`wrote ${out} (${width}x${height}, ${frames.length} frames)`);
