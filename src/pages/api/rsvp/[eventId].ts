import type { APIRoute } from "astro";
import fs from "node:fs";
import path from "node:path";

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
  const eventId = params.eventId;
  try {
    const formData = await request.formData();

    const data = Object.fromEntries(formData.entries());
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

export const GET: APIRoute = async ({ params }) => {
  const eventId = params.eventId;
  try {
    // Define file path in your project or server storage
    const filePath = path.resolve(process.cwd(), `data/${eventId}.ndjson`);

    // Ensure directory exists
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // Append the line to the file
    const file = fs.readFileSync(filePath, "utf8");

    return new Response(JSON.stringify(file), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Failed to read file" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
