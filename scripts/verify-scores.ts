/**
 * Standalone verification for src/lib/scores.ts (the leaderboard score store).
 *
 *   node --experimental-strip-types scripts/verify-scores.ts
 *
 * Mirrors the shape of scripts/verify-runner.ts: plain Node, no test runner,
 * every assertion printed with its evidence, non-zero exit if a required
 * assertion fails. All data goes to a fresh temp directory — the real
 * `data/` directory is never touched — and the score cap is derived from
 * `TUNING` rather than copied, so a re-tune cannot leave a stale mirror here.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TUNING } from "../src/lib/runner.ts";
import {
	appendScore,
	BOARD_LIMIT,
	MAX_SCORE,
	normalizeScoreInput,
	readBoard,
	type ScoreEntry,
	scoresFilePath,
} from "../src/lib/scores.ts";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "verify-scores-"));
const FIXED_NOW = new Date("2027-01-02T18:04:11.221Z");

type Assertion = { name: string; pass: boolean; detail: string };

let eventCounter = 0;
/** A distinct event id per scenario, so each board gets its own temp file. */
function freshEventId(label: string): string {
	eventCounter += 1;
	return `verify-${eventCounter}-${label}`;
}

/** Deterministic submission time: base instant plus `seconds`. */
function isoAt(seconds: number): string {
	return new Date(FIXED_NOW.getTime() + seconds * 1000).toISOString();
}

function entry(
	deviceId: string,
	name: string,
	score: number,
	atSeconds: number,
): ScoreEntry {
	return { deviceId, name, score, at: isoAt(atSeconds) };
}

function boardFile(eventId: string): string {
	return scoresFilePath(eventId, DATA_DIR);
}

function fileLines(eventId: string): string[] {
	return fs.readFileSync(boardFile(eventId), "utf8").split("\n");
}

// --- 1. MAX_SCORE is derived from TUNING, not hardcoded ----------------------

function maxScoreTest(): Assertion {
	const derived = Math.floor((TUNING.maxSpeed * 3600) / TUNING.scoreUnit);
	return {
		name: "1. MAX_SCORE derived from TUNING",
		pass: MAX_SCORE === derived,
		detail: `MAX_SCORE=${MAX_SCORE} == floor(maxSpeed ${TUNING.maxSpeed} * 3600s / scoreUnit ${TUNING.scoreUnit}) = ${derived} (an hour of perfect running).`,
	};
}

// --- 2. normalization -------------------------------------------------------

function normalizationTest(): Assertion {
	const cases: { input: string; expected: string }[] = [
		{ input: "drew", expected: "DREW" },
		{ input: "Drew123", expected: "DREW123" },
		{ input: "d-r_e!w", expected: "DREW" },
		{ input: "  ab  ", expected: "AB" },
		{ input: "abcdEFGH", expected: "ABCDEFGH" },
		{ input: "12-34", expected: "1234" },
		{ input: "a1!b2@c3", expected: "A1B2C3" },
	];
	const failures: string[] = [];
	for (const { input, expected } of cases) {
		const result = normalizeScoreInput(
			{ deviceId: "norm-device-1", name: input, score: 5 },
			FIXED_NOW,
		);
		if (!result.ok) {
			failures.push(`"${input}" rejected: ${result.error}`);
		} else if (result.entry.name !== expected) {
			failures.push(
				`"${input}" -> "${result.entry.name}", expected "${expected}"`,
			);
		}
	}
	// The normalized record carries the server timestamp, not a client field.
	const stamped = normalizeScoreInput(
		{ deviceId: "norm-device-1", name: "drew", score: 5, at: "1999-01-01" },
		FIXED_NOW,
	);
	if (!stamped.ok || stamped.entry.at !== FIXED_NOW.toISOString()) {
		failures.push("server timestamp was not applied to the normalized entry");
	}
	return {
		name: "2. Normalization (case, invalid chars, server timestamp)",
		pass: failures.length === 0,
		detail:
			failures.length === 0
				? `${cases.length} inputs normalized: ${cases.map((c) => `"${c.input}"->"${c.expected}"`).join(", ")}; at=${FIXED_NOW.toISOString()} from the server clock.`
				: failures.join("; "),
	};
}

// --- 3. validation rejections and boundaries --------------------------------

