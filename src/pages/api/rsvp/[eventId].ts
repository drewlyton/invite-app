import fs from "node:fs";
import path from "node:path";
import { getEntry } from "astro:content";
import type { APIRoute } from "astro";
import { sendRsvpConfirmation } from "../../../lib/email.js";

export const prerender = false;

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

		// Best-effort confirmation email. We deliberately don't await this
		// before the response *and* we don't propagate email errors to the
		// RSVP response — the user already submitted successfully. Failures
		// are logged so they can be retried manually if needed.
		if (
			data &&
				typeof data === "object" &&
				data.status === "going" &&
				typeof data.email === "string" &&
				data.email.includes("@") &&
				typeof data.name === "string" &&
				data.name.trim().length > 0
		) {
			const event = await getEntry("event", eventId as string);
			if (event) {
				const eventUrl = `${url.protocol}//${url.host}/events/${eventId}`;
				const result = await sendRsvpConfirmation({
					to: data.email,
					name: data.name,
					event: {
						id: event.id,
						title: event.data.title,
						date: event.data.date,
						time: event.data.time,
						location: event.data.location,
						start: event.data.start,
						end: event.data.end,
					},
					eventUrl,
					partySize:
						typeof data.party_size === "number" && data.party_size >= 1
							? Math.min(10, Math.floor(data.party_size))
							: 1,
					dietary:
						typeof data.dietary === "string" && data.dietary.trim()
							? data.dietary
							: undefined,
					notes:
						typeof data.notes === "string" && data.notes.trim()
							? data.notes
							: undefined,
				});
				if (!result.ok) {
					console.warn(
						`[rsvp] confirmation email failed for ${data.email} (event=${eventId}): ${result.error}`,
					);
				} else {
					console.log(
						`[rsvp] confirmation email sent to ${data.email} (event=${eventId})`,
					);
				}
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
