import fs from "node:fs";
import path from "node:path";
import { getEntry } from "astro:content";
import type { APIRoute } from "astro";
import {
	sendHostNotification,
	sendRsvpConfirmation,
} from "../../../lib/email.js";

export const prerender = false;

/**
 * Build the list of host notification recipients: union of the global
 * `HOST_NOTIFICATION_EMAILS` env var (comma-separated) and the event's
 * optional `hosts` frontmatter field, deduplicated.
 */
function getHostEmails(eventHosts: string[] | undefined): string[] {
	const fromEnv = (process.env.HOST_NOTIFICATION_EMAILS ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && s.includes("@"));
	const combined = [...fromEnv, ...(eventHosts ?? [])];
	return [...new Set(combined.map((s) => s.toLowerCase()))];
}

export const POST: APIRoute = async ({ request, params, url }) => {
	const eventId = params.eventId;

	try {
		const data = await request.json();

		// Format data as a single NDJSON line
		const ndjsonLine = JSON.stringify(data) + "\n";

		// Define file path in your project or server storage
		const filePath = path.resolve(process.cwd(), `data/${eventId}.ndjson`);

		// Ensure directory exists
		fs.mkdirSync(path.dirname(filePath), { recursive: true });

		// Append the line to the file
		fs.appendFileSync(filePath, ndjsonLine, "utf8");

		const event = await getEntry("event", eventId as string);

		// Fire-and-forget confirmation email to the guest (only when they
		// opted in by leaving an email and marking themselves "going"). We
		// intentionally don't await before the response — the user already
		// submitted successfully and a slow email backend must never block
		// the RSVP response.
		if (
			event &&
			data &&
			typeof data === "object" &&
			data.status === "going" &&
			typeof data.email === "string" &&
			data.email.includes("@") &&
			typeof data.name === "string" &&
			data.name.trim().length > 0
		) {
			const eventUrl = `${url.protocol}//${url.host}/events/${eventId}`;
			const partySize =
				typeof data.party_size === "number" && data.party_size >= 1
					? Math.min(10, Math.floor(data.party_size))
					: 1;
			const dietary =
				typeof data.dietary === "string" && data.dietary.trim()
					? data.dietary
					: undefined;
			const notes =
				typeof data.notes === "string" && data.notes.trim() ? data.notes : undefined;

			const eventForEmail = {
				id: event.id,
				title: event.data.title,
				date: event.data.date,
				time: event.data.time,
				location: event.data.location,
				start: event.data.start,
				end: event.data.end,
			};

			sendRsvpConfirmation({
				to: data.email,
				name: data.name,
				event: eventForEmail,
				eventUrl,
				partySize,
				dietary,
				notes,
			})
				.then((result) => {
					if (!result.ok) {
						console.warn(
							`[rsvp] confirmation email failed for ${data.email} (event=${eventId}): ${result.error}`,
						);
					} else {
						console.log(
							`[rsvp] confirmation email sent to ${data.email} (event=${eventId})`,
						);
					}
				})
				.catch((err) => {
					console.error(`[rsvp] unexpected guest email error:`, err);
				});
		}

		// Fire-and-forget host notification (always sent regardless of
		// "going" / "not-going" so you can see who declined too).
		if (
			event &&
			data &&
			typeof data === "object" &&
			typeof data.name === "string" &&
			data.name.trim().length > 0
		) {
			const hosts = getHostEmails(event.data.hosts);
			if (hosts.length > 0) {
				const partySize =
					typeof data.party_size === "number" && data.party_size >= 1
						? Math.min(10, Math.floor(data.party_size))
						: 1;
				const dietary =
					typeof data.dietary === "string" && data.dietary.trim()
						? data.dietary
						: undefined;
				const notes =
					typeof data.notes === "string" && data.notes.trim()
						? data.notes
						: undefined;
				const guestEmail =
					typeof data.email === "string" && data.email.includes("@")
						? data.email
						: undefined;
				const status =
					data.status === "going" || data.status === "not-going"
						? data.status
						: "going";

				sendHostNotification({
					hosts,
					name: data.name,
					status,
					guestEmail,
					partySize,
					dietary,
					notes,
					event: {
						id: event.id,
						title: event.data.title,
						date: event.data.date,
						time: event.data.time,
						location: event.data.location,
						start: event.data.start,
						end: event.data.end,
					},
				})
					.then((result) => {
						if (!result.ok) {
							console.warn(
								`[rsvp] host notification failed (event=${eventId}): ${result.error}`,
							);
						} else {
							console.log(
								`[rsvp] host notification sent to ${hosts.join(", ")} (event=${eventId})`,
							);
						}
					})
					.catch((err) => {
						console.error(`[rsvp] unexpected host email error:`, err);
					});
			}
		}

		return new Response(JSON.stringify({ success: true }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	} catch (error) {
		console.error(error);
		return new Response(JSON.stringify({ error: "Failed to write file" }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
};