function validationTest(): Assertion {
	const d = (suffix: string) => `dev-${suffix}`; // 8+ chars, valid alphabet
	const rejections: { label: string; body: unknown }[] = [
		{ label: "body null", body: null },
		{ label: "body string", body: "nope" },
		{ label: "deviceId missing", body: { name: "DREW", score: 5 } },
		{
			label: "deviceId not a string",
			body: { deviceId: 12345678, name: "DREW", score: 5 },
		},
		{
			label: "deviceId too short (7)",
			body: { deviceId: "abc-123", name: "DREW", score: 5 },
		},
		{
			label: "deviceId too long (65)",
			body: { deviceId: "a".repeat(65), name: "DREW", score: 5 },
		},
		{
			label: "deviceId illegal char",
			body: { deviceId: "abcd_efg", name: "DREW", score: 5 },
		},
		{ label: "name missing", body: { deviceId: d("valid1"), score: 5 } },
		{
			label: "name not a string",
			body: { deviceId: d("valid2"), name: 42, score: 5 },
		},
		{
			label: "name empty",
			body: { deviceId: d("valid3"), name: "", score: 5 },
		},
		{
			label: "name empty after strip",
			body: { deviceId: d("valid4"), name: "!!!", score: 5 },
		},
		{
			label: "name too long (9)",
			body: { deviceId: d("valid5"), name: "abcdefghi", score: 5 },
		},
		{
			label: "name too long after strip (9)",
			body: { deviceId: d("valid6"), name: "abcd-efghi", score: 5 },
		},
		{ label: "score missing", body: { deviceId: d("valid7"), name: "DREW" } },
		{
			label: "score not a number",
			body: { deviceId: d("valid8"), name: "DREW", score: "5" },
		},
		{
			label: "score non-integer",
			body: { deviceId: d("valid9"), name: "DREW", score: 1.5 },
		},
		{
			label: "score negative",
			body: { deviceId: d("validA"), name: "DREW", score: -1 },
		},
		{
			label: `score above MAX_SCORE (${MAX_SCORE + 1})`,
			body: { deviceId: d("validB"), name: "DREW", score: MAX_SCORE + 1 },
		},
	];
	const failures: string[] = [];
	for (const { label, body } of rejections) {
		const result = normalizeScoreInput(body, FIXED_NOW);
		if (result.ok) failures.push(`${label}: accepted (should be 400)`);
		else if (!result.error) failures.push(`${label}: no error message`);
	}

	const acceptances: { label: string; body: unknown }[] = [
		{
			label: "deviceId length 8",
			body: { deviceId: "abcdefgh", name: "DREW", score: 0 },
		},
		{
			label: "deviceId length 64",
			body: { deviceId: "a".repeat(64), name: "DREW", score: 0 },
		},
		{
			label: "deviceId with hyphens",
			body: { deviceId: "A1-b2-C3-d4", name: "DREW", score: 0 },
		},
		{
			label: "name length 8",
			body: { deviceId: d("validC"), name: "abcdefgh", score: 0 },
		},
		{
			label: "score 0",
			body: { deviceId: d("validD"), name: "DREW", score: 0 },
		},
		{
			label: `score MAX_SCORE (${MAX_SCORE})`,
			body: { deviceId: d("validE"), name: "DREW", score: MAX_SCORE },
		},
	];
	for (const { label, body } of acceptances) {
		const result = normalizeScoreInput(body, FIXED_NOW);
		if (!result.ok) failures.push(`${label}: rejected (${result.error})`);
	}

	return {
		name: "3. Validation rejections and boundaries",
		pass: failures.length === 0,
		detail:
			failures.length === 0
				? `${rejections.length} malformed bodies rejected, ${acceptances.length} boundary bodies accepted (deviceId 8-64, name 1-8, score 0..${MAX_SCORE}).`
				: failures.join("; "),
	};
}

// --- 4. only the normalized record is stored --------------------------------

function normalizedStorageTest(): Assertion {
	const eventId = freshEventId("normalized");
	const raw = {
		deviceId: "store-device-1",
		name: "drew",
		score: 42,
		extra: "DROP ME",
		nested: { a: 1 },
	};
	const result = normalizeScoreInput(raw, FIXED_NOW);
	if (!result.ok) {
		return {
			name: "4. Only the normalized record is stored",
			pass: false,
			detail: `valid input was rejected: ${result.error}`,
		};
	}
	appendScore(eventId, result.entry, DATA_DIR);
	const lines = fileLines(eventId).filter((l) => l.trim().length > 0);
	const stored = JSON.parse(lines[0]) as Record<string, unknown>;
	const keys = Object.keys(stored).sort();
	const pass =
		lines.length === 1 &&
		keys.length === 4 &&
		keys.join(",") === "at,deviceId,name,score" &&
		stored.name === "DREW" &&
		!("extra" in stored) &&
		!("nested" in stored);
	return {
		name: "4. Only the normalized record is stored",
		pass,
		detail: `raw body had keys [${Object.keys(raw).join(",")}]; file line has keys [${keys.join(",")}], name "${String(stored.name)}". Raw never hits disk: ${pass}.`,
	};
}

// --- 5. max per device, using that entry's name and at ----------------------

function groupingTest(): Assertion {
	const eventId = freshEventId("group");
	const device = "group-device-1";
	appendScore(eventId, entry(device, "LOW", 10, 100), DATA_DIR);
	appendScore(eventId, entry(device, "NEW", 50, 200), DATA_DIR);
	appendScore(eventId, entry(device, "LAST", 30, 300), DATA_DIR);
	const board = readBoard(eventId, BOARD_LIMIT, DATA_DIR);
	const lineCount = fileLines(eventId).filter((l) => l.trim()).length;
	const pass =
		board.length === 1 &&
		board[0].deviceId === device &&
		board[0].score === 50 &&
		board[0].name === "NEW" &&
		board[0].at === isoAt(200) &&
		lineCount === 3;
	return {
		name: "5. Max score per device (name and at come from that entry)",
		pass,
		detail: `3 submissions (10/LOW, 50/NEW, 30/LAST) for one device -> board size ${board.length}, score ${board[0]?.score}, name ${board[0]?.name}, at ${board[0]?.at}; file kept all ${lineCount} lines.`,
	};
}

