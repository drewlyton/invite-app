import {
	type KeyboardEvent,
	type MouseEvent,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
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
	/**
	 * The event whose board this is. Not in the plan's Stage 2 interface
	 * listing, but Stage 3 needs it: the handle and device-id keys are namespaced
	 * by event, and the submission URL is `/api/scores/<eventId>`.
	 */
	eventId: string;
	state: BoardState;
	onRetry: () => void;
	/**
	 * Called after a successful submit with the server's normalized entry and
	 * the authoritative board it returned. `RunnerGame` owns `state`, so this is
	 * how the freshly submitted row survives closing and reopening the board.
	 * Also not in the plan's Stage 2 listing; see `eventId`.
	 */
	onSubmitted?: (entry: ScoreEntry, board: ScoreEntry[]) => void;
	/**
	 * The finished run's score, supplied only by the Stage 3 game-over trigger.
	 * When present it switches the dialog into personal-best mode (handle input,
	 * submit). Absent means the board is strictly read-only: no input, no submit,
	 * no submission affordance of any kind.
	 */
	pendingScore?: number;
}

const DEVICE_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/**
 * `crypto.randomUUID` needs a secure context. That holds in production over
 * https but not over plain http on a LAN, so fall back to `Math.random` — the
 * id only has to be stable and collision-unlikely, not cryptographic. The
 * shape matches the server's `/^[A-Za-z0-9-]{8,64}$/` guard.
 */
function randomDeviceId(): string {
	const c = globalThis.crypto;
	if (c && typeof c.randomUUID === "function") {
		try {
			return c.randomUUID();
		} catch {
			// Fall through to the non-crypto fallback.
		}
	}
	const chunk = (): string =>
		Math.floor(Math.random() * 0x100000000)
			.toString(16)
			.padStart(8, "0");
	return `${chunk()}-${chunk()}-${chunk()}-${chunk()}`;
}

/** Read this device's id, creating and persisting one on first use. */
function readDeviceId(eventId: string): string {
	const key = `runner:device:${eventId}`;
	try {
		const existing = window.localStorage.getItem(key);
		if (existing && DEVICE_PATTERN.test(existing)) return existing;
	} catch {
		// Storage unavailable (private mode, quota). A fresh id still works.
	}
	const generated = randomDeviceId();
	try {
		window.localStorage.setItem(key, generated);
	} catch {
		// Not persisted, but usable for this submission.
	}
	return generated;
}

/** The remembered handle, already normalized to the input's own alphabet. */
function readStoredName(eventId: string): string {
	try {
		return (window.localStorage.getItem(`runner:name:${eventId}`) ?? "")
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, "")
			.slice(0, 8);
	} catch {
		return "";
	}
}

function storeName(eventId: string, name: string): void {
	try {
		window.localStorage.setItem(`runner:name:${eventId}`, name);
	} catch {
		// A forgotten handle is not worth an error.
	}
}

