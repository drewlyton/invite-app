/**
 * Standalone verification for src/lib/runner.ts.
 *
 * Relocated from the throwaway Astro debug page so no verification page ships
 * under `output: "server"`. There is no test runner in this repo, so this is a
 * plain Node script that drives the pure simulation:
 *
 *   node --experimental-strip-types scripts/verify-runner.ts
 *
 * Every assertion and every reported number is derived from `TUNING` (and the
 * exported `AIR_TIME`), never hand-copied. Exits non-zero if a required
 * assertion fails.
 */

import {
	AIR_TIME,
	createGame,
	type Game,
	type ObstacleKind,
	resize,
	start,
	step,
	TUNING,
	view,
} from "../src/lib/runner.ts";

const DT = 1 / 120;

// Derived from the real tuning constants, never hand-copied. Jump-only play:
// the standing hitbox spans [STANDING_HITBOX_BOTTOM, STANDING_HITBOX_TOP] above
// the ground, and the apex puts the hitbox bottom at APEX_HITBOX_BOTTOM.
const STANDING_HITBOX_BOTTOM = TUNING.playerHeight * TUNING.hitboxInset; // 4.4
const STANDING_HITBOX_TOP = TUNING.playerHeight - STANDING_HITBOX_BOTTOM; // 17.6
const APEX_FEET =
	(TUNING.jumpVelocity * TUNING.jumpVelocity) / (2 * TUNING.gravity);
const APEX_HITBOX_BOTTOM = APEX_FEET + STANDING_HITBOX_BOTTOM;

type Assertion = { name: string; pass: boolean; detail: string };

// --- measured player physics ------------------------------------------------

function measureAirTime(): number {
	let g = start(createGame({ seed: 1, bandHeight: 190, canvasWidth: 640 }));
	g = step(g, DT, { jump: false });
	let frames = 0;
	g = step(g, DT, { jump: true });
	while (view(g).player.airborne && frames < 10000) {
		g = step(g, DT, { jump: false });
		frames++;
	}
	return frames * DT;
}

// --- 1. purity / determinism ------------------------------------------------

function purityTest(): Assertion {
	const seed = 12345;
	let a = start(createGame({ seed, bandHeight: 190, canvasWidth: 640 }));
	let b = start(createGame({ seed, bandHeight: 190, canvasWidth: 640 }));
	let deterministic = true;
	let mutated = false;
	let branchStable = true;
	for (let i = 0; i < 4000; i++) {
		const input = { jump: i % 37 === 0 };
		const beforeA = JSON.stringify(a);
		const a2 = step(a, DT, input);
		if (JSON.stringify(a) !== beforeA) mutated = true;
		const b2 = step(b, DT, input);
		if (JSON.stringify(a2) !== JSON.stringify(b2)) deterministic = false;
		const a2again = step(a, DT, input);
		if (JSON.stringify(a2) !== JSON.stringify(a2again)) branchStable = false;
		a = a2;
		b = b2;
	}
	return {
		name: "1. Purity / determinism",
		pass: deterministic && !mutated && branchStable,
		detail: `same seed + same inputs => identical full state: ${deterministic}; step mutated its argument: ${mutated}; replaying a saved state branches identically: ${branchStable} (4000 steps, full-state JSON hash)`,
	};
}

// --- 2. spacing -------------------------------------------------------------

type SpawnRecord = {
	kind: ObstacleKind;
	width: number;
	gap: number;
	arrivalDistance: number;
	checked: boolean;
	slack: number;
};