// --- 6. order: score desc, then at asc --------------------------------------

function tieBreakTest(): Assertion {
	const eventId = freshEventId("tie");
	appendScore(eventId, entry("tie-device-aa", "A", 42, 900), DATA_DIR);
	appendScore(eventId, entry("tie-device-bb", "B", 42, 300), DATA_DIR);
	appendScore(eventId, entry("tie-device-cc", "C", 99, 1000), DATA_DIR);
	appendScore(eventId, entry("tie-device-dd", "D", 42, 600), DATA_DIR);
	const board = readBoard(eventId, BOARD_LIMIT, DATA_DIR);
	const order = board.map((e) => e.name).join("");
	const pass = order === "CBDA";
	return {
		name: "6. Order (score desc, then at asc)",
		pass,
		detail: `submitted A@900, B@300, C@99@1000, D@600 -> order ${order} (expected CBDA: 99 first, then the 42s by earliest at).`,
	};
}

// --- 7. top-N truncation ----------------------------------------------------

function truncationTest(): Assertion {
	const eventId = freshEventId("truncate");
	const total = BOARD_LIMIT + 5;
	for (let i = 0; i < total; i++) {
		appendScore(
			eventId,
			entry(`trunc-dev-${String(i).padStart(3, "0")}`, `N${i}`, 1000 - i, i),
			DATA_DIR,
		);
	}
	const full = readBoard(eventId, BOARD_LIMIT, DATA_DIR);
	const short = readBoard(eventId, 3, DATA_DIR);
	const expectedLast = 1000 - (BOARD_LIMIT - 1);
	const pass =
		full.length === BOARD_LIMIT &&
		full[0].score === 1000 &&
		full[BOARD_LIMIT - 1].score === expectedLast &&
		short.length === 3 &&
		short[0].score === 1000 &&
		short[2].score === 998;
	return {
		name: "7. Top-N truncation",
		pass,
		detail: `${total} devices -> readBoard(limit=${BOARD_LIMIT}) returned ${full.length} (top ${full[0]?.score} down to ${full[full.length - 1]?.score}); readBoard(limit=3) returned ${short.length} (${short.map((e) => e.score).join(", ")}).`,
	};
}

// --- 8. malformed lines are skipped, never fatal ----------------------------

function malformedTest(): Assertion {
	const eventId = freshEventId("malformed");
	const good1 = entry("good-device-01", "GOOD", 42, 100);
	const good2 = entry("good-device-02", "ALSO", 7, 200);
	const lines = [
		"",
		JSON.stringify(good1),
		"{not json",
		JSON.stringify([1, 2, 3]),
		"42",
		JSON.stringify({ deviceId: "good-device-03" }),
		JSON.stringify({ ...good2, score: "7" }),
		JSON.stringify({ ...good2, at: "not-a-date" }),
		"   ",
		"\t{",
		JSON.stringify(good2),
		"",
	];
	const file = boardFile(eventId);
	fs.mkdirSync(DATA_DIR, { recursive: true });
	fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");

	let board: ScoreEntry[] = [];
	let threw = false;
	try {
		board = readBoard(eventId, BOARD_LIMIT, DATA_DIR);
	} catch (err) {
		threw = true;
		board = [];
		void err;
	}
	const missing = readBoard(
		freshEventId("never-written"),
		BOARD_LIMIT,
		DATA_DIR,
	);
	const pass =
		!threw &&
		board.length === 2 &&
		board[0].name === "GOOD" &&
		board[1].name === "ALSO" &&
		missing.length === 0;
	return {
		name: "8. Malformed lines are skipped, never fatal",
		pass,
		detail: `${lines.length} lines (blank, valid, bad JSON, array, scalar, missing fields, wrong score type, bad timestamp) -> threw: ${threw}, board size ${board.length} (${board.map((e) => e.name).join(", ")}); a never-written event returned ${missing.length}.`,
	};
}

// --- run --------------------------------------------------------------------

const assertions: Assertion[] = [
	maxScoreTest(),
	normalizationTest(),
	validationTest(),
	normalizedStorageTest(),
	groupingTest(),
	tieBreakTest(),
	truncationTest(),
	malformedTest(),
];

const allPass = assertions.every((a) => a.pass);

console.log("Leaderboard score store verification (src/lib/scores.ts)\n");
for (const a of assertions) {
	console.log(`${a.pass ? "PASS" : "FAIL"}  ${a.name}`);
	console.log(`      ${a.detail}\n`);
}
console.log(
	`Overall (normalization + validation + grouping + ordering + truncation + malformed): ${allPass ? "PASS" : "FAIL"}`,
);
console.log(`Temp data directory: ${DATA_DIR} (removed on exit)`);

fs.rmSync(DATA_DIR, { recursive: true, force: true });
process.exitCode = allPass ? 0 : 1;
