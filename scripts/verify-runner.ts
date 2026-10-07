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
	OBSTACLE_FRAME_COUNT,
	OBSTACLE_SHAPES,
	OBSTACLE_TINT_COUNT,
	type ObstacleKind,
	resize,
	start,
	step,
	TUNING,
	view,
} from "../src/lib/runner.ts";
import {
	CANDLE_BODY_ROLES,
	CANDLE_BODY_WIDTH,
	CANDLE_CONTRAST_GROUND,
	CANDLE_CONTRAST_SKY,
	CANDLE_GAP,
	CANDLE_PITCH,
	FLAME_VARIANT_COUNT,
	FLAME_VARIANTS,
	type ObstacleArt,
	obstacleCandleParts,
	WAX_COLORS,
} from "../src/lib/runner-obstacles.ts";

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

// --- 7. pose model -----------------------------------------------------------

/**
 * The pose union is the renderer's whole interface to the animation state, so
 * it gets its own assertion: idle must hold perfectly still — same pose, same
 * frame, same player position, no distance, no obstacles — a run must open on a
 * static `push` and settle into `ride` after `TUNING.pushDuration`, a grounded
 * jump must animate crouch -> airborne -> crouch and settle back into `ride`,
 * and a collision must freeze the pose the character died on rather than
 * switching to a crash sprite.
 */
function poseTest(): Assertion {
	const idle = createGame({ seed: 5, bandHeight: 190, canvasWidth: 640 });
	const idleView = view(idle);
	// Step the idle scene for four frame periods' worth of simulated time. The
	// phase is asserted to be completely static, so any animation, drift or world
	// advance over that span is a failure — including the two-frame bob the idle
	// pose used to run, which is why this asserts frame 0 rather than a cycle.
	let idleStepped = idle;
	for (let i = 0; i < 8; i++) {
		idleStepped = step(idleStepped, TUNING.frameDuration, { jump: false });
	}
	const idleAfterView = view(idleStepped);
	const idleHoldsStill =
		idleView.phase === "idle" &&
		idleView.player.pose === "idle" &&
		idleView.player.frame === 0 &&
		idleAfterView.phase === "idle" &&
		idleAfterView.player.pose === "idle" &&
		idleAfterView.player.frame === 0 &&
		idleAfterView.player.x === idleView.player.x &&
		idleAfterView.player.y === idleView.player.y &&
		// `RenderState.groundOffset` *is* the distance travelled (see `view`), so
		// this is the world-advance check, not merely a scroll-position check.
		idleAfterView.groundOffset === idleView.groundOffset &&
		idleAfterView.obstacles.length === 0;

	let g = start(createGame({ seed: 5, bandHeight: 190, canvasWidth: 640 }));
	const startsPush = view(g).player.pose === "push";
	let pushSteps = 0;
	let pushStayedFrame0 = true;
	while (view(g).player.pose === "push" && pushSteps < 10000) {
		g = step(g, DT, { jump: false });
		if (view(g).player.frame !== 0) pushStayedFrame0 = false;
		pushSteps++;
	}
	const pushSeconds = pushSteps * DT;
	const settlesRide = view(g).player.pose === "ride";
	const pushDurationAccurate =
		pushSeconds >= TUNING.pushDuration &&
		pushSeconds - TUNING.pushDuration < DT + 1e-9;

	// A jump taken from the settled ride state animates crouch -> airborne ->
	// crouch: frame 0 on takeoff, 1 once the takeoff window has passed, 2 on
	// touchdown, and the run settles back into ride once the crouch expires.
	let jump = step(g, DT, { jump: true });
	const jumpStartsCrouched =
		view(jump).player.pose === "jump" &&
		view(jump).player.airborne &&
		view(jump).player.frame === 0;
	let sawAirFrame = false;
	let jumpSteps = 0;
	while (view(jump).player.airborne && jumpSteps < 10000) {
		jump = step(jump, DT, { jump: false });
		if (view(jump).player.airborne && view(jump).player.frame === 1) {
			sawAirFrame = true;
		}
		jumpSteps++;
	}
	const landingCrouch =
		view(jump).player.pose === "jump" &&
		!view(jump).player.airborne &&
		view(jump).player.frame === 2;
	let settled = jump;
	for (let i = 0; i < Math.ceil(TUNING.landCrouchDuration / DT) + 2; i++) {
		settled = step(settled, DT, { jump: false });
	}
	const ridesAfterLanding = view(settled).player.pose === "ride";

	// Ride with no input until the first collision. The crash must then freeze
	// the sprite: the pose and frame the character died on stay put across
	// further dead steps, because there is no `dead` pose to switch to.
	let dead = settled;
	let deadSteps = 0;
	while (view(dead).phase !== "dead" && deadSteps < 100000) {
		dead = step(dead, DT, { jump: false });
		deadSteps++;
	}
	const deadPose = view(dead).player.pose;
	const deadFrame = view(dead).player.frame;
	let after = dead;
	let frozen = true;
	for (let i = 0; i < 60; i++) {
		after = step(after, DT, { jump: false });
		const frozenPlayer = view(after).player;
		if (frozenPlayer.pose !== deadPose || frozenPlayer.frame !== deadFrame) {
			frozen = false;
		}
	}
	const deadFreezes = frozen && view(after).phase === "dead";

	const pass =
		idleHoldsStill &&
		startsPush &&
		settlesRide &&
		pushStayedFrame0 &&
		pushDurationAccurate &&
		jumpStartsCrouched &&
		sawAirFrame &&
		landingCrouch &&
		ridesAfterLanding &&
		deadFreezes;
	return {
		name: "7. Pose model (static idle, push -> ride, jump phases, dead freeze)",
		pass,
		detail: `idle holds frame 0 with no world advance (groundOffset), player movement or obstacles for ${(8 * TUNING.frameDuration).toFixed(2)}s of steps: ${idleHoldsStill}; start pose=push: ${startsPush}; push held frame 0 for ${pushSeconds.toFixed(4)}s vs pushDuration=${TUNING.pushDuration} (within one DT): ${pushDurationAccurate} and static: ${pushStayedFrame0}; settled to ride: ${settlesRide}; jump crouch->air->crouch: takeoff frame 0 ${jumpStartsCrouched}, air frame 1 ${sawAirFrame}, landing frame 2 ${landingCrouch}; back to ride after the crouch: ${ridesAfterLanding}; no-input collision freezes ${deadPose}[${deadFrame}] for 60 further steps: ${deadFreezes} (collision after ${deadSteps} steps).`,
	};
}