function spacingTest(): Assertion {
	let g = start(createGame({ seed: 7, bandHeight: 190, canvasWidth: 640 }));
	let prevGroundOffset = view(g).groundOffset;
	let spawnX = 0;
	let lastMaxX = Number.NEGATIVE_INFINITY;
	let lastSpawnDistance: number | null = null;
	const records: SpawnRecord[] = [];
	let checkIndex = 0;
	let maxSpeedSeen = 0;
	const target = 10000;
	const maxSteps = 3_000_000;
	let steps = 0;

	while (
		checkIndex < target &&
		records.length < target * 2 &&
		steps < maxSteps
	) {
		g = step(g, DT, { jump: false });
		const s = view(g);
		const speed = (s.groundOffset - prevGroundOffset) / DT;
		if (speed > maxSpeedSeen) maxSpeedSeen = speed;

		let maxX = Number.NEGATIVE_INFINITY;
		let newest: (typeof s.obstacles)[number] | null = null;
		for (const o of s.obstacles) {
			if (o.x > maxX) {
				maxX = o.x;
				newest = o;
			}
		}
		// Obstacles only move left, so the max x dips on removal and jumps on
		// spawn; a rise means a new obstacle entered at the spawn point.
		if (newest && maxX > lastMaxX + 1e-9) {
			spawnX = maxX;
			if (lastSpawnDistance !== null) {
				records.push({
					kind: newest.kind,
					width: newest.w,
					gap: s.groundOffset - lastSpawnDistance,
					arrivalDistance: s.groundOffset + (spawnX - s.player.x),
					checked: false,
					slack: Number.POSITIVE_INFINITY,
				});
			}
			lastSpawnDistance = s.groundOffset;
		}
		lastMaxX = maxX;

		// Arrival distances are monotonic, so only the oldest unchecked record
		// can come due.
		while (checkIndex < records.length) {
			const r = records[checkIndex];
			if (s.groundOffset < r.arrivalDistance) break;
			r.checked = true;
			r.slack = r.gap - (speed * AIR_TIME + r.width);
			checkIndex++;
		}
		prevGroundOffset = s.groundOffset;
		steps++;
	}

	let minSlack = Number.POSITIVE_INFINITY;
	let worst: SpawnRecord | null = null;
	for (const r of records) {
		if (r.checked && r.slack < minSlack) {
			minSlack = r.slack;
			worst = r;
		}
	}
	const tolerance = 0.5; // finite-difference speed measurement error
	const pass = checkIndex >= target && minSlack >= -tolerance;
	return {
		name: "2. Spacing",
		pass,
		detail: `${checkIndex} spawns checked (target ${target}); min slack ${minSlack.toFixed(4)} units vs gap >= speedAtArrival * AIR_TIME(${AIR_TIME.toFixed(4)}) + obstacleWidth (tolerance ${tolerance}). Worst case: ${worst ? `${worst.kind} w=${worst.width} gap=${worst.gap.toFixed(3)}` : "n/a"}. Max speed observed ${maxSpeedSeen.toFixed(2)} u/s over ${steps} steps.`,
	};
}

// --- 3. warning time --------------------------------------------------------

function warningTest(maxSpeed: number): Assertion {
	// canvasWidth=390 is the breakpoint: below it the MIN_WORLD_WIDTH floor
	// cannot hold at pixelScaleMin=1.5. worldWidth is exactly MIN_WORLD_WIDTH.
	const s = view(createGame({ bandHeight: 190, canvasWidth: 390 }));
	const tWarn = (s.worldWidth - s.player.x - s.player.w) / maxSpeed;
	const budget = TUNING.reactionBudget + AIR_TIME;
	const maxPassing = (s.worldWidth - s.player.x - s.player.w) / budget;
	return {
		name: "3. Warning time (390px breakpoint)",
		pass: tWarn >= budget,
		detail: `canvasWidth=390, bandHeight=190 => pixelScale=${s.pixelScale.toFixed(3)}, worldWidth=${s.worldWidth.toFixed(1)} (= MIN_WORLD_WIDTH ${TUNING.minWorldWidth}); playerX=${s.player.x}, playerW=${s.player.w}; at measured max speed ${maxSpeed.toFixed(2)} => tWarn=${tWarn.toFixed(4)}s >= reactionBudget(${TUNING.reactionBudget}) + airTime(${AIR_TIME.toFixed(4)}) = ${budget.toFixed(4)}s, margin ${(tWarn - budget).toFixed(4)}s. Largest passing maxSpeed at this airTime: ${maxPassing.toFixed(2)} u/s.`,
	};
}

