import type { CSSProperties } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
	createGame,
	type Game,
	type Pose,
	resize,
	restart,
	start,
	step,
	TUNING,
	view,
} from "../lib/runner";
import {
	GROUND_FILL_ALPHA,
	GROUND_TEXTURE,
	GROUND_TEXTURE_ALPHA,
	GROUND_TEXTURE_DASH_HEIGHT,
	GROUND_TEXTURE_TILE_HEIGHT,
	GROUND_TEXTURE_TILE_WIDTH,
	groundTextureCssUrl,
	resolveGroundColor,
	resolveGroundFarColor,
} from "../lib/runner-ground";
import { drawObstacle } from "../lib/runner-obstacles";
import {
	drawPlayerFrame,
	PLAYER_DEAD_ALPHA,
	PLAYER_FRAMES,
} from "../lib/runner-sprites";
import { deadStatus, IDLE_STATUS, runningStatus } from "../lib/runner-status";
import type { ScoreEntry } from "../lib/scores";
import Leaderboard, { type BoardState } from "./Leaderboard";

interface Props {
	eventId: string;
	color: string;
	ground?: string;
	groundFar?: string;
}

type Phase = Game["phase"];

/** Fixed simulation step. Physics must not depend on the display refresh rate. */
const FIXED_DT = 1 / 120;
/** Upper bound on a single frame's dt, so a long pause cannot tunnel obstacles. */
const MAX_FRAME_DT = 0.25;

const INTERACTIVE_SELECTOR =
	"a, button, input, select, textarea, [contenteditable]";

/**
 * The ground line's thickness, in CSS px — deliberately not in world units.
 * It marks where the ground meets the sky, so it stays a hairline at every
 * `pixelScale` instead of thickening with the world. Named once because the
 * canvas and the server-rendered placeholder both draw it.
 */
const GROUND_LINE_HEIGHT = 2;

/**
 * The band's height as a CSS length, exposed as `--band-h` on the band. Single
 * source for the band's own height and for the server-rendered placeholder's
 * `--ps` scale, so the two cannot drift.
 */
const BAND_HEIGHT = "clamp(160px, 22svh, 200px)";

/**
 * The live `pixelScale` as a CSS length in px, derived from `--band-h` and the
 * viewport width with the same formula `runner.ts` uses for `view().pixelScale`
 * (including its clamps). The server-rendered placeholder (see the JSX) shares
 * it so its ground line and player land exactly where the canvas will draw them
 * — a `100vw` stand-in for the band width, which only differs by a scrollbar and
 * only matters when the width term binds (narrow, i.e. scrollbar-less, mobile).
 */
const PIXEL_SCALE_CSS = `clamp(${TUNING.pixelScaleMin}px, min(calc(var(--band-h) / ${TUNING.targetWorldHeight}), calc(100vw / ${TUNING.minWorldWidth})), ${TUNING.pixelScaleMax}px)`;

/**
 * The runner hero island.
 *
 * Everything drawn comes from `view(game)`; nothing in this file reads Game
 * internals. The simulation is pure, so the only mutable state here is the
 * clock, the DOM sizing and the list of currently held keys. The score is
 * written straight to the hero's status element, so React does not re-render
 * during play — React state only covers the dialog and the reduced-motion
 * `interactive` flag.
 */
