/**
 * Score store for the pre-party leaderboard.
 *
 * DOM-free and dependency-free (Node core only) so `scripts/verify-scores.ts`
 * can drive it directly, the same reason `runner.ts` is pure. Storage is
 * append-only NDJSON at `data/<eventId>-scores.ndjson`, one JSON object per
 * line: every submission is appended, and grouping/ordering happen on read so
 * two simultaneous submissions never race a read-modify-write.
 *
 * Unlike the RSVP endpoint, which logs the raw client body, this store only
 * ever holds a *normalized* record. RSVP data is a write-only log read by a
 * human; leaderboard data is read back and shown to other visitors, so the
 * server owns the shape and the client's input is never stored verbatim.
 */

import fs from "node:fs";
import path from "node:path";
// `.ts` rather than the repo's usual `.js` specifier on purpose: Node's type
// stripping does not rewrite `.js` to `.ts`, so the store could not be driven
// from scripts/verify-scores.ts with a `.js` import. Vite, Astro and tsc all
// accept the explicit extension (`allowImportingTsExtensions` is on).
import { TUNING } from "./runner.ts";

/** A normalized board entry. `at` is set by the server, never by the client. */
export type ScoreEntry = {
	deviceId: string;
	name: string;
	score: number;
	at: string;
};

/** `normalizeScoreInput` either yields a stored record or a displayable error. */
export type NormalizeResult =
	| { ok: true; entry: ScoreEntry }
	| { ok: false; error: string };

/** Board size. Ordering/grouping happens in `readBoard`. */
export const BOARD_LIMIT = 10;

/**
 * Plausibility cap: an hour of perfect running, derived from the game's own
 * tuning rather than hardcoded. `score = floor(distance / scoreUnit)` and
 * `distance` accrues at most `maxSpeed` units per second, so this is the
 * largest score the real simulation could ever produce. Deriving it keeps the
 * cap honest if the game is re-tuned; a literal here would silently drift.
 */
export const MAX_SCORE = Math.floor(
	(TUNING.maxSpeed * 3600) / TUNING.scoreUnit,
);

const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const NAME_PATTERN = /^[A-Z0-9]{1,8}$/;
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const NAME_ERROR = "Name must be 1-8 letters or digits.";

/**
 * Event ids reach us from the URL, and they name a file on disk. Allowing only
 * `[A-Za-z0-9._-]` (and no leading dot) keeps `/` and `..` out of the path
 * while still covering the slug-shaped ids the content collection uses.
 */
export function isValidEventId(eventId: string): boolean {
	return EVENT_ID_PATTERN.test(eventId);
}

/**
 * Path of an event's board. `dataDir` defaults to `<cwd>/data` (the same
 * `path.resolve(process.cwd(), ...)` idiom as the RSVP endpoint) and exists so
 * the verification harness can point at a temp directory.
 */
export function scoresFilePath(eventId: string, dataDir?: string): string {
	if (!isValidEventId(eventId)) {
		throw new Error(`Invalid event id: ${eventId}`);
	}
	const dir = dataDir ?? path.resolve(process.cwd(), "data");
	return path.join(dir, `${eventId}-scores.ndjson`);
}

type FieldResult =
	| { ok: true; deviceId: string; name: string; score: number }
	| { ok: false; error: string };

/**
 * Validate and normalize the three client-supplied fields. Shared by
 * `normalizeScoreInput` (client input) and `coerceStoredEntry` (lines already
 * on disk), so there is one rule set and reading re-checks the shape before it
 * can reach a visitor.
 */
function validateFields(raw: unknown): FieldResult {
	if (typeof raw !== "object" || raw === null) {
		return { ok: false, error: "Invalid submission." };
	}
	const body = raw as Record<string, unknown>;

	const deviceId = body.deviceId;
	if (typeof deviceId !== "string" || !DEVICE_ID_PATTERN.test(deviceId)) {
		return { ok: false, error: "Invalid device id." };
	}

	if (typeof body.name !== "string") {
		return { ok: false, error: NAME_ERROR };
	}
	// Uppercase, then strip everything outside A-Z0-9, then bound the length.
	const name = body.name.toUpperCase().replace(/[^A-Z0-9]/g, "");
	if (!NAME_PATTERN.test(name)) {
		return { ok: false, error: NAME_ERROR };
	}

	const score = body.score;
	if (typeof score !== "number" || !Number.isInteger(score)) {
		return { ok: false, error: "Score must be a whole number." };
	}
	if (score < 0 || score > MAX_SCORE) {
		return {
			ok: false,
			error: `Score must be between 0 and ${MAX_SCORE}.`,
		};
	}

	return { ok: true, deviceId, name, score };
}

/**
 * Validate and normalize a client submission. `now` (the submission time) is
 * injectable so the harness can produce deterministic tie-breaks; production
 * always uses the default.
 */
export function normalizeScoreInput(
	raw: unknown,
	now: Date = new Date(),
): NormalizeResult {
	const fields = validateFields(raw);
	if (!fields.ok) return fields;
	return {
		ok: true,
		entry: {
			deviceId: fields.deviceId,
			name: fields.name,
			score: fields.score,
			at: now.toISOString(),
		},
	};
}

/** Parse one NDJSON line into an entry, or `null` if the line is malformed. */
function coerceStoredEntry(value: unknown): ScoreEntry | null {
	if (typeof value !== "object" || value === null) return null;
	const fields = validateFields(value);
	if (!fields.ok) return null;
	const at = (value as Record<string, unknown>).at;
	if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return null;
	return {
		deviceId: fields.deviceId,
		name: fields.name,
		score: fields.score,
		at,
	};
}

/** Append one normalized record as a single NDJSON line. */
export function appendScore(
	eventId: string,
	record: ScoreEntry,
	dataDir?: string,
): void {
	const filePath = scoresFilePath(eventId, dataDir);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

/**
 * Read, group, sort and truncate a board.
 *
 * Grouping keeps the highest score per `deviceId` (using that entry's `name`
 * and `at`); a tie on a device keeps the earliest submission. Ordering is
 * score descending, then `at` ascending. A malformed line is skipped, never
 * fatal — one corrupt byte must not take the whole board down.
 */
export function readBoard(
	eventId: string,
	limit: number = BOARD_LIMIT,
	dataDir?: string,
): ScoreEntry[] {
	const filePath = scoresFilePath(eventId, dataDir);
	let contents: string;
	try {
		contents = fs.readFileSync(filePath, "utf8");
	} catch (err) {
		// No file yet simply means an empty board.
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}

	const best = new Map<string, ScoreEntry>();
	for (const line of contents.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			continue;
		}
		const entry = coerceStoredEntry(parsed);
		if (!entry) continue;
		const current = best.get(entry.deviceId);
		if (!current || entry.score > current.score) {
			best.set(entry.deviceId, entry);
		}
	}

	return [...best.values()]
		.sort((a, b) => b.score - a.score || a.at.localeCompare(b.at))
		.slice(0, Math.max(0, limit));
}
