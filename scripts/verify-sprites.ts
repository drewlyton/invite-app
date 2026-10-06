/**
 * Standalone verification for src/lib/runner-sprites.ts.
 *
 *   node --experimental-strip-types scripts/verify-sprites.ts
 *
 * Mirrors the shape of scripts/verify-runner.ts: plain Node, no test runner,
 * every assertion printed with its evidence, non-zero exit if a required
 * assertion fails. It checks the invariants the image pipeline depends on — a
 * complete pose/frame manifest, every frame present on disk as a transparent
 * PNG with its background removed, and the contain/bottom-centre geometry of
 * `drawPlayerFrame`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { Pose } from "../src/lib/runner.ts";
import {
	drawPlayerFrame,
	PLAYER_FRAMES,
	type SpriteImage,
} from "../src/lib/runner-sprites.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
	const missing = POSES.filter((pose) => PLAYER_FRAMES[pose] === undefined);
	const extra = Object.keys(PLAYER_FRAMES).filter(
		(key) => !POSES.includes(key as Pose),
	);
	const wrongCounts = POSES.filter(
		(pose) => PLAYER_FRAMES[pose]?.length !== EXPECTED_FRAMES[pose],
	);
	const pass =
		missing.length === 0 && extra.length === 0 && wrongCounts.length === 0;
	return {
		name: "1. Pose and frame inventory",
		pass,
		detail: `poses ${POSES.join(", ")}; missing ${missing.length ? missing.join(", ") : "none"}; unexpected ${extra.length ? extra.join(", ") : "none"}; frames ${POSES.map((p) => `${p}=${PLAYER_FRAMES[p]?.length ?? 0}(want ${EXPECTED_FRAMES[p]})`).join(", ")}.`,
	};
}

// --- 2. frames on disk ------------------------------------------------------

async function frameFilesTest(): Promise<Assertion> {
	const problems: string[] = [];
	const seen = new Set<string>();
	const lines: string[] = [];
	for (const pose of POSES) {
		for (const url of PLAYER_FRAMES[pose] ?? []) {
			if (seen.has(url)) {
				problems.push(`${url}: duplicated across poses`);
				continue;
			}
			seen.add(url);
			if (!url.startsWith("/runner/player/")) {
				problems.push(`${url}: outside /runner/player/`);
				continue;
			}
			const file = path.join(ROOT, "public", url);
			if (!fs.existsSync(file)) {
				problems.push(`${url}: missing file ${path.relative(ROOT, file)}`);
				continue;
			}
			const meta = await sharp(file).metadata();
			if (meta.format !== "png") problems.push(`${url}: not a PNG`);
			if (!meta.hasAlpha) problems.push(`${url}: no alpha channel`);
			if (!meta.width || !meta.height) {
				problems.push(`${url}: zero size`);
				continue;
			}
			// Background removal leaves fully transparent pixels around opaque
			// art; a frame that is entirely opaque still has its sheet background.
			const stats = await sharp(file).stats();
			const alpha = stats.channels[3];
			if (alpha.min !== 0) problems.push(`${url}: no transparent pixels`);
			if (alpha.max !== 255) problems.push(`${url}: no opaque pixels`);
			lines.push(
				`${path.basename(url)} ${meta.width}x${meta.height} a[${alpha.min}-${alpha.max}]`,
			);
		}
	}
	return {
		name: "2. Frame files",
		pass: problems.length === 0,
		detail: problems.length
			? problems.join("; ")
			: `${seen.size} transparent native-resolution PNGs, distinct per pose (${lines.join(", ")}).`,
	};
}

// --- 3. drawPlayerFrame geometry -------------------------------------------

let drawArgs: [unknown, number, number, number, number] | null = null;
const ctx = {
	drawImage(
		image: unknown,
		dx: number,
		dy: number,
		dw: number,
		dh: number,
	): void {
		drawArgs = [image, dx, dy, dw, dh];
	},
} as unknown as CanvasRenderingContext2D;

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

function geometryTest(): Assertion {
	const x = 8;
	const y = 11;
	const px = 2.5;
	const problems: string[] = [];

	// A tall image is height-bound; a wide one is width-bound. Both must end
	// bottom-aligned on the box and centred horizontally.
	const cases: { image: SpriteImage; w: number }[] = [
		{ image: { width: 100, height: 200 } as SpriteImage, w: 11 },
		{ image: { width: 200, height: 100 } as SpriteImage, w: 16 },
	];
	const boxRight = (x + 16) * px;
	const boxBottom = (y + 22) * px;
	for (const { image, w } of cases) {
		drawArgs = null;
		drawPlayerFrame(ctx, image, x, y, px);
		// The cast restores the union: TS cannot see the mutation the mock ctx's
		// `drawImage` performs inside `drawPlayerFrame`.
		const args = drawArgs as [unknown, number, number, number, number] | null;
		if (!args) {
			problems.push(`${image.width}x${image.height}: drawImage not called`);
			continue;
		}
		const [, dx, dy, dw, dh] = args;
		if (!close(dw, w * px)) problems.push(`${image.width}x${image.height}: dw`);
		if (!close(dx + dw / 2, (x + 8) * px)) {
			problems.push(`${image.width}x${image.height}: not centred`);
		}
		if (!close(dy + dh, boxBottom)) {
			problems.push(`${image.width}x${image.height}: not bottom-aligned`);
		}
		// Contain: the fitted box never exceeds the world box in either axis.
		if (dw > 16 * px + 1e-9 || dh > 22 * px + 1e-9) {
			problems.push(`${image.width}x${image.height}: larger than the box`);
		}
		if (dx < x * px - 1e-9 || dx + dw > boxRight + 1e-9) {
			problems.push(`${image.width}x${image.height}: horizontally outside`);
		}
	}
	return {
		name: "3. drawPlayerFrame geometry",
		pass: problems.length === 0,
		detail: problems.length
			? problems.join("; ")
			: `100x200 -> 11x22 and 200x100 -> 16x8 world units, both bottom-centre contained in the 16x22 box at (${x},${y}) scale ${px}.`,
	};
}

// --- run --------------------------------------------------------------------

const assertions: Assertion[] = [
	inventoryTest(),
	await frameFilesTest(),
	geometryTest(),
];
const allPass = assertions.every((a) => a.pass);

console.log("Hero runner sprite verification (src/lib/runner-sprites.ts)\n");
for (const a of assertions) {
	console.log(`${a.pass ? "PASS" : "FAIL"}  ${a.name}`);
	console.log(`      ${a.detail}\n`);
}

console.log("Sprite manifest");
for (const pose of POSES) {
	console.log(`  ${pose}: ${(PLAYER_FRAMES[pose] ?? []).join(", ")}`);
}

console.log(`\nOverall: ${allPass ? "PASS" : "FAIL"}`);
process.exitCode = allPass ? 0 : 1;