function geometryCaveat(maxSpeed: number): Assertion {
	// Not one of the required assertions. Guards the breakpoint where the width
	// floor stops holding: pixelScale = min(heightTerm, widthTerm) is capped by
	// canvasWidth/MIN_WORLD_WIDTH, so worldWidth >= MIN_WORLD_WIDTH — but only
	// while pixelScaleMin <= canvasWidth/MIN_WORLD_WIDTH, i.e. canvasWidth >= 390.
	const s = view(createGame({ bandHeight: 190, canvasWidth: 390 }));
	const tWarn = (s.worldWidth - s.player.x - s.player.w) / maxSpeed;
	const budget = TUNING.reactionBudget + AIR_TIME;
	const floorHolds = s.worldWidth >= TUNING.minWorldWidth;
	const warnHolds = tWarn >= budget;
	return {
		name: "Caveat. Width floor + warning margin at the 390px breakpoint",
		pass: floorHolds,
		detail: `pixelScale=${s.pixelScale.toFixed(3)} (min of height term 190/${TUNING.targetWorldHeight}=${(190 / TUNING.targetWorldHeight).toFixed(2)}, width term 390/${TUNING.minWorldWidth}=${(390 / TUNING.minWorldWidth).toFixed(2)}) => worldWidth=${s.worldWidth.toFixed(1)} >= ${TUNING.minWorldWidth}: ${floorHolds}. tWarn=${tWarn.toFixed(4)}s >= ${budget.toFixed(4)}s: ${warnHolds}. Below canvasWidth = MIN_WORLD_WIDTH * PIXEL_SCALE_MIN = ${TUNING.minWorldWidth * TUNING.pixelScaleMin}px the floor cannot hold at pixelScaleMin=${TUNING.pixelScaleMin}.`,
	};
}

// --- 4. clearability --------------------------------------------------------

type FoundObstacle = {
	g: Game;
	kind: ObstacleKind;
	w: number;
	h: number;
	bottomClear: number;
	topClear: number;
};

function firstObstacle(seed: number): FoundObstacle | null {
	let g = start(createGame({ seed, bandHeight: 190, canvasWidth: 640 }));
	g = step(g, DT, { jump: false });
	const s = view(g);
	const o = s.obstacles[0];
	if (!o) return null;
	return {
		g,
		kind: o.kind,
		w: o.w,
		h: o.h,
		bottomClear: s.groundY - (o.y + o.h),
		topClear: s.groundY - o.y,
	};
}

/**
 * "A jump started on the last frame before contact" is ambiguous. Read
 * literally (jump on contactFrame - 1) it can never clear a ground obstacle:
 * the inset hitbox bottom starts 4.4 units above the ground while a ground
 * obstacle is 10-16 units tall, so the player needs a few frames of rise before
 * the boxes would overlap. We therefore define it as the *latest frame at which
 * a jump still clears* — the point of no return. The assertion is that this
 * frame exists, is strictly before the contact frame, and that jumping one
 * frame later collides.
 *
 * Jump-only classification (matches OBSTACLE_SHAPES in runner.ts):
 *   must jump  => bottomClear < standingHitboxTop(17.6)
 *   run under  => bottomClear > standingHitboxTop(17.6)
 * Run-under kinds are viable with no input at all, so they are checked by
 * surviving an empty-input run rather than by finding a jump frame.
 */
