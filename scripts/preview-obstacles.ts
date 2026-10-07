/**
 * Visual preview for the hero runner's obstacle candles.
 *
 *   node --experimental-strip-types scripts/preview-obstacles.ts [out.png]
 *
 * Renders every obstacle shape the spawner produces (each kind, and each cluster
 * width) across every flame frame, over a mock scene — the hero sky `#e7e5e4`,
 * a ground band in the near tone `#a6a3a1` and a ground line — so a human or
 * agent can see the art the game actually draws. The obstacles themselves are
 * collected from a real simulation run rather than re-declared, so each carries
 * its real seeded `tint`; the candles come from the same `obstacleCandleParts`
 * layout the canvas consumes, so the preview cannot drift from the game. A strip
 * of wax swatches along the top shows the six palette entries as wax/shade
 * pairs, and any multi-candle row shows the per-candle colour offset that keeps
 * neighbours different. Default output is `/tmp/runner-obstacles.png` so nothing
 * lands in the repo. The machine-checkable invariants live in
 * `scripts/verify-runner.ts`.
 */

import fs from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import {
	createGame,
	OBSTACLE_FRAME_COUNT,
	start,
	step,
	view,
} from "../src/lib/runner.ts";
import {
	CANDLE_CONTRAST_GROUND,
	CANDLE_CONTRAST_SKY,
	type ObstacleArt,
	obstacleCandleParts,
	WAX_COLORS,
} from "../src/lib/runner-obstacles.ts";

const DT = 1 / 120;
// bandHeight 190 / canvasWidth 640 is the geometry the docs use for examples: it
// lands on pixelScale 2 exactly, worldHeight 95 and groundY 71.
const BAND_HEIGHT = 190;
const CANVAS_WIDTH = 640;

const SKY = CANDLE_CONTRAST_SKY;
const GROUND = CANDLE_CONTRAST_GROUND;
const GROUND_LINE = "#57534e";
const GROUND_LINE_HEIGHT = 2;

const TILE_W = 40; // world units per cell, wide enough for the widest obstacle
const LABEL_W = 190;
const HEADER_H = 26;
const LEGEND_H = 34;
const PAD = 16;
const GAP = 10;

const KIND_ORDER = [
	"ground-narrow",
	"ground-wide",
	"ground-cluster",
	"flying-low",
	"flying-mid",
	"flying-high",
];

const started = start(
	createGame({ seed: 1, bandHeight: BAND_HEIGHT, canvasWidth: CANVAS_WIDTH }),
);
const geometry = view(started);
const GROUND_Y = geometry.groundY;
// Derived from the real geometry (2 at this bandHeight/canvasWidth), not copied.
const PX = geometry.pixelScale;

// Collect one obstacle per (kind, width), and every tint the run draws, by driving
// the real spawner. Keyed so a cluster's 3/6/9-block variants each get their own
// row.
const shapes = new Map<string, ObstacleArt>();
const tints = new Set<number>();
let g = started;
for (let i = 0; i < 600000; i++) {
	g = step(g, DT, { jump: false });
	for (const o of view(g).obstacles) {
		const key = `${o.kind}:${o.w}`;
		if (!shapes.has(key)) shapes.set(key, { ...o });
		tints.add(o.tint);
	}
}

const rows = [...shapes.values()].sort(
	(a, b) =>
		KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.w - b.w,
);

const tileW = TILE_W * PX;
const tileH = geometry.worldHeight * PX;
const width = Math.round(
	PAD * 2 +
		LABEL_W +
		OBSTACLE_FRAME_COUNT * tileW +
		(OBSTACLE_FRAME_COUNT - 1) * GAP,
);
const height = Math.round(
	PAD * 2 + HEADER_H + LEGEND_H + rows.length * (tileH + GAP) - GAP,
);

const parts: string[] = [
	`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`,
	`<rect width="${width}" height="${height}" fill="#ffffff"/>`,
];