// --- 5b. resize widening keeps the pending spawn fair ----------------------

/**
 * Assertion 5 checks that a resize preserves the run's snapshot, but at fixed
 * geometry: it never exercises the one horizontal quantity a resize changes.
 *
 * The pending spawn's gap is solved with `travelDistance = worldWidth +
 * spawnMargin - playerX`. If the band **widens** mid-run, the pending obstacle
 * has farther to travel and arrives faster, so the precomputed gap can fall a
 * few units short of `speedAtArrival * AIR_TIME + width`. Narrowing is
 * conservative, so this drives a widening between the first two spawns and
 * asserts the realized gap is still fair. The arrival speed is solved exactly
 * from `TUNING` rather than measured by finite difference, so the assertion is
 * not blurred by a timestep.
 */
function requiredGapFor(
	width: number,
	baseDistance: number,
	travelDistance: number,
): number {
	const maxGap = TUNING.maxSpeed * AIR_TIME + width;
	const unclamped =
		((TUNING.startSpeed + TUNING.speedRamp * (baseDistance + travelDistance)) *
			AIR_TIME +
			width) /
		(1 - TUNING.speedRamp * AIR_TIME);
	return Math.min(maxGap, unclamped);
}

function resizeWideningTest(): Assertion {
	const narrowWidth = 640;
	const wideWidth = 1280;
	const bandHeight = 190;

	let g = start(createGame({ seed: 58, bandHeight, canvasWidth: narrowWidth }));
	const playerX = view(g).player.x;
	const narrowTravel = view(g).worldWidth + TUNING.spawnMargin - playerX;

	let lastMaxX = Number.NEGATIVE_INFINITY;
	let spawnCount = 0;
	let prevSpawnDistance = 0;
	let result: {
		gap: number;
		width: number;
		spawnDistance: number;
		travel: number;
		arrivalSpeed: number;
		required: number;
		oldRequired: number;
	} | null = null;

	for (let i = 0; i < 200000 && result === null; i++) {
		g = step(g, DT, { jump: false });
		const s = view(g);
		let maxX = Number.NEGATIVE_INFINITY;
		let newest: (typeof s.obstacles)[number] | null = null;
		for (const o of s.obstacles) {
			if (o.x > maxX) {
				maxX = o.x;
				newest = o;
			}
		}
		// Obstacles only move left, so a rise in max x is a spawn.
		if (newest && maxX > lastMaxX + 1e-9) {
			spawnCount++;
			const spawnDistance = s.groundOffset;
			if (spawnCount === 1) {
				prevSpawnDistance = spawnDistance;
				// Widen before the pending (second) spawn fires. `lastMaxX` below
				// still records spawn 1's x, so the next step does not re-detect it.
				g = resize(g, { bandHeight, canvasWidth: wideWidth });
			} else if (spawnCount === 2) {
				const gap = spawnDistance - prevSpawnDistance;
				const travel = maxX - s.player.x;
				const arrivalDistance = spawnDistance + travel;
				const arrivalSpeed = Math.min(
					TUNING.maxSpeed,
					TUNING.startSpeed + TUNING.speedRamp * arrivalDistance,
				);
				result = {
					gap,
					width: newest.w,
					spawnDistance,
					travel,
					arrivalSpeed,
					required: arrivalSpeed * AIR_TIME + newest.w,
					oldRequired: requiredGapFor(
						newest.w,
						prevSpawnDistance,
						narrowTravel,
					),
				};
			}
		}
		lastMaxX = maxX;
	}

	if (!result) {
		return {
			name: "5b. Resize widening keeps the pending spawn fair",
			pass: false,
			detail: "no second spawn observed after the mid-run widening",
		};
	}

	const tolerance = 1e-9;
	const pass = result.gap >= result.required - tolerance;
	// The jitter on the pending gap survives the re-solve, so recovering it from
	// the realized gap lets us show what the un-resolved schedule would have done.
	const jitter = result.gap / result.required;
	const unresolvedGap = result.oldRequired * jitter;
	return {
		name: "5b. Resize widening keeps the pending spawn fair",
		pass,
		detail: `widened ${narrowWidth}->${wideWidth}px between spawn 1 (distance ${prevSpawnDistance.toFixed(2)}) and spawn 2; realized gap=${result.gap.toFixed(4)}u for ${result.width}u obstacle, arrival distance=${(result.spawnDistance + result.travel).toFixed(2)}, arrival speed=${result.arrivalSpeed.toFixed(3)}u/s => gap >= speedAtArrival * AIR_TIME + width is ${result.required.toFixed(4)}u, slack ${(result.gap - result.required).toFixed(4)}; resolution kept the jitter (${jitter.toFixed(3)}x). Without the re-solve the schedule would have produced ${unresolvedGap.toFixed(4)}u at the ${narrowTravel.toFixed(1)}u narrow travel distance => ${unresolvedGap >= result.required ? "still fair by luck of the jitter" : "short of the widened requirement"}.`,
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

// --- 8. obstacle candle art ------------------------------------------------

/**
 * The obstacle art is a pure layout (`obstacleCandleParts`) shared by the canvas
 * and the SVG preview, so it is checkable without a canvas. Drive the real
 * spawner to find one obstacle of every `(kind, width)` shape the exported
 * `OBSTACLE_SHAPES` advertises *and* every tint the art can draw, then assert for
 * every shape and every flame frame:
 *
 *   - `FLAME_VARIANTS` has exactly `OBSTACLE_FRAME_COUNT` entries and
 *     `WAX_COLORS` has exactly `OBSTACLE_TINT_COUNT`;
 *   - the seen `(kind, width)` set covers the expected set exactly — missing and
 *     unexpected shapes both fail, so a width-coverage regression cannot pass;
 *   - every tint from `[0, OBSTACLE_TINT_COUNT)` is actually produced by the
 *     seeded spawner, so the randomization is real and not a frozen constant;
 *   - every part is non-empty and stays inside the obstacle's horizontal
 *     footprint;
 *   - every full-width `wax` mass is `CANDLE_BODY_WIDTH` wide, so the candle
 *     width is constant across every shape;
 *   - every wax part (`CANDLE_BODY_ROLES`) spans exactly `[o.y, o.y + o.h]`;
 *   - every wax part's resolved colour is a member of `WAX_COLORS`, and adjacent
 *     candles in a multi-candle row never share a colour — the latter also proved
 *     at the palette level, so it holds for every row and not just this run;
 *   - consecutive full-width `wax` masses in a row are exactly `CANDLE_GAP`
 *     apart, derived from the exported constants;
 *   - every visible wax tone (`wax` and `shade`) clears 3:1 against the sky;
 *   - the wax union spans all but at most `(CANDLE_PITCH - 1) / 2` world units per
 *     side of the rect.
 *
 * No number here is hand-copied: the expected shapes come from the exported
 * `OBSTACLE_SHAPES`, the frame and tint counts from `runner.ts`, the palette,
 * reference background colours, gap/pitch and layout from the art module, and the
 * rects from the simulation.
 */

/** WCAG relative luminance of an sRGB hex colour, the module header's formula. */
function relativeLuminance(hex: string): number {
	const n = Number.parseInt(hex.slice(1), 16);
	const channel = (c: number): number => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return (
		0.2126 * channel((n >> 16) & 255) +
		0.7152 * channel((n >> 8) & 255) +
		0.0722 * channel(n & 255)
	);
}

/** WCAG contrast ratio between two sRGB hex colours. */
function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function obstacleArtTest(): Assertion {
	const problems: string[] = [];
	if (FLAME_VARIANTS.length !== OBSTACLE_FRAME_COUNT) {
		problems.push(
			`FLAME_VARIANTS ${FLAME_VARIANTS.length} != OBSTACLE_FRAME_COUNT ${OBSTACLE_FRAME_COUNT}`,
		);
	}
	if (FLAME_VARIANT_COUNT !== FLAME_VARIANTS.length) {
		problems.push(
			`FLAME_VARIANT_COUNT ${FLAME_VARIANT_COUNT} != FLAME_VARIANTS.length ${FLAME_VARIANTS.length}`,
		);
	}
	// The art indexes the wax palette by the simulation's tint, so the two counts
	// must agree or a tint could run past the end of the palette.
	if (WAX_COLORS.length !== OBSTACLE_TINT_COUNT) {
		problems.push(
			`WAX_COLORS ${WAX_COLORS.length} != OBSTACLE_TINT_COUNT ${OBSTACLE_TINT_COUNT}`,
		);
	}

	// Contrast: the documented requirement is that every visible wax tone (the
	// full-width `wax` mass and the `waxShade` edge) clears 3:1 against the hero
	// sky. Computed here from the palette itself so a future colour edit cannot
	// quietly dip below the floor; `wax` is the binding tone because it is the
	// brighter of the two and lightening cuts sky contrast. The reference sky and
	// ground tones come from the art module, not from hand-copied literals.
	const waxPalette = new Set<string>();
	let worstWaxSky = Number.POSITIVE_INFINITY;
	let worstWaxName = "";
	let worstWaxGround = Number.POSITIVE_INFINITY;
	for (const wax of WAX_COLORS) {
		for (const tone of ["wax", "shade"] as const) {
			const hex = wax[tone].toLowerCase();
			waxPalette.add(hex);
			const vsSky = contrastRatio(hex, CANDLE_CONTRAST_SKY);
			if (vsSky < 3 - 1e-9) {
				problems.push(
					`wax ${wax.name} ${tone} ${hex} vs sky ${vsSky.toFixed(2)} < 3:1`,
				);
			}
			if (tone === "wax") {
				if (vsSky < worstWaxSky) {
					worstWaxSky = vsSky;
					worstWaxName = `${wax.name} ${tone}`;
				}
				const vsGround = contrastRatio(hex, CANDLE_CONTRAST_GROUND);
				if (vsGround < worstWaxGround) worstWaxGround = vsGround;
			}
		}
	}

	// Adjacency is a property of the palette itself, not of one sampled run: the
	// per-candle offset steps the palette index by one, so a row could only repeat
	// a colour if two consecutive entries shared the same `wax` hex. Prove that for
	// every pair (including the wrap), so it holds for every row and every tint.
	for (let i = 0; i < WAX_COLORS.length; i++) {
		const j = (i + 1) % WAX_COLORS.length;
		if (WAX_COLORS[i].wax === WAX_COLORS[j].wax) {
			problems.push(
				`WAX_COLORS[${i}] (${WAX_COLORS[i].name}) and [${j}] (${WAX_COLORS[j].name}) share wax ${WAX_COLORS[i].wax}`,
			);
		}
	}

	// Expected (kind, width) shapes straight from the exported spawner table:
	// clusters are `blockW * n` for `n` in `blocksMin..blocksMax`, every other kind
	// uses its fixed `w`. This replaces the old hand-copied `clusterWidths.size === 3`
	// stop condition with one derived from the real table.
	const expectedShapes = new Set<string>();
	for (const [kind, shape] of Object.entries(OBSTACLE_SHAPES)) {
		const { blocksMin, blocksMax } = shape;
		if (blocksMin !== undefined && blocksMax !== undefined) {
			const blockW = shape.blockW ?? shape.w;
			for (let n = blocksMin; n <= blocksMax; n++) {
				expectedShapes.add(`${kind}:${blockW * n}`);
			}
		} else {
			expectedShapes.add(`${kind}:${shape.w}`);
		}
	}

	// One obstacle per (kind, width), collected from the real spawner, plus every
	// tint the run draws. Stop when the expected shape set is covered *and* every
	// tint has been seen, or after a step budget.
	let g = start(createGame({ seed: 1, bandHeight: 190, canvasWidth: 640 }));
	const seen = new Map<string, ObstacleArt>();
	const tintsSeen = new Set<number>();
	const maxSteps = 600000;
	let steps = 0;
	for (; steps < maxSteps; steps++) {
		g = step(g, DT, { jump: false });
		for (const o of view(g).obstacles) {
			const key = `${o.kind}:${o.w}`;
			if (!seen.has(key)) seen.set(key, { ...o });
			tintsSeen.add(o.tint);
		}
		const shapesCovered = [...expectedShapes].every((key) => seen.has(key));
		if (shapesCovered && tintsSeen.size >= OBSTACLE_TINT_COUNT) break;
	}

	if (tintsSeen.size < OBSTACLE_TINT_COUNT) {
		const missing = [];
		for (let t = 0; t < OBSTACLE_TINT_COUNT; t++) {
			if (!tintsSeen.has(t)) missing.push(t);
		}
		problems.push(
			`only ${tintsSeen.size}/${OBSTACLE_TINT_COUNT} tints observed (missing ${missing.join(", ")})`,
		);
	}

	const seenKeys = new Set(seen.keys());
	for (const key of expectedShapes) {
		if (!seenKeys.has(key)) problems.push(`missing (kind, width) shape ${key}`);
	}
	for (const key of seenKeys) {
		if (!expectedShapes.has(key)) {
			problems.push(`unexpected (kind, width) shape ${key}`);
		}
	}

	const tolerance = 0.01;
	// The documented sliver bound, derived rather than hard-coded: the constant
	// 2-unit candle width leaves at most one pitch minus a whole unit of leftover,
	// half of it per side. For the spawner's widths the worst case is 1.0 unit (at
	// w=4 and w=10; the others leave 0.5). Asserted so it can never silently grow.
	const sliverBound = (CANDLE_PITCH - 1) / 2;
	const bodyRoles = new Set(CANDLE_BODY_ROLES);
	let partCount = 0;
	let worstSliver = 0;
	for (const o of seen.values()) {
		for (let frame = 0; frame < OBSTACLE_FRAME_COUNT; frame++) {
			const label = `${o.kind}/w${o.w}/frame${frame}`;
			const parts = obstacleCandleParts({ ...o, frame });
			if (parts.length === 0) {
				problems.push(`${label}: no parts`);
				continue;
			}
			partCount += parts.length;

			// Wax colour: every candle's body colour must be in the palette, and
			// neighbouring candles in a multi-candle row must differ (the per-candle
			// tint offset is what guarantees it). The candle count is re-derived from the
			// exported gap/pitch, so a layout change that merges or drops a candle fails.
			const waxParts = parts
				.filter((p) => p.role === "wax")
				.sort((a, b) => a.x - b.x);
			const expectedCount = Math.max(
				1,
				Math.floor((o.w + CANDLE_GAP) / CANDLE_PITCH),
			);
			if (waxParts.length !== expectedCount) {
				problems.push(
					`${label}: ${waxParts.length} candles != expected ${expectedCount}`,
				);
			}
			for (let k = 0; k < waxParts.length; k++) {
				if (!waxPalette.has(waxParts[k].color.toLowerCase())) {
					problems.push(
						`${label}: candle ${k} wax colour ${waxParts[k].color} not in WAX_COLORS`,
					);
				}
				if (k > 0 && waxParts[k].color === waxParts[k - 1].color) {
					problems.push(
						`${label}: adjacent candles ${k - 1}/${k} share ${waxParts[k].color}`,
					);
				}
				if (k > 0) {
					// Gap: consecutive full-width masses are exactly CANDLE_GAP apart,
					// derived from the exported body width and gap, not assumed.
					const gap = waxParts[k].x - (waxParts[k - 1].x + CANDLE_BODY_WIDTH);
					if (Math.abs(gap - CANDLE_GAP) > tolerance) {
						problems.push(
							`${label}: gap between candles ${k - 1}/${k} ${gap.toFixed(3)} != CANDLE_GAP ${CANDLE_GAP}`,
						);
					}
				}
			}

			let waxMinX = Number.POSITIVE_INFINITY;
			let waxMaxX = Number.NEGATIVE_INFINITY;
			for (const p of parts) {
				if (p.w <= 0 || p.h <= 0) {
					problems.push(`${label}: ${p.role} is empty (${p.w}x${p.h})`);
				}
				if (p.x < o.x - tolerance || p.x + p.w > o.x + o.w + tolerance) {
					problems.push(
						`${label}: ${p.role} x ${p.x}..${p.x + p.w} outside ${o.x}..${o.x + o.w}`,
					);
				}
				if (p.role === "wax" && Math.abs(p.w - CANDLE_BODY_WIDTH) > tolerance) {
					problems.push(
						`${label}: wax mass w ${p.w} != CANDLE_BODY_WIDTH ${CANDLE_BODY_WIDTH}`,
					);
				}
				if (bodyRoles.has(p.role)) {
					if (
						Math.abs(p.y - o.y) > tolerance ||
						Math.abs(p.y + p.h - (o.y + o.h)) > tolerance
					) {
						problems.push(
							`${label}: ${p.role} y span ${p.y}..${p.y + p.h} != body ${o.y}..${o.y + o.h}`,
						);
					}
					if (p.x < waxMinX) waxMinX = p.x;
					if (p.x + p.w > waxMaxX) waxMaxX = p.x + p.w;
				}
			}
			if (waxMinX !== Number.POSITIVE_INFINITY) {
				const leftSliver = waxMinX - o.x;
				const rightSliver = o.x + o.w - waxMaxX;
				worstSliver = Math.max(worstSliver, leftSliver, rightSliver);
				if (leftSliver > sliverBound + tolerance) {
					problems.push(
						`${label}: left wax sliver ${leftSliver.toFixed(3)} > ${sliverBound}`,
					);
				}
				if (rightSliver > sliverBound + tolerance) {
					problems.push(
						`${label}: right wax sliver ${rightSliver.toFixed(3)} > ${sliverBound}`,
					);
				}
			}
		}
	}

	const pass = problems.length === 0;
	const shapes = [...seenKeys].sort();
	const kindsSeen = [
		...new Set([...seen.keys()].map((key) => key.split(":")[0])),
	].sort();
	const detail = problems.length
		? `${problems.slice(0, 8).join("; ")}${problems.length > 8 ? ` (+${problems.length - 8} more)` : ""}`
		: `FLAME_VARIANTS ${FLAME_VARIANTS.length} == OBSTACLE_FRAME_COUNT ${OBSTACLE_FRAME_COUNT}; WAX_COLORS ${WAX_COLORS.length} == OBSTACLE_TINT_COUNT ${OBSTACLE_TINT_COUNT}; (kind, width) coverage exact: ${seenKeys.size}/${expectedShapes.size} expected shapes from ${steps} sim steps (kinds: ${kindsSeen.join(", ")}; shapes: ${shapes.join(", ")}); all ${tintsSeen.size}/${OBSTACLE_TINT_COUNT} tints observed (${[...tintsSeen].sort((a, b) => a - b).join(", ")}); ${partCount} parts checked across every frame: non-empty, horizontally inside the obstacle, every full-width wax mass w=${CANDLE_BODY_WIDTH} (constant candle width), consecutive candles exactly CANDLE_GAP=${CANDLE_GAP} apart, every wax colour in the palette with adjacent candles always different and no consecutive palette entries sharing a wax hex, every wax part spans exactly [o.y, o.y+o.h], and the wax union leaves at most ${sliverBound}u undrawn per side (worst sliver ${worstSliver.toFixed(3)}u). Every visible wax tone (wax + shade) clears 3:1 vs sky (binding tone ${worstWaxName} ${worstWaxSky.toFixed(2)}:1); worst wax vs ground ${worstWaxGround.toFixed(2)}:1.`;
	return { name: "8. Obstacle candle art", pass, detail };
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
const resizeWidening = resizeWideningTest();
const verticalFit = verticalFitTest();
const pose = poseTest();
const obstacleArt = obstacleArtTest();
const requiredAssertions: Assertion[] = [
	purity,
	spacing,
	warning,
	...clearability,
	resizeAssertion,
	resizeWidening,
	verticalFit,
	pose,
	obstacleArt,
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
	`\nOverall (purity + spacing + warning + per-kind clearability + resize + vertical fit + pose model + obstacle candle art): ${allPass ? "PASS" : "FAIL"}`,
);
process.exitCode = allPass ? 0 : 1;