export default function RunnerGame({
	eventId,
	color,
	ground,
	groundFar,
}: Props) {
	const bandRef = useRef<HTMLDivElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const [interactive, setInteractive] = useState(false);
	// False until the canvas has painted its first full scene; until then the
	// server-rendered placeholder stands in for it (see the band markup).
	const [sceneDrawn, setSceneDrawn] = useState(false);
	const hintId = useId();
	const groundColor = resolveGroundColor(ground, color);
	// The far end of the canvas ground gradient and the below-fold section's
	// tint. The resolver's fallback to the near ink is what keeps a theme without
	// `groundFar` on the flat fill it had before the field existed.
	const groundFarColor = resolveGroundFarColor(groundFar, groundColor);
	// CSS mirror of the canvas ground gradient, also for the placeholder: the
	// near ink at the ground line and the far ink at the band's bottom, each at
	// `GROUND_FILL_ALPHA` over the hero background. Because both stops carry the
	// same alpha, this is the same colour at every y as the canvas's interpolate-
	// then-composite, which is what makes the handover invisible.
	const groundFillGradient = `linear-gradient(to bottom, color-mix(in srgb, ${groundColor} calc(${GROUND_FILL_ALPHA} * 100%), transparent), color-mix(in srgb, ${groundFarColor} calc(${GROUND_FILL_ALPHA} * 100%), transparent))`;

	const [leaderboardOpen, setLeaderboardOpen] = useState(false);
	const [board, setBoard] = useState<BoardState>({ status: "loading" });
	const [pendingScore, setPendingScore] = useState<number | null>(null);
	const openButtonRef = useRef<HTMLButtonElement | null>(null);
	/**
	 * How the dialog was opened, so closing can return focus where the keyboard
	 * user left off: the trigger on a button open, the band on a game-over open
	 * (where `Space` means retry).
	 */
	const openSourceRef = useRef<"band" | "button">("button");
	/**
	 * The personal best **as it was when the current run started**.
	 *
	 * This cannot be read from `view(game).highScore` at death: `step` bumps the
	 * high score *during play*, so by then it already equals the new score. A
	 * `final > highScore` check is false both when a record is set (equal) and
	 * when it is not (lower), and the dialog would never open at all. `press`
	 * snapshots just before `start()`/`restart()`, and the death path compares
	 * the final score against the snapshot. The live bumping is correct for the
	 * status line and is deliberately untouched.
	 */
	const runBestRef = useRef(0);

	// Prefetch the board once on mount and hold it in memory, so opening the
	// dialog shows no loading flash. A skeleton is for a genuine cold fetch only.
	// The endpoint is never allowed to break anything: a failure just becomes the
	// board region's error state, which carries its own retry.
	const loadBoard = useCallback(async (): Promise<void> => {
		setBoard({ status: "loading" });
		try {
			const response = await fetch(`/api/scores/${eventId}`);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = (await response.json()) as { board?: ScoreEntry[] };
			setBoard({ status: "ready", board: data.board ?? [] });
		} catch {
			setBoard({ status: "error" });
		}
	}, [eventId]);

	useEffect(() => {
		void loadBoard();
	}, [loadBoard]);

	// Bind the hero's HIGH SCORES button regardless of `interactive`: viewing the
	// standings is not play, so it must keep working under reduced motion, where
	// the band is `tabindex="-1"` and the game is off. The button is
	// server-rendered in Invite.astro and found by attribute, the same idiom as
	// `[data-hero]` and `[data-parallax]`.
	useEffect(() => {
		const hero = bandRef.current?.closest("[data-hero]");
		const button = hero?.querySelector<HTMLButtonElement>(
			"[data-leaderboard-open]",
		);
		if (!button) return;
		openButtonRef.current = button;
		const onClick = (): void => {
			openSourceRef.current = "button";
			setLeaderboardOpen(true);
		};
		button.addEventListener("click", onClick);
		return () => {
			button.removeEventListener("click", onClick);
			openButtonRef.current = null;
		};
	}, []);

	// Escape and the close button both land here. Focus routes by how the dialog
	// was opened: the band after a game-over open, so `Space` still means retry,
	// and the trigger button after a button open. Dismissing also forfeits the
	// pending score — it is cleared here and never re-offered.
	const closeLeaderboard = useCallback((): void => {
		setLeaderboardOpen(false);
		setPendingScore(null);
		const target =
			openSourceRef.current === "band"
				? bandRef.current
				: openButtonRef.current;
		target?.focus({ preventScroll: true });
	}, []);

	useEffect(() => {
		const band = bandRef.current;
		const canvas = canvasRef.current;
		if (!band || !canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// The player art is much larger than the 16x22 world box it is drawn into,
		// so enable the high-quality downscale path. The ground and obstacles are
		// vector rects and are unaffected by these settings.
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";

		// Player frames, loaded once for the life of the island. Held in a closure,
		// not React state, so playing never re-renders the component. Every frame
		// must decode before the canvas replaces the server-rendered placeholder,
		// so the swap can never expose a partial scene.
		const playerImages: Partial<Record<Pose, HTMLImageElement[]>> = {};
		const pending: Promise<unknown>[] = [];
		for (const [pose, urls] of Object.entries(PLAYER_FRAMES) as [
			Pose,
			readonly string[],
		][]) {
			playerImages[pose] = urls.map((url) => {
				const image = new Image();
				image.decoding = "async";
				image.src = url;
				// `decode()` resolves once the frame is drawable; a failed frame
				// resolves too, so one bad file cannot strand the placeholder.
				pending.push(image.decode().catch(() => undefined));
				return image;
			});
		}

		// Set once every frame is decoded; `draw` is a no-op until then, so the
		// canvas never paints a half-drawn scene behind the placeholder.
		let sceneReady = false;

		// Read the media query inside the effect: the component is still
		// server-rendered, where matchMedia does not exist.
		const reduced = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		setInteractive(!reduced);

		const readHighScore = (): number => {
			try {
				const raw = window.localStorage.getItem(`runner:hi:${eventId}`);
				const parsed = raw ? Number.parseInt(raw, 10) : 0;
				return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
			} catch {
				return 0;
			}
		};

		const persistHighScore = (value: number): void => {
			try {
				window.localStorage.setItem(`runner:hi:${eventId}`, String(value));
			} catch {
				// Private browsing / quota. A lost high score is not worth an error.
			}
		};

		const measure = (): {
			bandHeight: number;
			cssWidth: number;
			dpr: number;
		} => {
			const rect = band.getBoundingClientRect();
			return {
				bandHeight: Math.max(1, Math.round(rect.height)),
				cssWidth: Math.max(1, Math.round(rect.width)),
				dpr: Math.min(window.devicePixelRatio || 1, 2),
			};
		};

		let { bandHeight, cssWidth, dpr } = measure();

		let game: Game = createGame({
			bandHeight,
			canvasWidth: cssWidth,
			seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
			highScore: readHighScore(),
		});

		let raf = 0;
		let lastTime = 0;
		let accumulator = 0;
		let paused = document.hidden;
		let inView = true;
		let pointerJump = false;
		const held = new Set<string>();

		// --- Player-driven sky parallax ------------------------------------
		// Clouds keep a CSS ambient drift on their outer element, so they move
		// while the game is idle and no rAF loop is running. Stars have no such
		// animation: they are stationary until the player moves. Either way, this
		// code only ever writes the inner strip's transform, and it accumulates the
		// player's travel incrementally: recomputing from the absolute groundOffset
		// would snap every layer the moment pixelScale changed on resize.
		type ParallaxLayer = {
			strip: HTMLElement;
			rate: number;
			period: number;
			offset: number;
		};

		const heroHost =
			(band.closest("[data-hero]") as HTMLElement | null) ?? band;
		// The hero's single status line, server-rendered in Invite.astro and found
		// by attribute (the same idiom as `[data-leaderboard-open]`). The idle
		// prompt already ships in the HTML; every later value is written straight
		// to `textContent` from the rAF loop, with `lastStatus` skipping writes when
		// the formatted score has not changed. No React state, so play never
		// re-renders the island, and no `aria-live` — a constantly updating score
		// would chatter at a screen reader.
		const statusEl = heroHost.querySelector<HTMLElement>(
			"[data-runner-status]",
		);
		let lastStatus = statusEl?.textContent ?? "";
		const writeStatus = (text: string): void => {
			if (!statusEl || text === lastStatus) return;
			statusEl.textContent = text;
			lastStatus = text;
		};
		// The hero carries a single `data-phase` attribute ("idle" | "running" |
		// "dead"). Its only CSS consumer is `.hero-sky-strip` in Invite.astro, which
		// promotes the strips to compositor layers while `running`. The other values
		// have no rule of their own but are kept so the attribute states the real
		// phase rather than degrading into a `running` boolean.
		const setPhaseAttr = (next: Phase): void => {
			heroHost.dataset.phase = next;
		};
		let parallaxLayers: ParallaxLayer[] = [];
		let prevGroundOffset = 0;

		const applyParallax = (): void => {
			for (const layer of parallaxLayers) {
				// A zero offset means "no travel yet": leave the transform off
				// entirely so an idle layer carries no transform, not a no-op one.
				layer.strip.style.transform =
					layer.offset === 0 ? "" : `translateX(${-layer.offset}px)`;
			}
		};

		const measureParallax = (): void => {
			if (reduced) {
				parallaxLayers = [];
				return;
			}
			// Preserve the current offsets across a resize; only the wrap period
			// (one section width) is re-measured.
			const offsets = new Map(
				parallaxLayers.map((layer) => [layer.strip, layer.offset]),
			);
			const next: ParallaxLayer[] = [];
			for (const el of heroHost.querySelectorAll<HTMLElement>(
				"[data-parallax]",
			)) {
				const rate = Number.parseFloat(el.dataset.parallax ?? "");
				if (!Number.isFinite(rate) || rate <= 0) continue;
				const strip = el.querySelector<HTMLElement>("[data-parallax-strip]");
				const section = strip?.firstElementChild;
				if (!strip || !(section instanceof HTMLElement)) continue;
				// One section is the wrap period: the strip is identical every
				// section, so wrapping there cannot produce a seam.
				const period = section.getBoundingClientRect().width;
				if (period <= 0) continue;
				next.push({ strip, rate, period, offset: offsets.get(strip) ?? 0 });
			}
			parallaxLayers = next;
			applyParallax();
		};

		const advanceParallax = (
			groundOffset: number,
			pixelScale: number,
		): void => {
			const delta = (groundOffset - prevGroundOffset) * pixelScale;
			for (const layer of parallaxLayers) {
				const raw = layer.offset + delta * layer.rate;
				layer.offset = ((raw % layer.period) + layer.period) % layer.period;
			}
			prevGroundOffset = groundOffset;
			applyParallax();
		};

		const resyncParallax = (): void => {
			// A restart zeroes groundOffset. Re-point the baseline at it so the next
			// running frame computes a small delta, but keep the accumulated offsets
			// so the sky holds position across the transition instead of snapping
			// back to the section origin.
			prevGroundOffset = view(game).groundOffset;
		};

		/**
		 * The ground's vertical gradient, cached across frames: `draw()` runs on
		 * every rAF frame, and a `createLinearGradient` per frame would allocate on
		 * the hot path. It encodes the ground line (`view(game).groundY *
		 * pixelScale`) and the band's bottom, so it is rebuilt only when that
		 * geometry changes — at startup and after `resize()`, the two places
		 * `groundY` moves. `null` when the far ink is not distinct, where the fill
		 * stays the plain `groundColor` string and nothing is allocated at all.
		 */
		let groundGradient: CanvasGradient | null = null;

		const refreshGroundFill = (): void => {
			groundGradient = null;
			if (groundFarColor === groundColor) return;
			const s = view(game);
			// The gradient spans exactly the filled band — the ground line to the
			// band's bottom, which is the hero's bottom edge — so its far stop is
			// the colour the below-fold section paints at that boundary.
			const gradient = ctx.createLinearGradient(
				0,
				s.groundY * s.pixelScale,
				0,
				bandHeight,
			);
			gradient.addColorStop(0, groundColor);
			gradient.addColorStop(1, groundFarColor);
			groundGradient = gradient;
		};

		const applyCanvasSize = (): void => {
			canvas.width = Math.round(cssWidth * dpr);
			canvas.height = Math.round(bandHeight * dpr);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		};

		const draw = (): void => {
			// The band shows its server-rendered placeholder until every frame is
			// decoded (see `pending`); painting earlier would show a partial scene.
			if (!sceneReady) return;
			const s = view(game);
			const px = s.pixelScale;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			// Transparent, so the hero's own background shows through.
			ctx.clearRect(0, 0, cssWidth, bandHeight);

			// Ground: a fill from the ground line down to the bottom of the band, with a
			// solid line along its top edge. Raising the ground line with
			// `TUNING.groundMargin` would otherwise leave dead space beneath
			// it; the fill makes that region read as ground. The fill is the cached
			// `groundGradient` (near ink at the ground line, far ink at the band's
			// bottom) when the theme sets a distinct far ink, and the flat
			// `groundColor` otherwise. The alpha is the mix ratio that composites
			// the ink over the hero's `heroBg`, which is what puts the near end on a
			// mid grey a step *lighter* than the player sprite rather than on the
			// sprite's own value (see `GROUND_FILL_ALPHA`), and it stays below 1 so the
			// shared `GROUND_TEXTURE` dashes drawn on top still read. The value is
			// shared with the below-fold details section so both read as one ground.
			const groundTop = s.groundY * px;
			ctx.fillStyle = groundGradient ?? groundColor;
			ctx.globalAlpha = GROUND_FILL_ALPHA;
			ctx.fillRect(0, groundTop, cssWidth, bandHeight - groundTop);
			ctx.globalAlpha = 1;
			// The ground line and the dirt dashes deliberately keep the near ink rather
			// than the gradient: the band's far end is light, and the grain has to
			// read against both ends. The fill above may have left `fillStyle` on
			// the gradient, so put the near ink back before they draw.
			ctx.fillStyle = groundColor;

			// The ground line: one solid hairline straight across the band, at the near
			// ink and full opacity. It used to be a dash strip that scrolled with the
			// ground, which read as a dotted edge rather than as where the ground
			// starts, and a solid line has no phase to scroll in any case.
			ctx.fillRect(0, groundTop, cssWidth, GROUND_LINE_HEIGHT);

			// Dirt dashes, tiled at `GROUND_TEXTURE_TILE_WIDTH` and scrolling with
			// the ground. Drawn as one batched path (a `rect()` per dash, a single
			// `fill()`) so the grain costs one rasterisation rather than a `fillRect`
			// per dash. Each dash is one world unit tall and `w` units wide.
			// `fillStyle` is still `groundColor`; `globalAlpha` is restored
			// before the obstacles and player draw.
			const textureTile = GROUND_TEXTURE_TILE_WIDTH;
			const textureOffset =
				((s.groundOffset % textureTile) + textureTile) % textureTile;
			ctx.globalAlpha = GROUND_TEXTURE_ALPHA;
			ctx.beginPath();
			for (
				let x = -textureOffset;
				x < s.worldWidth + textureTile;
				x += textureTile
			) {
				for (const dash of GROUND_TEXTURE) {
					ctx.rect(
						(x + dash.x) * px,
						groundTop + dash.y * px,
						dash.w * px,
						GROUND_TEXTURE_DASH_HEIGHT * px,
					);
				}
			}
			ctx.fill();
			ctx.globalAlpha = 1;

			// Obstacles: flickering candles, drawn opaque in `s.obstacles` order. The body
			// is the collider from `runner.ts`; `drawObstacle` maps the shared
			// `obstacleCandleParts` world-unit layout (see `runner-obstacles.ts`) to one
			// filled rect per part, tinted from the obstacle's seeded `tint`, and the flame
			// animation comes from each obstacle's simulated `frame`, so the candles
			// freeze with the world.
			for (const o of s.obstacles) {
				drawObstacle(ctx, o, px);
			}

			// Player: the cut sprite sheet, drawn at its own resolution and scaled
			// into the 16x22 world box. Images load asynchronously, so a frame is
			// skipped until its image is decoded; the rAF loop keeps running, so the
			// next frame picks it up. Smoothing is on (set once below) because the
			// source is much larger than the box. A crash keeps the frozen pose
			// (`runner.ts` stops recomputing it) and only fades it here.
			const poseFrames = PLAYER_FRAMES[s.player.pose];
			const image =
				playerImages[s.player.pose]?.[s.player.frame % poseFrames.length];
			if (image?.complete && image.naturalWidth > 0) {
				ctx.globalAlpha = s.phase === "dead" ? PLAYER_DEAD_ALPHA : 1;
				drawPlayerFrame(ctx, image, s.player.x, s.player.y, px);
				ctx.globalAlpha = 1;
			}
		};

		const frame = (time: number): void => {
			raf = 0;
			if (!lastTime) lastTime = time;
			let dt = (time - lastTime) / 1000;
			lastTime = time;
			if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
			accumulator += dt;

			const input = { jump: held.size > 0 || pointerJump };
			while (accumulator >= FIXED_DT) {
				game = step(game, FIXED_DT, input);
				// Consume a queued tap only once a step has actually run, so a tap is
				// not lost on a high-refresh frame whose accumulator is still short.
				pointerJump = false;
				accumulator -= FIXED_DT;
			}

			const state = view(game);
			if (state.phase === "running") {
				advanceParallax(state.groundOffset, state.pixelScale);
				writeStatus(runningStatus(state.highScore, state.score));
			} else {
				// Hold the offset when the run ends. Syncing the baseline means a
				// restart (which zeroes groundOffset) cannot produce a jump.
				prevGroundOffset = state.groundOffset;
			}
			draw();

			// Only a run keeps the loop alive. Idle is a single static frame — the
			// simulation holds it still (see `step`) — so re-requesting frames there
			// would repaint an unchanging scene forever, and there is nothing else for a
			// frame to advance: the parallax only moves while the ground scrolls.
			// `paused` and `inView` still gate the loop, and reduced motion never
			// reaches here.
			if (view(game).phase === "running" && !paused && inView) {
				raf = requestAnimationFrame(frame);
				return;
			}

			// The loop owns stopping: the simulation keeps integrating after a
			// collision by design, so the component is what pins the final frame.
			raf = 0;
			lastTime = 0;
			accumulator = 0;
			if (view(game).phase === "dead") {
				// One read of the final state: the score line stays on screen under the
				// game-over message, and the same numbers drive persistence and the
				// personal-best trigger below.
				const s = view(game);
				persistHighScore(s.highScore);
				// Write "dead", do not delete the attribute: the hero should still say
				// which phase the session is in, and nothing reads it as a boolean.
				setPhaseAttr("dead");
				writeStatus(deadStatus(s.highScore, s.score));
				// The trigger: this run beat the best as it stood before the run began.
				// The first ever run always qualifies (the snapshot starts at 0), which
				// is how a first-time player discovers the board. A score of 0 does not
				// qualify, though `floor(distance / scoreUnit)` makes it unreachable.
				const finalScore = s.score;
				if (finalScore > runBestRef.current && finalScore > 0) {
					openSourceRef.current = "band";
					setPendingScore(finalScore);
					setLeaderboardOpen(true);
				}
			}
		};

		const stopLoop = (): void => {
			if (raf) {
				cancelAnimationFrame(raf);
				raf = 0;
			}
			lastTime = 0;
			accumulator = 0;
			// A keyup can be missed while paused or unfocused; a stranded held key
			// would otherwise block every later jump.
			held.clear();
		};

		/**
		 * Start the render loop, if this phase has anything to animate. Only a run
		 * does: idle is one static frame and death is one frozen frame, and both are
		 * already painted, so either would leave the loop redrawing identical pixels
		 * sixty times a second. Gating here rather than at each call site keeps the
		 * visibility, intersection and input paths free of phase checks.
		 */
		const startLoop = (): void => {
			if (reduced || raf || paused || !inView) return;
			if (view(game).phase !== "running") return;
			raf = requestAnimationFrame(frame);
		};

		// One button: start when idle, jump when running, restart when dead.
		const press = (): void => {
			const s = view(game);
			if (s.phase === "dead") {
				// Snapshot the best the new run must beat, before `restart` resets the
				// run. At death `highScore` is already max(old best, just-finished score).
				runBestRef.current = s.highScore;
				game = restart(game);
				resyncParallax();
				// Re-read the restarted game: it has a new score (0) and the same best.
				const next = view(game);
				setPhaseAttr("running");
				writeStatus(runningStatus(next.highScore, next.score));
				startLoop();
				return;
			}
			const wasRunning = s.phase === "running";
			if (s.phase === "idle") {
				runBestRef.current = s.highScore;
				game = start(game);
			}
			// Re-read the game after the idle mutation, exactly as the dead branch
			// does: `start` resets the score, so writing from the stale `s` would
			// only be correct by coincidence.
			const next = view(game);
			setPhaseAttr("running");
			writeStatus(runningStatus(next.highScore, next.score));
			// Starting or restarting must not jump: the run opens on the push intro,
			// and the first jump is a separate input. Only a tap that lands while a
			// run is already in flight queues a jump.
			if (wasRunning) pointerJump = true;
			startLoop();
		};

		const onResize = (): void => {
			const measured = measure();
			bandHeight = measured.bandHeight;
			cssWidth = measured.cssWidth;
			dpr = measured.dpr;
			applyCanvasSize();
			// Geometry is simulation state; resize keeps the run alive.
			game = resize(game, { bandHeight, canvasWidth: cssWidth });
			// Rebuild after `resize`, not before: the cached gradient encodes the
			// new `groundY` that call produces.
			refreshGroundFill();
			measureParallax();
			draw();
		};

		// Keys are handled on the focusable band, never on window. That is what
		// keeps Space inside the RSVP form from reaching the game.
		const onKeyDown = (event: KeyboardEvent): void => {
			const jumpKey =
				event.code === "Space" ||
				event.code === "ArrowUp" ||
				event.code === "KeyW";
			const restartKey = event.code === "Space" || event.code === "Enter";
			const current = view(game).phase;
			if (current === "idle" && jumpKey) {
				event.preventDefault();
				press();
				return;
			}
			if (current === "dead") {
				if (restartKey) {
					event.preventDefault();
					press();
				}
				return;
			}
			if (jumpKey) {
				event.preventDefault();
				held.add(event.code);
			}
		};

		const onKeyUp = (event: KeyboardEvent): void => {
			held.delete(event.code);
		};

		const onBlur = (): void => {
			held.clear();
		};

		const tapTarget = heroHost;
		let downX = 0;
		let downY = 0;
		let downAt = Number.NEGATIVE_INFINITY;

		const onPointerDown = (event: PointerEvent): void => {
			if (event.target instanceof Element) {
				if (event.target.closest(INTERACTIVE_SELECTOR)) return;
			}
			if (event.pointerType === "mouse" && event.button !== 0) return;
			downX = event.clientX;
			downY = event.clientY;
			downAt = performance.now();
		};

		const onPointerUp = (event: PointerEvent): void => {
			if (event.target instanceof Element) {
				if (event.target.closest(INTERACTIVE_SELECTOR)) return;
			}
			const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
			const elapsed = performance.now() - downAt;
			downAt = Number.NEGATIVE_INFINITY;
			// A phone user must still be able to scroll the hero: only a short,
			// near-stationary pointer counts as a tap.
			if (moved >= 10 || elapsed >= 300) return;
			if (view(game).phase === "running") event.preventDefault();
			press();
			if (!reduced) band.focus({ preventScroll: true });
		};

		const onPointerCancel = (): void => {
			downAt = Number.NEGATIVE_INFINITY;
		};

		const onVisibility = (): void => {
			paused = document.hidden;
			if (paused) stopLoop();
			else startLoop();
		};

		const onIntersection = (entries: IntersectionObserverEntry[]): void => {
			inView = entries.some((entry) => entry.isIntersecting);
			if (inView) startLoop();
			else stopLoop();
		};

		applyCanvasSize();
		refreshGroundFill();
		draw();
		measureParallax();

		// Hand the band over from the server-rendered placeholder to the canvas.
		// The `draw()` here paints the canvas and `setSceneDrawn(true)` drops the
		// placeholder in the same turn, so both land before the next paint and the
		// swap has nothing to flash. Hiding it through React state (rather than
		// removing the node by hand) keeps the DOM React owns consistent.
		void Promise.all(pending).then(() => {
			sceneReady = true;
			draw();
			setSceneDrawn(true);
		});

		const resizeObserver = new ResizeObserver(onResize);
		resizeObserver.observe(band);

		let intersection: IntersectionObserver | null = null;
		if (!reduced) {
			band.addEventListener("keydown", onKeyDown);
			band.addEventListener("keyup", onKeyUp);
			band.addEventListener("blur", onBlur);
			tapTarget.addEventListener("pointerdown", onPointerDown);
			tapTarget.addEventListener("pointerup", onPointerUp);
			tapTarget.addEventListener("pointercancel", onPointerCancel);
			document.addEventListener("visibilitychange", onVisibility);
			intersection = new IntersectionObserver(onIntersection, {
				threshold: 0,
			});
			intersection.observe(tapTarget);

			// Focus on load so the first Space reaches the game instead of the
			// browser's page-down scroll: keys are handled per-element, never on
			// window, so an unfocused band cannot see them. Three guards keep this
			// from being a nuisance rather than a convenience:
			//   - reduced motion: play is not offered, so do not focus.
			//   - no layout: the band is `display: none` below ~640px viewport
			//     height, and focusing a zero-height element would be pointless.
			//   - something else is already focused: if the visitor started
			//     interacting during hydration, do not steal focus from them.
			// `preventScroll` keeps focusing from moving the viewport.
			if (
				band.getBoundingClientRect().height > 0 &&
				document.activeElement === document.body
			) {
				band.focus({ preventScroll: true });
			}

			// No loop is started here, and none is needed: idle is a still scene that
			// `draw()` has already painted above, and that the placeholder handed over
			// to once every frame decoded. The first frame with anything to animate is
			// the first run, which `press` starts; under reduced motion `reduced` is
			// true and no loop ever starts at all.
		}

		return () => {
			stopLoop();
			delete heroHost.dataset.phase;
			// React may remount the island, so put the line back to the state a fresh
			// idle game starts from rather than leaving the last score or game-over
			// message in place. `writeStatus` keeps `lastStatus` in step.
			writeStatus(IDLE_STATUS);
			resizeObserver.disconnect();
			intersection?.disconnect();
			band.removeEventListener("keydown", onKeyDown);
			band.removeEventListener("keyup", onKeyUp);
			band.removeEventListener("blur", onBlur);
			tapTarget.removeEventListener("pointerdown", onPointerDown);
			tapTarget.removeEventListener("pointerup", onPointerUp);
			tapTarget.removeEventListener("pointercancel", onPointerCancel);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [eventId, groundColor, groundFarColor]);

	return (
		<>
			{/* biome-ignore lint/a11y/useSemanticElements: <fieldset> is form grouping semantics; this is a labeled game region, not a form. */}
			<div
				ref={bandRef}
				className="absolute inset-x-0 bottom-0 z-0 h-[var(--band-h)] select-none overflow-hidden outline-none [@media(max-height:639px)]:hidden"
				tabIndex={interactive ? 0 : -1}
				role="group"
				aria-label="Birthday runner mini-game"
				aria-describedby={hintId}
				style={
					{
						"--band-h": BAND_HEIGHT,
						touchAction: "manipulation",
					} as CSSProperties
				}
			>
				<canvas ref={canvasRef} className="block h-full w-full" />
				{/*
				 * Server-rendered approximation of the idle scene. The island cannot
				 * paint until it hydrates, so without this the band shows the bare hero
				 * background for the gap between first paint and the first canvas draw —
				 * the load flash. `sceneDrawn` drops it once the canvas has painted the
				 * full scene (see the effect). Every measurement is tied to the same
				 * constants the canvas uses, with `--ps` standing in for the live
				 * `pixelScale`, so the handover does not move anything. The ground fill
				 * below reproduces the canvas's two-stop gradient as a CSS
				 * `linear-gradient`, each stop the corresponding ink at
				 * `GROUND_FILL_ALPHA` (spelled `color-mix(in srgb, … A%, transparent)`)
				 * over the hero's `heroBg`. The canvas interpolates the two opaque inks
				 * and composites the result at that alpha over the same `heroBg`; the
				 * CSS gradient interpolates the same two inks at the same alpha over
				 * the same `heroBg`. Because both stops carry the same alpha, the two
				 * agree at every y — which is the whole reason the handover between
				 * canvas and placeholder is invisible. Spelling those stops as mixes over
				 * `transparent` is only correct because this subtree composites onto the
				 * hero background and nothing between here and it paints a colour of its
				 * own; the below-fold section in `Invite.astro` has to name the base
				 * explicitly for the same reason, since it sits on the page instead.
				 */}
				{!sceneDrawn && (
					<div
						data-ssr-scene
						aria-hidden="true"
						className="pointer-events-none absolute inset-0"
						style={{ "--ps": PIXEL_SCALE_CSS } as CSSProperties}
					>
						<div
							className="absolute inset-x-0 bottom-0"
							style={{
								top: `calc(100% - ${TUNING.groundMargin} * var(--ps))`,
								// Texture on top, gradient underneath; `backgroundSize` lists one
								// entry per layer in the same order. The gradient covers the box
								// on its own, so its size stays `auto` and it never tiles.
								backgroundImage: `${groundTextureCssUrl(groundColor)}, ${groundFillGradient}`,
								backgroundSize: `calc(${GROUND_TEXTURE_TILE_WIDTH} * var(--ps)) calc(${GROUND_TEXTURE_TILE_HEIGHT} * var(--ps)), auto`,
							}}
						/>
						{/* The ground line, the same solid hairline the canvas draws: the
						    theme's near ink at full opacity, at the shared thickness. */}
						<div
							className="absolute inset-x-0"
							style={{
								top: `calc(100% - ${TUNING.groundMargin} * var(--ps))`,
								height: `${GROUND_LINE_HEIGHT}px`,
								backgroundColor: groundColor,
							}}
						/>
						<div
							className="absolute"
							style={{
								left: `calc(${TUNING.playerX} * var(--ps))`,
								bottom: `calc(${TUNING.groundMargin} * var(--ps))`,
								width: `calc(${TUNING.playerWidth} * var(--ps))`,
								height: `calc(${TUNING.playerHeight} * var(--ps))`,
							}}
						>
							<img
								src={PLAYER_FRAMES.idle[0]}
								alt=""
								className="h-full w-full object-contain object-bottom"
							/>
						</div>
					</div>
				)}
				<p id={hintId} className="sr-only">
					Press space, the up arrow, or W to jump. Press space or enter to
					restart after a crash. Tap the hero to play.
				</p>
			</div>
			{/*
			 * The dialog is a sibling of the band, never a child. Below ~640px viewport
			 * height the band is `display: none`, and a modal in a `display:none`
			 * subtree would not render even from the top layer; the button must keep
			 * opening the board when the band is hidden.
			 */}
			<Leaderboard
				open={leaderboardOpen}
				onClose={closeLeaderboard}
				eventId={eventId}
				state={board}
				onRetry={loadBoard}
				onSubmitted={(_entry, nextBoard) =>
					setBoard({ status: "ready", board: nextBoard })
				}
				pendingScore={pendingScore ?? undefined}
			/>
		</>
	);
}