for (let f = 0; f < OBSTACLE_FRAME_COUNT; f++) {
	const x = PAD + LABEL_W + f * (tileW + GAP) + tileW / 2;
	parts.push(
		`<text x="${x}" y="${PAD + 16}" text-anchor="middle" font-family="monospace" font-size="14" fill="#1c1917">frame ${f}</text>`,
	);
}

// Wax palette legend: one wax/shade pair per colour, in the order the per-candle
// tint offset walks them, so a reader can name what they see below.
const SWATCH_W = 58;
const BAR_W = 18;
const BAR_H = 16;
const legendY = PAD + HEADER_H + 14;
WAX_COLORS.forEach((wax, t) => {
	const x = PAD + LABEL_W + t * SWATCH_W;
	parts.push(
		`<text x="${x}" y="${PAD + HEADER_H + 11}" font-family="monospace" font-size="11" fill="#1c1917">${wax.name}</text>`,
		`<rect x="${x}" y="${legendY}" width="${BAR_W}" height="${BAR_H}" fill="${wax.wax}"/>`,
		`<rect x="${x + BAR_W}" y="${legendY}" width="${BAR_W}" height="${BAR_H}" fill="${wax.shade}"/>`,
	);
});

const gridTop = PAD + HEADER_H + LEGEND_H;
rows.forEach((o, r) => {
	const y = gridTop + r * (tileH + GAP);
	const clearance = GROUND_Y - (o.y + o.h);
	parts.push(
		`<text x="${PAD}" y="${y + tileH / 2 - 6}" font-family="monospace" font-size="14" fill="#1c1917">${o.kind}</text>`,
		`<text x="${PAD}" y="${y + tileH / 2 + 12}" font-family="monospace" font-size="12" fill="#57534e">w=${o.w} h=${o.h} bottom=${clearance} tint=${o.tint}</text>`,
	);
	for (let f = 0; f < OBSTACLE_FRAME_COUNT; f++) {
		const x = PAD + LABEL_W + f * (tileW + GAP);
		parts.push(
			`<rect x="${x}" y="${y}" width="${tileW}" height="${tileH}" fill="${SKY}"/>`,
		);
		const groundTop = y + GROUND_Y * PX;
		parts.push(
			`<rect x="${x}" y="${groundTop}" width="${tileW}" height="${tileH - GROUND_Y * PX}" fill="${GROUND}"/>`,
			`<rect x="${x}" y="${groundTop}" width="${tileW}" height="${GROUND_LINE_HEIGHT}" fill="${GROUND_LINE}"/>`,
		);
		// Centre the obstacle in the cell; `obstacleCandleParts` reads only the
		// rect, the kind, the frame and the tint, so the real x is irrelevant here.
		const worldX = (TILE_W - o.w) / 2;
		for (const part of obstacleCandleParts({ ...o, x: worldX, frame: f })) {
			parts.push(
				`<rect x="${x + part.x * PX}" y="${y + part.y * PX}" width="${part.w * PX}" height="${part.h * PX}" fill="${part.color}"/>`,
			);
		}
		parts.push(
			`<rect x="${x}" y="${y}" width="${tileW}" height="${tileH}" fill="none" stroke="#e5e5e5"/>`,
		);
	}
});
parts.push("</svg>");

const out = process.argv[2] ?? "/tmp/runner-obstacles.png";
const resvg = new Resvg(parts.join(""), {
	fitTo: { mode: "width", value: width },
});
fs.writeFileSync(out, resvg.render().asPng());
console.log(
	`wrote ${out} (${width}x${height}, pixelScale ${geometry.pixelScale}, ${rows.length} obstacle shapes x ${OBSTACLE_FRAME_COUNT} frames: ${rows.map((o) => `${o.kind}/w${o.w}`).join(", ")}; tints seen: ${[...tints].sort((a, b) => a - b).join(", ")})`,
);
