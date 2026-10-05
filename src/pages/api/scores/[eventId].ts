import type { APIRoute } from "astro";
import {
	appendScore,
	BOARD_LIMIT,
	isValidEventId,
	normalizeScoreInput,
	readBoard,
} from "../../../lib/scores.js";

export const prerender = false;

function json(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/** `GET /api/scores/[eventId]` -> `200 { board }`. */
export const GET: APIRoute = ({ params }) => {
	const eventId = params.eventId;
	if (!eventId || !isValidEventId(eventId)) {
		return json({ error: "Unknown event." }, 400);
	}
	return json({ board: readBoard(eventId, BOARD_LIMIT) }, 200);
};

/**
 * `POST /api/scores/[eventId]` — body `{ deviceId, name, score }`.
 *
 * Returns the normalized entry plus the recomputed top-N board so the client
 * can render the authoritative result from a single request with no follow-up
 * fetch. Only the normalized entry is persisted; the raw body never lands on
 * disk.
 */
export const POST: APIRoute = async ({ request, params }) => {
	const eventId = params.eventId;
	if (!eventId || !isValidEventId(eventId)) {
		return json({ error: "Unknown event." }, 400);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "Invalid JSON body." }, 400);
	}

	const result = normalizeScoreInput(body);
	if (!result.ok) {
		return json({ error: result.error }, 400);
	}

	appendScore(eventId, result.entry);
	return json(
		{ entry: result.entry, board: readBoard(eventId, BOARD_LIMIT) },
		201,
	);
};