function clearabilityFor(target: ObstacleKind, minWidth = 0): Assertion {
	for (let seed = 1; seed < 8000; seed++) {
		const found = firstObstacle(seed);
		if (!found || found.kind !== target || found.w < minWidth) continue;
		const { g, w, h, bottomClear, topClear } = found;
		const mustJump = bottomClear < STANDING_HITBOX_TOP;
		const derivation = `clearance ${bottomClear}-${topClear}; standing hitbox ${STANDING_HITBOX_BOTTOM}-${STANDING_HITBOX_TOP}, apex hitbox bottom ${APEX_HITBOX_BOTTOM.toFixed(2)}`;

		if (!mustJump) {
			let s = g;
			let survived = true;
			for (let i = 0; i < 5000; i++) {
				s = step(s, DT, { jump: false });
				const sv = view(s);
				if (sv.phase === "dead") {
					survived = false;
					break;
				}
				const o = sv.obstacles.find((x) => x.kind === target);
				if (!o || o.x + o.w < sv.player.x) break;
			}
			return {
				name: `4. Clearability (${target})`,
				pass: survived,
				detail: `seed=${seed}, obstacle w=${w} h=${h}; ${derivation}; bottomClear ${bottomClear} > standingHitboxTop ${STANDING_HITBOX_TOP} => run under; survived with no input: ${survived}.`,
			};
		}

		// contact frame: first frame the AABBs overlap with no input at all
		let contact = -1;
		let s = g;
		for (let i = 0; i < 5000; i++) {
			s = step(s, DT, { jump: false });
			if (view(s).phase === "dead") {
				contact = i + 1;
				break;
			}
		}
		if (contact < 0) continue;

		let latestClear = -1;
		let literalClears = false;
		for (let k = contact - 1; k >= 0; k--) {
			let t = g;
			for (let i = 0; i < k; i++) {
				t = step(t, DT, { jump: false });
			}
			t = step(t, DT, { jump: true });
			let cleared = true;
			for (let i = 0; i < 600; i++) {
				t = step(t, DT, { jump: false });
				const tv = view(t);
				if (tv.phase === "dead") {
					cleared = false;
					break;
				}
				const o = tv.obstacles.find((x) => x.kind === target);
				if (!o || o.x + o.w < tv.player.x) break;
			}
			if (cleared && latestClear < 0) latestClear = k;
			if (k === contact - 1) literalClears = cleared;
		}

		const margin = latestClear >= 0 ? (contact - latestClear) * DT : 0;
		return {
			name: `4. Clearability (${target})`,
			pass: latestClear >= 0 && latestClear < contact,
			detail: `seed=${seed}, obstacle w=${w} h=${h}; ${derivation}; bottomClear ${bottomClear} < standingHitboxTop ${STANDING_HITBOX_TOP} => must jump; topClear ${topClear} < apex hitbox bottom ${APEX_HITBOX_BOTTOM.toFixed(2)} => ${topClear < APEX_HITBOX_BOTTOM}; contact frame=${contact}, latest clearing jump frame=${latestClear} => margin ${margin.toFixed(4)}s (${contact - latestClear} frames). Literal jump on contactFrame-1 clears: ${literalClears}.`,
		};
	}
	return {
		name: `4. Clearability (${target})`,
		pass: false,
		detail: `no seed produced a ${target}${minWidth ? ` of width >= ${minWidth}` : ""} as the first spawn`,
	};
}

// --- 5. resize keeps the run alive ------------------------------------------

/**
 * resize() is simulation state and must not reset the run. Obstacles are in
 * world units, so a resize may only change the window and the ground-relative
 * y offsets — never the distance counters, the obstacle x positions or the
 * ground clearances.
 */
function resizeTest(): Assertion {
	let g = start(createGame({ seed: 4242, bandHeight: 190, canvasWidth: 640 }));
	for (let i = 0; i < 600; i++) {
		g = step(g, DT, { jump: i % 61 === 0 });
	}
	const before = view(g);
	const beforeDistance = before.groundOffset;
	const beforeScore = before.score;
	const beforePhase = before.phase;
	const beforeObstacles = before.obstacles.map((o) => ({
		kind: o.kind,
		x: o.x,
		w: o.w,
		clearance: before.groundY - (o.y + o.h),
	}));
	const extraDistance = before.obstacles.map(
		(o) => o.x + o.w - before.player.x,
	);
	const beforePlayerClearance =
		before.groundY - (before.player.y + before.player.h);

	const narrow = view(resize(g, { bandHeight: 160, canvasWidth: 360 }));
	const wide = view(resize(g, { bandHeight: 220, canvasWidth: 1280 }));

	const sameObstacles = (s: typeof narrow): boolean =>
		s.obstacles.length === beforeObstacles.length &&
		s.obstacles.every((o, i) => {
			const b = beforeObstacles[i];
			const clearance = s.groundY - (o.y + o.h);
			return (
				o.kind === b.kind &&
				Math.abs(o.x - b.x) < 1e-9 &&
				Math.abs(o.w - b.w) < 1e-9 &&
				Math.abs(clearance - b.clearance) < 1e-9
			);
		});

	const snapshotHolds = (s: typeof narrow): boolean =>
		s.phase === beforePhase &&
		Math.abs(s.groundOffset - beforeDistance) < 1e-9 &&
		s.score === beforeScore &&
		Math.abs(s.groundY - (s.player.y + s.player.h) - beforePlayerClearance) <
			1e-9 &&
		sameObstacles(s);

	// The run must keep integrating after a resize, not restart at distance 0.
	let after = resize(g, { bandHeight: 160, canvasWidth: 360 });
	for (let i = 0; i < 240; i++) after = step(after, DT, { jump: false });
	const afterView = view(after);
	const progressed = afterView.groundOffset > beforeDistance + 1;

	const geometryChanges = narrow.pixelScale !== wide.pixelScale;
	const pass =
		snapshotHolds(narrow) &&
		snapshotHolds(wide) &&
		progressed &&
		geometryChanges;
	return {
		name: "5. Resize keeps the run alive",
		pass,
		detail: `before: phase=${beforePhase} distance=${beforeDistance.toFixed(2)} score=${beforeScore} obstacles=${beforeObstacles.length}; after 160x360: same snapshot ${snapshotHolds(narrow)} (pixelScale ${before.pixelScale.toFixed(3)}->${narrow.pixelScale.toFixed(3)}); after 220x1280: same snapshot ${snapshotHolds(wide)} (pixelScale ${wide.pixelScale.toFixed(3)}); still running and progressed ${progressed} (distance ${afterView.groundOffset.toFixed(2)}); geometry changed between sizes: ${geometryChanges}. Extra travel-to-player distances preserved: ${extraDistance.map((d) => d.toFixed(1)).join(", ") || "n/a"}.`,
	};
}

