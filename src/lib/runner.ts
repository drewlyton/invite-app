/**
 * Pure simulation for the hero runner game.
 *
 * This module has zero DOM, zero React and zero Node dependencies. All
 * randomness comes from the injected `seed`, so the same seed plus the same
 * input sequence always produces the same state. `step` never mutates its
 * arguments; it returns a new state.
 *
 * All geometry is in world units (one unit is one sprite pixel of the 22-unit
 * player) except `pixelScale`, which converts world units to CSS px at blit
 * time. The renderer's only read path is `view()`.
 */

export type Input = { jump: boolean };

export type Pose = "idle" | "run" | "dead";

export type ObstacleKind =
	| "ground-narrow"
	| "ground-wide"
	| "ground-cluster"
	| "flying-low"
	| "flying-mid"
	| "flying-high";

/** Rectangles are top-left + size in world units, matching ctx.fillRect. */
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Public face of a game. Everything else is private to this module: the
 * runtime object carries more fields, but the type only exposes these three so
 * the renderer cannot reach past `view()`.
 */
export type Game = {
	phase: "idle" | "running" | "dead";
	score: number;
	highScore: number;
};

/** The complete read surface available to the renderer. */
export type RenderState = {
	phase: Game["phase"];
	score: number;
	highScore: number;
	groundOffset: number;
	/**
	 * Geometry is part of the read surface because the renderer cannot blit
	 * anything without `pixelScale`, and it must not rediscover the world size
	 * by duplicating the formula below. (The spec's RenderState listing omitted
	 * these; see the prototype report.)
	 */
	pixelScale: number;
	worldWidth: number;
	worldHeight: number;
	groundY: number;
	player: Rect & { pose: Pose; frame: number; airborne: boolean };
	obstacles: (Rect & { kind: ObstacleKind; frame: number })[];
};

// ---------------------------------------------------------------------------
// Tuning constants.
//
// String-literal unions + const objects only: no `enum`, no `namespace`, so the
// module survives type-stripping tooling.
// ---------------------------------------------------------------------------

/**
 * Tuning constants. Exported so the scratch harness computes its assertions
 * and its readout from the real values instead of a hand-copied mirror; a
 * stale mirror is what produced the misleading `MIN_WORLD_WIDTH` caveat last
 * round.
 */
export const TUNING = {
	// World geometry (spec: "Starting values").
	targetWorldHeight: 95,
	minWorldWidth: 260,
	pixelScaleMin: 1.5,
	pixelScaleMax: 3,
	groundMargin: 4,

	// Player. Jump-only: there is no duck pose and no duck hitbox.
	playerWidth: 16,
	playerHeight: 22,
	playerX: 8,
	hitboxInset: 0.2,

	// Physics. Tuning round 1: airtime cut to ~0.85x at roughly constant apex by
	// scaling velocity and gravity together (v' = v/k, g' = g/k^2, k = 0.85).
	gravity: 1384,
	jumpVelocity: -353,

	// Speed ramp: speed increases linearly with distance.
	startSpeed: 90,
	maxSpeed: 280,
	speedRamp: 0.05, // (units/s) per world unit
	scoreUnit: 10, // score = floor(distance / scoreUnit)

	// Spawning / fairness.
	spawnMargin: 8,
	gapJitterMax: 2,
	reactionBudget: 0.25,

	// Integration guard: a huge dt must not tunnel obstacles through the player.
	maxDt: 0.05,

	// Animation.
	frameDuration: 0.1,
} as const;

/** Full tuning shape, with plain `number` values so debug knobs can override. */
export type Tuning = { -readonly [K in keyof typeof TUNING]: number };

/**
 * Nominal (continuous) time from leaving the ground to landing again, in
 * seconds (~0.51 after tuning round 1). Exported so the harness asserts against
 * the number the spawner actually uses rather than a stale copy.
 */
