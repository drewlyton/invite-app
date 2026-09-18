import fs from "node:fs";
import path from "node:path";
import type { APIRoute } from "astro";

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
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


