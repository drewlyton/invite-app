/**
 * Standalone verification for src/lib/runner-sprites.ts.
 *
 *   node --experimental-strip-types scripts/verify-sprites.ts
 *
 * Mirrors the shape of scripts/verify-runner.ts: plain Node, no test runner,
 * every assertion printed with its evidence, non-zero exit if a required
 * assertion fails. It checks the invariants the blit path depends on — an
 * exact 16x22 grid per bitmap, palette coverage, frame counts — plus the
 * batching contract of `drawBitmap` itself.
 */

import type { Pose } from "../src/lib/runner.ts";
import {
	drawBitmap,
	PLAYER_PALETTE,
	PLAYER_SPRITE_HEIGHT,
	PLAYER_SPRITE_WIDTH,
	PLAYER_SPRITES,
} from "../src/lib/runner-sprites.ts";

type Assertion = { name: string; pass: boolean; detail: string };

const POSES: readonly Pose[] = ["idle", "push", "ride", "jump", "dead"];
const EXPECTED_FRAMES: Record<Pose, number> = {
	idle: 2,
	push: 2,
	ride: 2,
	jump: 1,
	dead: 1,
};

// --- 1. pose + frame inventory ---------------------------------------------

function inventoryTest(): Assertion {
	const missing = POSES.filter((pose) => PLAYER_SPRITES[pose] === undefined);
	const extra = Object.keys(PLAYER_SPRITES).filter(
		(key) => !POSES.includes(key as Pose),
	);
	const wrongCounts = POSES.filter(
		(pose) => PLAYER_SPRITES[pose]?.length !== EXPECTED_FRAMES[pose],
	);
	const pass =
		missing.length === 0 && extra.length === 0 && wrongCounts.length === 0;
	return {
		name: "1. Pose and frame inventory",
		pass,
		detail: `poses ${POSES.join(", ")}; missing ${missing.length ? missing.join(", ") : "none"}; unexpected ${extra.length ? extra.join(", ") : "none"}; frames ${POSES.map((p) => `${p}=${PLAYER_SPRITES[p]?.length ?? 0}(want ${EXPECTED_FRAMES[p]})`).join(", ")}.`,
	};
}

// --- 2. bitmap dimensions ---------------------------------------------------

function sizeTest(): Assertion {
	const problems: string[] = [];
	let cells = 0;
	let transparent = 0;
	for (const pose of POSES) {
		PLAYER_SPRITES[pose]?.forEach((bitmap, index) => {
			const label = `${pose}[${index}]`;
			if (bitmap.length !== PLAYER_SPRITE_HEIGHT) {
				problems.push(
					`${label}: ${bitmap.length} rows (want ${PLAYER_SPRITE_HEIGHT})`,
				);
			}
			bitmap.forEach((row, y) => {
				cells++;
				if (row.length !== PLAYER_SPRITE_WIDTH) {
					problems.push(
						`${label} row ${y}: ${row.length} cols (want ${PLAYER_SPRITE_WIDTH})`,
					);
				}
				for (const ch of row) if (ch === ".") transparent++;
			});
		});
	}
	return {
		name: "2. Bitmap dimensions",
		pass: problems.length === 0,
		detail: problems.length
			? problems.join("; ")
			: `${POSES.length} poses, every bitmap exactly ${PLAYER_SPRITE_WIDTH}x${PLAYER_SPRITE_HEIGHT} (${cells} cells, ${transparent} transparent).`,
	};
}

// --- 3. palette coverage ----------------------------------------------------