export const AIR_TIME = (2 * Math.abs(TUNING.jumpVelocity)) / TUNING.gravity;

/** Nominal airtime for an arbitrary tuning, for the debug page's per-run knobs. */
function airTimeFor(tuning: Tuning): number {
	return (2 * Math.abs(tuning.jumpVelocity)) / tuning.gravity;
}

type ObstacleShape = {
	/** Clearance of the obstacle's bottom edge above the ground line. */
	bottom: number;
	h: number;
	w: number;
	blockW?: number;
	blocksMin?: number;
	blocksMax?: number;
};

/**
 * Sizes are clearances above the ground line, re-derived for jump-only play
 * (there is no duck pose any more). The standing hitbox spans 4.4-17.6 units
 * and the jump apex puts the hitbox bottom at ~49.4 units, so:
 *
 *   must jump => bottom < 17.6 (the standing box collides) AND top < 49.4
 *               (the box clears the obstacle at the apex)
 *   run under => bottom > 17.6 (the standing box passes underneath)
 *
 * Widths are not pinned down by the spec; the values here are the prototype's
 * choice (see report).
 */
const OBSTACLE_SHAPES: Record<ObstacleKind, ObstacleShape> = {
	"ground-narrow": { bottom: 0, h: 10, w: 4 },
	"ground-wide": { bottom: 0, h: 16, w: 10 },
	"ground-cluster": {
		bottom: 0,
		h: 16,
		w: 3,
		blockW: 3,
		blocksMin: 1,
		blocksMax: 3,
	},
	"flying-low": { bottom: 4, h: 14, w: 6 },
	"flying-mid": { bottom: 12, h: 14, w: 6 },
	"flying-high": { bottom: 28, h: 14, w: 6 },
};

const OBSTACLE_KINDS: readonly ObstacleKind[] = [
	"ground-narrow",
	"ground-wide",
	"ground-cluster",
	"flying-low",
	"flying-mid",
	"flying-high",
];

// ---------------------------------------------------------------------------
// Private state
// ---------------------------------------------------------------------------

type PlayerState = {
	x: number;
	y: number;
	vy: number;
	airborne: boolean;
	pose: Pose;
	frame: number;
	frameTime: number;
	/** Previous frame's jump input, so a held key is one jump, not bunny-hopping. */
	jumpHeld: boolean;
};

type ObstacleState = {
	kind: ObstacleKind;
	x: number;
	y: number;
	w: number;
	h: number;
	frame: number;
	frameTime: number;
};

type Geometry = {
	pixelScale: number;
	worldWidth: number;
	worldHeight: number;
	groundY: number;
};

type GameState = Game & {
	seed: number;
	rng: number;
	tuning: Tuning;
	bandHeight: number;
	canvasWidth: number;
	playerX: number;
	player: PlayerState;
	obstacles: ObstacleState[];
	distance: number;
	nextSpawnDistance: number;
	nextKind: ObstacleKind;
	nextWidth: number;
} & Geometry;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
	return value < min ? min : value > max ? max : value;
}

function computeGeometry(bandHeight: number, canvasWidth: number): Geometry {
	// Both terms are UPPER bounds on pixelScale, so take the min:
	//   bandHeight / targetWorldHeight  -> guarantees worldHeight >= target (vertical fit)
	//   canvasWidth / minWorldWidth     -> guarantees worldWidth  >= min   (reaction time)
	// Using max() here picks the larger scale and breaks both, which is the bug
	// the prototype caught in the spec.
	const pixelScale = clamp(
		Math.min(
			bandHeight / TUNING.targetWorldHeight,
			canvasWidth / TUNING.minWorldWidth,
		),
		TUNING.pixelScaleMin,
		TUNING.pixelScaleMax,
	);
	return {
		pixelScale,
		worldHeight: bandHeight / pixelScale,
		worldWidth: canvasWidth / pixelScale,
		groundY: bandHeight / pixelScale - TUNING.groundMargin,
	};
}