/** The input's own normalization: uppercase, `A–Z0–9`, at most 8. */
function normalizeName(value: string): string {
	return value
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.slice(0, 8);
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
 *
 * Two modes share one tree. With `pendingScore` the board slots that score in
 * at the rank it would occupy and the handle form is live; without it the
 * board is read-only. The scores API is never allowed to break anything: the
 * score and the form render whether or not the board loaded, and a failed
 * `POST` keeps both and offers a retry.
 */
export default function Leaderboard({
	open,
	onClose,
	eventId,
	state,
	onRetry,
	onSubmitted,
	pendingScore,
}: Props) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const titleId = useId();
	const inputId = useId();

	const personalBest = pendingScore != null;

	const [name, setName] = useState("");
	const [deviceId, setDeviceId] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	// The server's answer to a successful submit. Held locally so the returned
	// board renders even if the prefetched `GET` had failed.
	const [submitted, setSubmitted] = useState<{
		entry: ScoreEntry;
		board: ScoreEntry[];
	} | null>(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	}, [open]);

	// Per-open reset, and the prefill. Runs on every open, so the read-only mode
	// never inherits a previous submit's highlight, and the show/hide effect above
	// has already made the dialog modal so the input can take focus.
	//
	// The reset also runs on *close*, not only on open. Otherwise `submitted` is
	// still set in the render that reopens the dialog, and the "park focus after
	// submit" effect below fires with that stale value and steals focus from the
	// freshly prefilled input. A second record in the same session then opens with
	// the handle filled in but unfocused, so `Enter` does nothing — exactly the
	// one-tap re-submit the prefill exists to provide.
	useEffect(() => {
		setSubmitted(null);
		setSubmitError(null);
		setSubmitting(false);
		if (!open) return;
		if (pendingScore != null) {
			setName(readStoredName(eventId));
			setDeviceId(readDeviceId(eventId));
		} else {
			setName("");
			setDeviceId(null);
		}
	}, [open, pendingScore, eventId]);

	useEffect(() => {
		if (!open) return;
		// Personal-best mode wants the input ready; read-only mode focuses the
		// dialog itself so `showModal` does not land on the close button, which
		// reads as "the page wants you to press this".
		if (pendingScore != null) inputRef.current?.focus();
		else dialogRef.current?.focus();
	}, [open, pendingScore]);

	// The success path removes the focused input, and a modal whose focus has
	// fallen back to the page body swallows nothing: the `Space` handler below
	// is bound to the dialog and only fires for events raised inside it. Park
	// focus on the dialog so the documented `Space`-to-close still works.
	useEffect(() => {
		if (open && submitted) dialogRef.current?.focus();
	}, [open, submitted]);

	// A click on `::backdrop` targets the <dialog> element itself; a click on the
	// panel targets a descendant. The padding therefore lives on the inner panel,
	// not on the dialog, so this cannot fire on a click inside the panel.
	const onBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
		if (event.target === dialogRef.current) onClose();
	};

	/**
	 * `Space` closes, preserving the existing "mash space after dying" reflex.
	 * It must not fire while the handle input holds focus, or a player mid-typing
	 * would be thrown out of the dialog. The band's own handler cannot fire while
	 * the modal holds focus, so this is additive. `Enter` submits through the
	 * form's native behaviour.
	 */
	const onDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
		if (event.code !== "Space") return;
		if (event.target instanceof HTMLInputElement) return;
		event.preventDefault();
		onClose();
	};

	const submit = useCallback(async (): Promise<void> => {
		if (pendingScore == null || submitting || submitted) return;
		const handle = normalizeName(name);
		if (handle.length === 0) return;
		const device = deviceId ?? readDeviceId(eventId);
		setSubmitting(true);
		setSubmitError(null);
		try {
			const response = await fetch(`/api/scores/${eventId}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					deviceId: device,
					name: handle,
					score: pendingScore,
				}),
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = (await response.json()) as {
				entry?: ScoreEntry;
				board?: ScoreEntry[];
			};
			if (!data.entry || !data.board) throw new Error("Malformed response");
			setSubmitted({ entry: data.entry, board: data.board });
			setName(data.entry.name);
			storeName(eventId, data.entry.name);
			onSubmitted?.(data.entry, data.board);
		} catch {
			// The score and the local high score are untouched; only the submit
			// affordance fails, and it stays available to retry.
			setSubmitError("Couldn't submit. Your score is safe — try again.");
		} finally {
			setSubmitting(false);
		}
	}, [
		pendingScore,
		submitting,
		submitted,
		name,
		deviceId,
		eventId,
		onSubmitted,
	]);

	const displayState: BoardState = submitted
		? { status: "ready", board: submitted.board }
		: state;

	return (
		<dialog
			ref={dialogRef}
			tabIndex={-1}
			aria-labelledby={titleId}
			onClose={onClose}
			onClick={onBackdropClick}
			onKeyDown={onDialogKeyDown}
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

				{personalBest && (
					<div className="flex items-baseline justify-between gap-3 rounded border-2 border-stone-800 bg-stone-50 px-3 py-2">
						<span className="font-heading text-[10px] uppercase tracking-wide">
							New best
						</span>
						<span className="font-heading text-sm tabular-nums">
							{formatScore(pendingScore)}
						</span>
					</div>
				)}

				{personalBest && !submitted && (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void submit();
						}}
						className="flex flex-col gap-2"
					>
						<div className="flex items-center justify-between gap-3">
							<label
								htmlFor={inputId}
								className="font-heading text-[10px] uppercase tracking-wide text-stone-600"
							>
								Your handle
							</label>
							<span
								className="font-heading text-[10px] text-stone-500"
								aria-hidden="true"
							>
								{name.length}/8
							</span>
						</div>
						<input
							id={inputId}
							ref={inputRef}
							type="text"
							value={name}
							onChange={(event) => setName(normalizeName(event.target.value))}
							// A space can never enter the field; strip-on-change alone would
							// still let the keystroke through to the dialog handler.
							onKeyDown={(event) => {
								if (event.code === "Space") event.preventDefault();
							}}
							maxLength={8}
							autoComplete="off"
							autoCapitalize="characters"
							autoCorrect="off"
							spellCheck={false}
							placeholder="AAA"
							className="w-full rounded border-2 border-stone-800 bg-white px-3 py-2 font-heading text-sm uppercase tracking-widest placeholder:text-stone-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800"
						/>
						{submitError && (
							<p role="alert" className="font-body text-base text-red-700">
								{submitError}
							</p>
						)}
						<button
							type="submit"
							disabled={name.length === 0 || submitting}
							className="inline-flex min-h-11 items-center justify-center rounded border-2 border-stone-800 bg-stone-800 px-4 font-heading text-[10px] uppercase text-white transition hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
						>
							{submitting ? "Sending…" : submitError ? "Try again" : "Submit"}
						</button>
					</form>
				)}

				{personalBest && submitted && (
					<p className="font-body text-lg text-stone-600">
						Your score is on the board.
					</p>
				)}

				<div className="min-h-0 overflow-y-auto">
					<Board
						state={displayState}
						onRetry={onRetry}
						pending={
							personalBest && !submitted && pendingScore != null
								? {
										deviceId: "",
										name: name.length > 0 ? name : "—",
										score: pendingScore,
										at: "",
									}
								: null
						}
						deviceId={submitted ? submitted.entry.deviceId : deviceId}
						submittedEntry={submitted?.entry ?? null}
					/>
				</div>
			</div>
		</dialog>
	);
}

type Row = {
	entry: ScoreEntry;
	pending: boolean;
	isMine: boolean;
	isNew: boolean;
};

function Board({
	state,
	onRetry,
	pending,
	deviceId,
	submittedEntry,
}: {
	state: BoardState;
	onRetry: () => void;
	pending: ScoreEntry | null;
	deviceId: string | null;
	submittedEntry: ScoreEntry | null;
}) {
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

	const entries: { entry: ScoreEntry; pending: boolean }[] = [
		...state.board.map((entry) => ({ entry, pending: false })),
	];
	// The server board is truncated to `BOARD_LIMIT`, so a score below the cut
	// would vanish at the very moment it is submitted — the disappearance the
	// pending row exists to prevent. Keep showing it, ranked last. It is below
	// every fetched row by definition (otherwise the server would have included
	// it), so appending preserves score order and the `at` ascending tie-break.
	if (
		submittedEntry &&
		!state.board.some((entry) => entry.deviceId === submittedEntry.deviceId)
	) {
		entries.push({ entry: submittedEntry, pending: false });
	}
	if (pending) {
		// Ties place the pending row after existing equal scores: it was submitted
		// later, which matches the server's `at` ascending tie-break. The row is
		// appended when it is worse than every existing score, so a personal best
		// below the fetched top-N still shows itself rather than silently vanishing.
		const at = entries.findIndex((row) => pending.score > row.entry.score);
		const insertAt = at === -1 ? entries.length : at;
		entries.splice(insertAt, 0, { entry: pending, pending: true });
	}

	if (entries.length === 0) {
		return (
			<p className="py-6 text-center font-body text-lg text-stone-500">
				No scores yet — be the first.
			</p>
		);
	}

	const rows: Row[] = entries.map((row) => ({
		...row,
		isMine: !row.pending && deviceId != null && row.entry.deviceId === deviceId,
		isNew:
			!row.pending &&
			submittedEntry != null &&
			row.entry.deviceId === submittedEntry.deviceId,
	}));

	return (
		<ol className="flex flex-col">
			{rows.map((row, index) => (
				<li
					key={
						row.pending ? "pending" : `${row.entry.deviceId}-${row.entry.at}`
					}
					className={`grid grid-cols-[2rem_1fr_auto] items-baseline gap-x-2 border-b border-stone-100 py-1.5 font-heading text-[11px] last:border-b-0 ${
						row.pending
							? "rounded bg-amber-50 ring-1 ring-amber-400"
							: row.isMine || row.isNew
								? "bg-amber-50"
								: ""
					}`}
				>
					<span className="text-right text-stone-400">
						{String(index + 1).padStart(2, "0")}
					</span>
					{/* Untrusted handle from another visitor: a React text node, never
					    `innerHTML`. Keep it that way. */}
					<span className="truncate uppercase">{row.entry.name}</span>
					<span className="flex items-center justify-end gap-1.5 text-right tabular-nums">
						{row.pending && (
							<span className="rounded bg-amber-500 px-1 py-0.5 font-heading text-[8px] leading-none text-white">
								YOU
							</span>
						)}
						{row.isNew && (
							<span className="rounded bg-stone-900 px-1 py-0.5 font-heading text-[8px] leading-none text-white">
								NEW
							</span>
						)}
						{formatScore(row.entry.score)}
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