// --- 6. vertical fit at the tightest geometry -------------------------------

/**
 * `groundMargin` lifts the ground line off the bottom of the band, which also
 * lifts the player's jump apex. The tightest case is the smallest `worldHeight`
 * the geometry formula can produce — its floor of `targetWorldHeight` — because
 * the sprite top at apex sits `groundMargin + apex + playerHeight` below the
 * band's bottom, so it must not exceed `worldHeight`.
 *
 * We sweep the documented band-height range and a spread of widths, find the
 * geometry with the smallest worldHeight, measure the player's actual highest
 * point there (the discrete integrator's apex, not the nominal v^2/2g one) and
 * assert both the measured sprite top stays inside the band and the nominal
 * bound holds. A future re-tune that pushes `groundMargin` past the bound fails
 * here instead of silently clipping the jump.
 */
function verticalFitTest(): Assertion {
	let tightest = {
		bandHeight: 0,
		canvasWidth: 0,
		worldHeight: Number.POSITIVE_INFINITY,
		pixelScale: 0,
	};
	for (let bandHeight = 160; bandHeight <= 200; bandHeight++) {
		for (const canvasWidth of [
			320, 360, 390, 420, 480, 640, 800, 1024, 1280, 1920,
		]) {
			const s = view(createGame({ bandHeight, canvasWidth }));
			if (s.worldHeight < tightest.worldHeight) {
				tightest = {
					bandHeight,
					canvasWidth,
					worldHeight: s.worldHeight,
					pixelScale: s.pixelScale,
				};
			}
		}
	}

	// Measure the discrete apex in the tightest geometry.
	let g = start(
		createGame({
			bandHeight: tightest.bandHeight,
			canvasWidth: tightest.canvasWidth,
			seed: 1,
		}),
	);
	const first = view(g);
	const groundY = first.groundY;
	const standingTop = groundY - TUNING.playerHeight;
	let minTop = standingTop;
	g = step(g, DT, { jump: true });
	for (let i = 0; i < 2000 && view(g).player.airborne; i++) {
		const top = view(g).player.y;
		if (top < minTop) minTop = top;
		g = step(g, DT, { jump: false });
	}
	const measuredApex = standingTop - minTop;

	// Nominal bound from the brief: groundMargin + apex + playerHeight must fit
	// within worldHeight for the sprite top at apex to stay inside the band.
	const maxMarginNominal =
		tightest.worldHeight - APEX_FEET - TUNING.playerHeight;
	const maxMarginMeasured =
		tightest.worldHeight - measuredApex - TUNING.playerHeight;
	const spriteTopAtApex = minTop;
	const pass =
		tightest.worldHeight >= TUNING.targetWorldHeight - 1e-9 &&
		spriteTopAtApex >= -1e-9 &&
		TUNING.groundMargin <= maxMarginNominal + 1e-9;
	return {
		name: "6. Vertical fit at the tightest geometry",
		pass,
		detail: `tightest worldHeight=${tightest.worldHeight.toFixed(3)} at bandHeight=${tightest.bandHeight}, canvasWidth=${tightest.canvasWidth} (pixelScale=${tightest.pixelScale.toFixed(3)}); measured apex=${measuredApex.toFixed(3)}u (nominal ${APEX_FEET.toFixed(3)}u); sprite top at apex y=${spriteTopAtApex.toFixed(3)} >= 0: ${spriteTopAtApex >= -1e-9}; groundMargin=${TUNING.groundMargin} <= worldHeight - apex - playerHeight: nominal bound ${maxMarginNominal.toFixed(3)}, measured bound ${maxMarginMeasured.toFixed(3)}.`,
	};
}

