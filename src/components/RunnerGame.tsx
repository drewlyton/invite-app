import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
	createGame,
	type Game,
	resize,
	restart,
	start,
	step,
	view,
} from "../lib/runner";
import { formatScore } from "../lib/score-format";
import type { ScoreEntry } from "../lib/scores";
import Leaderboard, { type BoardState } from "./Leaderboard";

interface Props {
	eventId: string;
	color: string;
	ground?: string;
	textColor: string;
}

type Phase = Game["phase"];

/** Fixed simulation step. Physics must not depend on the display refresh rate. */
const FIXED_DT = 1 / 120;
/** Upper bound on a single frame's dt, so a long pause cannot tunnel obstacles. */
const MAX_FRAME_DT = 0.25;

const INTERACTIVE_SELECTOR =
	"a, button, input, select, textarea, [contenteditable]";

/**
 * The runner hero island.
 *
 * Everything drawn comes from `view(game)`; nothing in this file reads Game
 * internals. The simulation is pure, so the only mutable state here is the
 * clock, the DOM sizing and the list of currently held keys. The score is
 * painted on the canvas, so React does not re-render during play — the only
 * state transitions are the ones that change the DOM (hint text / game over).
 */
export default function RunnerGame({
	eventId,
	color,
	ground,
	textColor,
}: Props) {
	const bandRef = useRef<HTMLDivElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const [phase, setPhase] = useState<Phase>("idle");
	const [interactive, setInteractive] = useState(false);
	const hintId = useId();
	const groundColor = ground ?? color;

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
	 * HUD and is deliberately untouched.
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
		// The hero carries a single `data-phase` attribute ("idle" | "running" |
		// "dead") rather than a boolean, so CSS can tell "mid-session but not
		// running" (dead) from "not started" (idle). Two consumers: the sky strips
		// are promoted to compositor layers only while `running` (see
		// `.hero-sky-strip` in Invite.astro), and the play prompt is hidden while
		// `running` or `dead`.
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

		const applyCanvasSize = (): void => {
			canvas.width = Math.round(cssWidth * dpr);
			canvas.height = Math.round(bandHeight * dpr);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		};

		const draw = (): void => {
			const s = view(game);
			const px = s.pixelScale;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			// Transparent, so the hero's own background shows through.
			ctx.clearRect(0, 0, cssWidth, bandHeight);

			// Ground: a muted fill from the ground line down to the bottom of the
			// band, with the tiled dash strip along its top edge. Raising the ground
			// line with `TUNING.groundMargin` would otherwise leave dead white space
			// beneath it; the fill makes that region read as ground. Kept at low
			// alpha so hero text that overlaps the band keeps its contrast.
			const groundTop = s.groundY * px;
			ctx.fillStyle = groundColor;
			ctx.globalAlpha = 0.22;
			ctx.fillRect(0, groundTop, cssWidth, bandHeight - groundTop);
			ctx.globalAlpha = 1;

			// Dash strip: the only part of the ground that scrolls.
			const tile = 16;
			const dash = 6;
			const offset = ((s.groundOffset % tile) + tile) % tile;
			for (let x = -offset; x < s.worldWidth + tile; x += tile) {
				ctx.fillRect(x * px, groundTop, dash * px, 2);
			}

			// Placeholder rectangles. One fillRect per rect, world units -> CSS px.
			ctx.globalAlpha = 0.7;
			ctx.fillStyle = color;
			for (const o of s.obstacles) {
				ctx.fillRect(o.x * px, o.y * px, o.w * px, o.h * px);
			}
			ctx.globalAlpha = 1;
			ctx.fillStyle = s.phase === "dead" ? textColor : color;
			ctx.fillRect(
				s.player.x * px,
				s.player.y * px,
				s.player.w * px,
				s.player.h * px,
			);

			// Arcade HUD on the canvas, so play never re-renders React. Left-aligned,
			// and not drawn at all while idle: there must be no score before the
			// first play. It stays visible through `dead` so the final score is
			// readable. Phase comes from `view(game)`, the renderer's only read path.
			if (s.phase !== "idle") {
				ctx.fillStyle = textColor;
				ctx.font = "12px ui-monospace, monospace";
				ctx.textAlign = "left";
				ctx.fillText(
					`HI ${formatScore(s.highScore)}   ${formatScore(s.score)}`,
					6,
					15,
				);
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
			} else {
				// Hold the offset when the run ends. Syncing the baseline means a
				// restart (which zeroes groundOffset) cannot produce a jump.
				prevGroundOffset = state.groundOffset;
			}
			draw();

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
				persistHighScore(view(game).highScore);
				setPhase("dead");
				// Set "dead", do not delete: the phase attribute must distinguish a
				// finished run from an untouched idle hero, or the play prompt
				// reappears alongside the band's game-over message.
				setPhaseAttr("dead");
				// The trigger: this run beat the best as it stood before the run began.
				// The first ever run always qualifies (the snapshot starts at 0), which
				// is how a first-time player discovers the board. A score of 0 does not
				// qualify, though `floor(distance / scoreUnit)` makes it unreachable.
				const finalScore = view(game).score;
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

		const startLoop = (): void => {
			if (reduced || raf || paused || !inView) return;
			if (view(game).phase !== "running") return;
			raf = requestAnimationFrame(frame);
		};

		// One button: start when idle, jump when running, restart when dead.
		const press = (): void => {
			const current = view(game).phase;
			if (current === "dead") {
				// Snapshot the best the new run must beat, before `restart` resets the
				// run. At death `highScore` is already max(old best, just-finished score).
				runBestRef.current = view(game).highScore;
				game = restart(game);
				setPhase("running");
				resyncParallax();
				setPhaseAttr("running");
				startLoop();
				return;
			}
			if (current === "idle") {
				runBestRef.current = view(game).highScore;
				game = start(game);
				setPhase("running");
			}
			setPhaseAttr("running");
			pointerJump = true;
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
		draw();
		measureParallax();

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
		}

		return () => {
			stopLoop();
			delete heroHost.dataset.phase;
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
	}, [eventId, color, groundColor, textColor]);

	return (
		<>
			{/* biome-ignore lint/a11y/useSemanticElements: <fieldset> is form grouping semantics; this is a labeled game region, not a form. */}
			<div
				ref={bandRef}
				className="absolute inset-x-0 bottom-0 z-0 h-[clamp(160px,22svh,200px)] select-none overflow-hidden outline-none [@media(max-height:639px)]:hidden"
				tabIndex={interactive ? 0 : -1}
				role="group"
				aria-label="Birthday runner mini-game"
				aria-describedby={hintId}
				style={{ touchAction: "manipulation" }}
			>
				<canvas ref={canvasRef} className="block h-full w-full" />
				<p id={hintId} className="sr-only">
					Press space, the up arrow, or W to jump. Press space or enter to
					restart after a crash. Tap the hero to play.
				</p>
				{interactive && phase === "dead" && !leaderboardOpen && (
					<p className="pointer-events-none absolute inset-x-0 bottom-2 text-center font-body text-sm text-stone-500">
						Game over — press space to retry
					</p>
				)}
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