function paletteTest(): Assertion {
	const unknown = new Map<string, string[]>();
	for (const pose of POSES) {
		PLAYER_SPRITES[pose]?.forEach((bitmap, index) => {
			bitmap.forEach((row, y) => {
				for (const ch of row) {
					if (ch === "." || PLAYER_PALETTE[ch] !== undefined) continue;
					const list = unknown.get(ch) ?? [];
					list.push(`${pose}[${index}] row ${y}`);
					unknown.set(ch, list);
				}
			});
		});
	}
	const badColours = Object.entries(PLAYER_PALETTE).filter(
		([, value]) => !/^#[0-9a-f]{6}$/i.test(value),
	);
	const pass = unknown.size === 0 && badColours.length === 0;
	const used = new Set<string>();
	for (const pose of POSES) {
		for (const bitmap of PLAYER_SPRITES[pose] ?? []) {
			for (const row of bitmap) {
				for (const ch of row) if (ch !== ".") used.add(ch);
			}
		}
	}
	return {
		name: "3. Palette coverage",
		pass,
		detail: pass
			? `every non-'.' character is a palette key; ${used.size}/${Object.keys(PLAYER_PALETTE).length} keys used (${[...used].sort().join("")}); all values are #rrggbb.`
			: `unknown characters: ${[...unknown.entries()].map(([ch, where]) => `'${ch}' in ${where.join(", ")}`).join("; ") || "none"}; malformed colours: ${badColours.map(([k, v]) => `${k}=${v}`).join(", ") || "none"}.`,
	};
}

// --- 4. blit batching -------------------------------------------------------

function blitTest(): Assertion {
	let style = "";
	let pending = 0;
	let began = 0;
	const batches: { colour: string; rects: number }[] = [];
	const allRects: [number, number, number, number][] = [];
	const ctx = {
		set fillStyle(value: string) {
			style = value;
		},
		get fillStyle(): string {
			return style;
		},
		beginPath(): void {
			began++;
		},
		rect(x: number, y: number, w: number, h: number): void {
			pending++;
			allRects.push([x, y, w, h]);
		},
		fill(): void {
			batches.push({ colour: style, rects: pending });
			pending = 0;
		},
	} as unknown as CanvasRenderingContext2D;

	const bitmap = PLAYER_SPRITES.ride[0];
	const x = 8;
	const y = 11;
	const px = 2.5;
	drawBitmap(ctx, bitmap, PLAYER_PALETTE, x, y, px);

	const expected = new Set<string>();
	const perColour = new Map<string, number>();
	bitmap.forEach((row, r) => {
		for (let c = 0; c < row.length; c++) {
			const colour = PLAYER_PALETTE[row[c]];
			if (colour === undefined) continue;
			expected.add(`${(x + c) * px},${(y + r) * px},${px},${px}`);
			perColour.set(colour, (perColour.get(colour) ?? 0) + 1);
		}
	});
	const actual = new Set(allRects.map((r) => r.join(",")));
	const rectsMatch =
		allRects.length === expected.size &&
		[...expected].every((key) => actual.has(key));
	const fillsMatch =
		batches.length === perColour.size &&
		began === perColour.size &&
		new Set(batches.map((b) => b.colour)).size === perColour.size &&
		batches.every((b) => perColour.get(b.colour) === b.rects);
	const pass = rectsMatch && fillsMatch;
	return {
		name: "4. drawBitmap batching",
		pass,
		detail: `ride[0] at (${x},${y}) scale ${px}: ${allRects.length} rects (want ${expected.size}, exact coords ${rectsMatch}); ${batches.length} fill()/${began} beginPath() for ${perColour.size} distinct colours; rects per colour ${fillsMatch ? "match" : "MISMATCH"} (${batches.map((b) => `${b.colour}:${b.rects}`).join(" ")}).`,
	};
}

// --- run --------------------------------------------------------------------

const assertions: Assertion[] = [
	inventoryTest(),
	sizeTest(),
	paletteTest(),
	blitTest(),
];
const allPass = assertions.every((a) => a.pass);

console.log("Hero runner sprite verification (src/lib/runner-sprites.ts)\n");
for (const a of assertions) {
	console.log(`${a.pass ? "PASS" : "FAIL"}  ${a.name}`);
	console.log(`      ${a.detail}\n`);
}

console.log("Sprite inventory");
for (const pose of POSES) {
	const sizes = (PLAYER_SPRITES[pose] ?? []).map(
		(bitmap, index) => `${index}:${bitmap[0].length}x${bitmap.length}`,
	);
	console.log(
		`  ${pose}: ${PLAYER_SPRITES[pose]?.length ?? 0} frame(s) [${sizes.join(", ")}]`,
	);
}
console.log(
	`  palette: ${Object.entries(PLAYER_PALETTE)
		.map(([k, v]) => `${k}=${v}`)
		.join(" ")}`,
);

console.log(`\nOverall: ${allPass ? "PASS" : "FAIL"}`);
process.exitCode = allPass ? 0 : 1;