/** mulberry32, threaded by explicit state so `step` stays pure and cloneable. */
function rngNext(rng: number): { value: number; rng: number } {
	const t = (rng + 0x6d2b79f5) >>> 0;
	let r = t;
	r = Math.imul(r ^ (r >>> 15), r | 1);
	r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
	return { value: ((r ^ (r >>> 14)) >>> 0) / 4294967296, rng: t };
}

/** Speed is a linear ramp over distance, capped at maxSpeed. */
function speedAtDistance(distance: number, tuning: Tuning): number {
	return Math.min(
		tuning.maxSpeed,
		tuning.startSpeed + tuning.speedRamp * distance,
	);
}

/**
 * Fairness constraint 1 + 2: the gap before the *next* obstacle must cover a
 * full jump arc at the speed the player will actually have when that obstacle
 * arrives, not the speed at spawn time.
 *
 * The spec suggests a two-pass fixed point over `t = gap / speed`. Because the
 * ramp is linear in distance, `gap = arrivalSpeed * AIR_TIME + width` is a
 * linear equation in `gap` and is solved exactly here instead of iterated. The
 * spec's time-based form under-estimates the arrival speed (it ramps over the
 * gap rather than over the whole travel to the player), which the spacing
 * assertion catches; see the prototype report.
 */
function requiredGap(
	width: number,
	distanceAtPreviousSpawn: number,
	travelDistance: number,
	tuning: Tuning,
): number {
	const airTime = airTimeFor(tuning);
	const maxGap = tuning.maxSpeed * airTime + width;
	const k = tuning.speedRamp;
	const denom = 1 - k * airTime;
	const unclamped =
		((tuning.startSpeed + k * (distanceAtPreviousSpawn + travelDistance)) *
			airTime +
			width) /
		denom;
	return Math.min(maxGap, unclamped);
}

function chooseObstacle(rng: number): {
	kind: ObstacleKind;
	width: number;
	rng: number;
} {
	const kindDraw = rngNext(rng);
	const index = Math.min(
		OBSTACLE_KINDS.length - 1,
		Math.floor(kindDraw.value * OBSTACLE_KINDS.length),
	);
	const kind = OBSTACLE_KINDS[index];
	const shape = OBSTACLE_SHAPES[kind];
	let width = shape.w;
	let nextRng = kindDraw.rng;
	if (kind === "ground-cluster") {
		const blocksMin = shape.blocksMin ?? 1;
		const blocksMax = shape.blocksMax ?? blocksMin;
		const blockDraw = rngNext(nextRng);
		const blocks =
			blocksMin + Math.floor(blockDraw.value * (blocksMax - blocksMin + 1));
		width = blocks * (shape.blockW ?? shape.w);
		nextRng = blockDraw.rng;
	}
	return { kind, width, rng: nextRng };
}

function makePlayer(groundY: number, playerX: number, pose: Pose): PlayerState {
	return {
		x: playerX,
		y: groundY - TUNING.playerHeight,
		vy: 0,
		airborne: false,
		pose,
		frame: 0,
		frameTime: 0,
		jumpHeld: false,
	};
}

function makeObstacle(
	groundY: number,
	kind: ObstacleKind,
	width: number,
	spawnX: number,
): ObstacleState {
	const shape = OBSTACLE_SHAPES[kind];
	return {
		kind,
		x: spawnX,
		y: groundY - shape.bottom - shape.h,
		w: width,
		h: shape.h,
		frame: 0,
		frameTime: 0,
	};
}

/** ~20% inset per side on the player's drawn box. */
function playerHitbox(player: PlayerState): Rect {
	const h = TUNING.playerHeight;
	const ix = TUNING.playerWidth * TUNING.hitboxInset;
	const iy = h * TUNING.hitboxInset;
	return {
		x: player.x + ix,
		y: player.y + iy,
		w: TUNING.playerWidth - 2 * ix,
		h: h - 2 * iy,
	};
}

