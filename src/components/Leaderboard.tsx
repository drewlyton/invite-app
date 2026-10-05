import { type MouseEvent, useEffect, useId, useRef } from "react";
import { formatScore } from "../lib/score-format";
import type { ScoreEntry } from "../lib/scores";

/**
 * The board's data, owned by `RunnerGame` and passed in. A discriminated union
 * rather than `entries | null` so "no scores yet" and "not fetched yet" cannot
 * be confused — they render different things.
 */
export type BoardState =
	| { status: "loading" }
	| { status: "ready"; board: ScoreEntry[] }
	| { status: "error" };

interface Props {
	/** Whether the dialog is open. Owned by `RunnerGame`. */
	open: boolean;
	/** Called when the dialog closes for any reason, Escape included. */
	onClose: () => void;
	state: BoardState;
	onRetry: () => void;
	/**
	 * The finished run's score, supplied only by the Stage 3 game-over trigger.
	 * When present it switches the dialog into personal-best mode (handle input,
	 * submit). Stage 2 never passes it, so the board stays strictly read-only:
	 * no input, no submit, no submission affordance of any kind.
	 */
	pendingScore?: number;
}

/**
 * The leaderboard dialog.
 *
 * A plain React component — not a second Astro island — rendered by
 * `RunnerGame`, so the open state lives in one React tree with no cross-island
 * event plumbing. It is deliberately a native `<dialog>` opened with
 * `showModal()`: the hero is `overflow-hidden` with `isolate`, so an
 * absolutely-positioned overlay would be clipped by the hero and would have to
 * fight the sky layers for stacking. Top-layer content is exempt from ancestor
 * clipping and stacking contexts, and additionally gets focus trapping,
 * `Escape`, page inertness and `::backdrop` for free.
 */
export default function Leaderboard({ open, onClose, state, onRetry }: Props) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const titleId = useId();

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			// Read-only mode has no input to focus, so focus the dialog itself.
			// `showModal` would otherwise land on the close button, which reads as
			// "the page wants you to press this" rather than "here are the scores".
			dialog.focus();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	}, [open]);

	// A click on `::backdrop` targets the <dialog> element itself; a click on the
	// panel targets a descendant. The padding therefore lives on the inner panel,
	// not on the dialog, so this cannot fire on a click inside the panel.
	const onBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
		if (event.target === dialogRef.current) onClose();
	};

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: a backdrop click is a pointer convenience; Escape and the close button are the keyboard paths.
		<dialog
			ref={dialogRef}
			tabIndex={-1}
			aria-labelledby={titleId}
			onClose={onClose}
			onClick={onBackdropClick}
			className="m-auto max-h-[min(80svh,36rem)] w-[calc(100vw_-_2rem)] max-w-88 bg-transparent p-0 text-stone-900 backdrop:bg-black/60"
		>
			{/* The inner panel owns the border and the scroll cap, so the dialog's
			    `max-height` and the scroll region can never disagree by a border's
			    width. */}
			<div className="flex max-h-[inherit] flex-col gap-4 rounded-lg border-2 border-stone-800 bg-white p-4 shadow-2xl sm:p-5">
				<div className="flex items-center justify-between gap-3">
					<h2 id={titleId} className="font-heading text-xs tracking-wide">
						HIGH SCORES
					</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close high scores"
						className="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-stone-300 font-body text-xl leading-none text-stone-600 transition hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800"
					>
						✕
					</button>
				</div>
				<div className="min-h-0 overflow-y-auto">
					<Board state={state} onRetry={onRetry} />
				</div>
			</div>
		</dialog>
	);
}

function Board({ state, onRetry }: { state: BoardState; onRetry: () => void }) {
	if (state.status === "loading") {
		return <BoardSkeleton />;
	}

	if (state.status === "error") {
		return (
			<div className="flex flex-col items-center gap-3 py-6 text-center">
				<p className="font-body text-lg text-stone-600">
					Couldn't load the scores.
				</p>
				<button
					type="button"
					onClick={onRetry}
					className="inline-flex min-h-11 items-center justify-center rounded border-2 border-stone-800 px-4 font-heading text-[10px] uppercase transition hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800"
				>
					Retry
				</button>
			</div>
		);
	}

	if (state.board.length === 0) {
		return (
			<p className="py-6 text-center font-body text-lg text-stone-500">
				No scores yet — be the first.
			</p>
		);
	}

	return (
		<ol className="flex flex-col">
			{state.board.map((entry, index) => (
				<li
					key={`${entry.deviceId}-${entry.at}`}
					className="grid grid-cols-[2rem_1fr_auto] items-baseline gap-x-2 border-b border-stone-100 py-1.5 font-heading text-[11px] last:border-b-0"
				>
					<span className="text-right text-stone-400">
						{String(index + 1).padStart(2, "0")}
					</span>
					{/* Untrusted handle from another visitor: a React text node, never
					    `innerHTML`. Keep it that way. */}
					<span className="truncate uppercase">{entry.name}</span>
					<span className="text-right tabular-nums">
						{formatScore(entry.score)}
					</span>
				</li>
			))}
		</ol>
	);
}

/**
 * A genuine cold fetch only. The board is prefetched on island mount, so in
 * the normal case opening never shows this; a skeleton at the moment of a new
 * personal best would undercut the payoff.
 */
function BoardSkeleton() {
	return (
		<div className="flex flex-col gap-2 py-1" aria-hidden="true">
			{[0, 1, 2, 3, 4].map((row) => (
				<div
					key={row}
					className="h-4 animate-pulse rounded bg-stone-200 motion-reduce:animate-none"
				/>
			))}
		</div>
	);
}
