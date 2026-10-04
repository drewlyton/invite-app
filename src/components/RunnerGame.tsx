import { useEffect, useId, useRef, useState } from "react";
import {
	createGame,
	type Game,
	resize,
	restart,
	start,
	step,
	view,
} from "../lib/runner";

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
		// The sky strips are promoted to compositor layers only while a run is in
		// flight (see `.hero-sky-strip` in Invite.astro). Toggle the hint with the
		// phase so an idle hero never carries the seven large layers.
		const setRunning = (running: boolean): void => {
			if (running) heroHost.dataset.running = "";
			else delete heroHost.dataset.running;
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

		const pad = (n: number): string =>
			String(Math.max(0, Math.floor(n))).padStart(5, "0");

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
				ctx.fillText(`HI ${pad(s.highScore)}   ${pad(s.score)}`, 6, 15);
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
				setRunning(false);
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
				game = restart(game);
				setPhase("running");
				resyncParallax();
				setRunning(true);
				startLoop();
				return;
			}
			if (current === "idle") {
				game = start(game);
				setPhase("running");
			}
			setRunning(true);
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
		}

		return () => {
			stopLoop();
			delete heroHost.dataset.running;
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
		<div
			ref={bandRef}
			className="absolute inset-x-0 bottom-0 z-0 h-[clamp(160px,22svh,200px)] select-none overflow-hidden outline-none [@media(max-height:639px)]:hidden"
			tabIndex={interactive ? 0 : -1}
			role="application"
			aria-label="Birthday runner mini-game"
			aria-describedby={hintId}
			style={{ touchAction: "manipulation" }}
		>
			<canvas ref={canvasRef} className="block h-full w-full" />
			<p id={hintId} className="sr-only">
				Press space, the up arrow, or W to jump. Press space or enter to restart
				after a crash. Tap the hero to play.
			</p>
			{interactive && phase !== "running" && (
				<p className="pointer-events-none absolute inset-x-0 bottom-2 text-center font-body text-sm text-stone-500">
					{phase === "dead"
						? "Game over — press space to retry"
						: "Tap or press space to play"}
				</p>
			)}
		</div>
	);
}