function overlaps(a: Rect, b: Rect): boolean {
	return (
		a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
	);
}

function advanceFrame(
	frame: number,
	frameTime: number,
	dt: number,
): { frame: number; frameTime: number } {
	let time = frameTime + dt;
	let next = frame;
	while (time >= TUNING.frameDuration) {
		time -= TUNING.frameDuration;
		next = (next + 1) % 2;
	}
	return { frame: next, frameTime: time };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createGame(
	opts: {
		highScore?: number;
		seed?: number;
		bandHeight?: number;
		canvasWidth?: number;
		/** Per-run overrides for the debug page's query-param knobs. */
		tuning?: Partial<Tuning>;
	} = {},
): Game {
	const seed = (opts.seed ?? 1) >>> 0;
	const bandHeight = opts.bandHeight ?? 190;
	const canvasWidth = opts.canvasWidth ?? 640;
	const tuning: Tuning = { ...TUNING, ...opts.tuning };
	const geometry = computeGeometry(bandHeight, canvasWidth);
	const first = chooseObstacle(seed);
	const state: GameState = {
		phase: "idle",
		score: 0,
		highScore: opts.highScore ?? 0,
		seed,
		rng: first.rng,
		tuning,
		bandHeight,
		canvasWidth,
		playerX: TUNING.playerX,
		player: makePlayer(geometry.groundY, TUNING.playerX, "idle"),
		obstacles: [],
		distance: 0,
		nextSpawnDistance: 0,
		nextKind: first.kind,
		nextWidth: first.width,
		...geometry,
	};
	return state;
}

function beginRun(g: GameState): GameState {
	const first = chooseObstacle(g.seed);
	return {
		...g,
		phase: "running",
		score: 0,
		rng: first.rng,
		player: makePlayer(g.groundY, g.playerX, "run"),
		obstacles: [],
		distance: 0,
		nextSpawnDistance: 0,
		nextKind: first.kind,
		nextWidth: first.width,
	};
}

export function start(game: Game): Game {
	const g = game as GameState;
	if (g.phase !== "idle") return { ...g };
	return beginRun(g);
}

export function restart(game: Game): Game {
	const g = game as GameState;
	if (g.phase !== "dead") return { ...g };
	return beginRun(g);
}

function stepPlayer(g: GameState, dt: number, input: Input): PlayerState {
	const p = g.player;
	const running = g.phase === "running";
	const jumpPressed = running && input.jump && !p.jumpHeld && !p.airborne;

	let vy = p.vy;
	let y = p.y;
	let airborne = p.airborne;

	if (jumpPressed) {
		vy = g.tuning.jumpVelocity;
		airborne = true;
	}

	if (airborne) {
		vy += g.tuning.gravity * dt;
		y += vy * dt;
		const groundTop = g.groundY - TUNING.playerHeight;
		if (y >= groundTop) {
			y = groundTop;
			vy = 0;
			airborne = false;
		}
	} else {
		y = g.groundY - TUNING.playerHeight;
	}

	let pose: Pose;
	if (g.phase === "dead") {
		pose = "dead";
	} else if (airborne) {
		pose = "run";
	} else if (running) {
		pose = "run";
	} else {
		pose = "idle";
	}

	const animated =
		pose === "run"
			? advanceFrame(p.frame, p.frameTime, dt)
			: { frame: 0, frameTime: 0 };

	return {
		x: g.playerX,
		y,
		vy,
		airborne,
		pose,
		frame: animated.frame,
		frameTime: animated.frameTime,
		jumpHeld: input.jump,
	};
}

/**
 * Advance the simulation by `dt` seconds. Pure: `game` is never mutated and a
 * new state is returned.
 *
 * Note on the `dead` phase: the world keeps integrating (obstacles keep
 * scrolling, the speed ramp and the spawner keep running) even after a
 * collision. That is what lets a harness observe the spawn algorithm across the
 * whole speed range without an autopilot. The island's rAF loop is what stops
 * on death; `step` itself stays a pure function of the whole world.
 */
export function step(game: Game, dt: number, input: Input): Game {
	const g = game as GameState;
	const stepDt = clamp(dt, 0, TUNING.maxDt);
	if (g.phase === "idle" || stepDt === 0) return { ...g };

	const speed = speedAtDistance(g.distance, g.tuning);
	const distance = g.distance + speed * stepDt;
	const move = speed * stepDt;

	const player = stepPlayer(g, stepDt, input);

	let obstacles: ObstacleState[] = g.obstacles.map((o) => {
		const animated = advanceFrame(o.frame, o.frameTime, stepDt);
		return {
			...o,
			x: o.x - move,
			frame: animated.frame,
			frameTime: animated.frameTime,
		};
	});
	obstacles = obstacles.filter((o) => o.x + o.w > 0);

	let rng = g.rng;
	let nextSpawnDistance = g.nextSpawnDistance;
	let nextKind = g.nextKind;
	let nextWidth = g.nextWidth;
	const spawnX = g.worldWidth + TUNING.spawnMargin;

	// One spawn per step is safe: even at max speed and maxDt the world moves
	// ~13 units per step, far less than the smallest fair gap (~60 units).
	if (distance >= nextSpawnDistance) {
		obstacles.push(makeObstacle(g.groundY, nextKind, nextWidth, spawnX));
		const spawnDistance = distance;
		const chosen = chooseObstacle(rng);
		rng = chosen.rng;
		nextKind = chosen.kind;
		nextWidth = chosen.width;
		const jitterDraw = rngNext(rng);
		rng = jitterDraw.rng;
		const jitter = 1 + jitterDraw.value * (TUNING.gapJitterMax - 1);
		nextSpawnDistance =
			spawnDistance +
			requiredGap(chosen.width, spawnDistance, spawnX - g.playerX, g.tuning) *
				jitter;
	}

	let phase: Game["phase"] = g.phase;
	let score = g.score;
	let highScore = g.highScore;

	if (phase === "running") {
		score = Math.floor(distance / TUNING.scoreUnit);
		const hits = obstacles.some((o) => overlaps(playerHitbox(player), o));
		if (hits) {
			phase = "dead";
			highScore = Math.max(highScore, score);
			player.pose = "dead";
			player.frame = 0;
		}
	}

	const next: GameState = {
		...g,
		phase,
		score,
		highScore,
		player,
		obstacles,
		distance,
		nextSpawnDistance,
		nextKind,
		nextWidth,
		rng,
	};
	return next;
}

export function view(game: Game): RenderState {
	const g = game as GameState;
	const playerPose = g.player.pose;
	return {
		phase: g.phase,
		score: g.score,
		highScore: g.highScore,
		groundOffset: g.distance,
		pixelScale: g.pixelScale,
		worldWidth: g.worldWidth,
		worldHeight: g.worldHeight,
		groundY: g.groundY,
		player: {
			x: g.player.x,
			y: g.player.y,
			w: TUNING.playerWidth,
			h: TUNING.playerHeight,
			pose: playerPose,
			frame: g.player.frame,
			airborne: g.player.airborne,
		},
		obstacles: g.obstacles.map((o) => ({
			x: o.x,
			y: o.y,
			w: o.w,
			h: o.h,
			kind: o.kind,
			frame: o.frame,
		})),
	};
}

/**
 * Collision-debug + harness read path. The player box is inset; drawing from
 * this produces visibly wrong shapes. Index 0 is the player, the rest are
 * obstacles in the same order as `view().obstacles`.
 */
export function hitboxes(game: Game): Rect[] {
	const g = game as GameState;
	return [
		playerHitbox(g.player),
		...g.obstacles.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h })),
	];
}