// --- run --------------------------------------------------------------------

const airTime = measureAirTime();
const purity = purityTest();
const spacing = spacingTest();

// Saturate the speed ramp to measure max speed with a dead-but-still-scrolling
// world (the sim keeps integrating after a collision; see runner.ts).
let speedGame = start(
	createGame({ seed: 3, bandHeight: 190, canvasWidth: 640 }),
);
let prevOffset = view(speedGame).groundOffset;
let maxSpeed = 0;
for (let i = 0; i < 300000; i++) {
	speedGame = step(speedGame, DT, { jump: false });
	const s = view(speedGame);
	const speed = (s.groundOffset - prevOffset) / DT;
	if (speed > maxSpeed) maxSpeed = speed;
	prevOffset = s.groundOffset;
}

const clearabilityKinds: { kind: ObstacleKind; minWidth?: number }[] = [
	{ kind: "ground-narrow" },
	{ kind: "ground-wide" },
	{ kind: "ground-cluster", minWidth: 9 }, // widest cluster variant
	{ kind: "flying-low" },
	{ kind: "flying-mid" },
	{ kind: "flying-high" },
];
const clearability = clearabilityKinds.map(({ kind, minWidth }) =>
	clearabilityFor(kind, minWidth),
);

const warning = warningTest(maxSpeed);
const resizeAssertion = resizeTest();
const verticalFit = verticalFitTest();
const requiredAssertions: Assertion[] = [
	purity,
	spacing,
	warning,
	...clearability,
	resizeAssertion,
	verticalFit,
];
const caveat = geometryCaveat(maxSpeed);
const allPass = requiredAssertions.every((a) => a.pass);

console.log("Hero runner verification (src/lib/runner.ts)\n");
for (const a of requiredAssertions) {
	console.log(`${a.pass ? "PASS" : "FAIL"}  ${a.name}`);
	console.log(`      ${a.detail}\n`);
}
console.log(`${caveat.pass ? "PASS" : "FAIL"}  ${caveat.name}  [not required]`);
console.log(`      ${caveat.detail}\n`);

const tuningRows: [string, string][] = [
	["targetWorldHeight", String(TUNING.targetWorldHeight)],
	["minWorldWidth", String(TUNING.minWorldWidth)],
	["pixelScaleMin / Max", `${TUNING.pixelScaleMin} / ${TUNING.pixelScaleMax}`],
	["playerWidth x height", `${TUNING.playerWidth} x ${TUNING.playerHeight}`],
	["playerX", String(TUNING.playerX)],
	["gravity / jumpVelocity", `${TUNING.gravity} / ${TUNING.jumpVelocity}`],
	["nominal AIR_TIME", `${AIR_TIME.toFixed(4)} s`],
	["measured airtime", `${airTime.toFixed(4)} s (discrete)`],
	["startSpeed / maxSpeed", `${TUNING.startSpeed} / ${maxSpeed.toFixed(2)}`],
	[
		"apex feet / hitbox bottom",
		`${APEX_FEET.toFixed(2)} / ${APEX_HITBOX_BOTTOM.toFixed(2)} u`,
	],
];
console.log("Tuning readout (read from runner.ts)");
for (const [k, v] of tuningRows) console.log(`  ${k}: ${v}`);

console.log(
	`\nOverall (purity + spacing + warning + per-kind clearability + resize + vertical fit): ${allPass ? "PASS" : "FAIL"}`,
);
process.exitCode = allPass ? 0 : 1;
