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

			// Ground: a tiled dash strip. The only thing that scrolls.
			ctx.fillStyle = groundColor;
			const tile = 16;
			const dash = 6;
			const offset = ((s.groundOffset % tile) + tile) % tile;
			for (let x = -offset; x < s.worldWidth + tile; x += tile) {
				ctx.fillRect(x * px, s.groundY * px, dash * px, 2);
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

			// Arcade HUD on the canvas, so play never re-renders React.
			ctx.fillStyle = textColor;
			ctx.font = "12px ui-monospace, monospace";
			ctx.textAlign = "right";
			ctx.fillText(
				`HI ${pad(s.highScore)}   ${pad(s.score)}`,
				cssWidth - 6,
				15,
			);
			ctx.textAlign = "left";
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
				startLoop();
				return;
			}
			if (current === "idle") {
				game = start(game);
				setPhase("running");
			}
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

		const tapTarget =
			(band.closest("[data-hero]") as HTMLElement | null) ?? band;
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
			className="absolute inset-x-0 bottom-0 z-0 h-[clamp(160px,22svh,200px)] select-none overflow-hidden outline-none focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-stone-500 [@media(max-height:639px)]:hidden"
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
