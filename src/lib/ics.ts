import { createEvent, type EventAttributes, type DateArray } from "ics";

export interface EventForIcs {
	id: string;
	title: string;
	location: string;
	// Human-readable display strings, used in the email body.
	date: string;
	time: string;
	// ISO 8601 datetime WITH offset, e.g. "2026-09-26T16:00:00-04:00".
	start?: string;
	// ISO 8601 end time; defaults to start + 3h.
	end?: string;
}

const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000;

function isoToDate(iso: string): Date | null {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d;
}

function toDateArray(d: Date): DateArray {
	return [
		d.getUTCFullYear(),
		d.getUTCMonth() + 1,
		d.getUTCDate(),
		d.getUTCHours(),
		d.getUTCMinutes(),
	];
}

/**
 * Build an .ics file (as a Buffer) for the given event. Returns null if the
 * event has no `start` ISO timestamp — callers should treat that as
 * "send the email without an attachment" rather than failing.
 */
export function buildIcsAttachment(
	event: EventForIcs,
	url: string,
): { filename: string; content: Buffer } | null {
	if (!event.start) return null;

	const startDate = isoToDate(event.start);
	if (!startDate) return null;

	const endDate =
		(event.end ? isoToDate(event.end) : null) ??
		new Date(startDate.getTime() + DEFAULT_DURATION_MS);

	const attrs: EventAttributes = {
		uid: `${event.id}@invite-app.local`,
		title: event.title,
		start: toDateArray(startDate),
		startInputType: "utc",
		end: toDateArray(endDate),
		endInputType: "utc",
		location: event.location,
		url,
		description: `Details & directions: ${url}`,
		productId: "-//invite-app//EN",
		// PUBLISH for an informational notice. REQUEST is reserved for
		// invitations the organizer expects attendees to RSVP to.
		method: "PUBLISH",
	};

	const result = createEvent(attrs);
	if (result.error || !result.value) return null;

	return {
		filename: `${event.id}.ics`,
		content: Buffer.from(result.value, "utf8"),
	};
}
