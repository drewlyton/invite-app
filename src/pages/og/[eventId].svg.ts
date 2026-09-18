import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { resolveTheme } from "../../lib/themes";

export const prerender = true;

export async function getStaticPaths() {
	const events = await getCollection("event");
	return events.map((event) => ({
		params: { eventId: event.id },
	}));
}

export const GET: APIRoute = async ({ params }) => {
	const events = await getCollection("event");
	const event = events.find((e) => e.id === params.eventId);

	if (!event) {
		return new Response("Event not found", { status: 404 });
	}

	const { title, subtitle, date, time, location, rsvp_by } = event.data;
	const theme = resolveTheme(event.data.theme);

	const bg = theme.heroBg === "transparent" ? "#ffffff" : theme.heroBg;
	const accent = theme.accent;
	const fg = theme.heroText;

	const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${bg}" />

  <text
    x="80" y="120"
    font-family="system-ui, -apple-system, sans-serif"
    font-size="22"
    font-weight="600"
    letter-spacing="6"
    fill="${fg}"
    opacity="0.6"
  >YOU&#39;RE INVITED TO</text>

  <text
    x="80" y="270"
    font-family="system-ui, -apple-system, sans-serif"
    font-size="84"
    font-weight="700"
    fill="${accent}"
  >${escapeXml(truncate(title, 30))}</text>

  <text
    x="80" y="350"
    font-family="system-ui, -apple-system, sans-serif"
    font-size="40"
    font-weight="400"
    fill="${fg}"
    opacity="0.85"
  >${escapeXml(truncate(subtitle, 60))}</text>

  <line x1="80" y1="410" x2="180" y2="410" stroke="${accent}" stroke-width="4" opacity="0.6" />

  <text
    x="80" y="480"
    font-family="system-ui, -apple-system, sans-serif"
    font-size="30"
    fill="${fg}"
    opacity="0.85"
  >${escapeXml(date)}</text>

  <text
    x="80" y="525"
    font-family="system-ui, -apple-system, sans-serif"
    font-size="30"
    fill="${fg}"
    opacity="0.85"
  >${escapeXml(time)}</text>

  <text
    x="80" y="570"
    font-family="system-ui, -apple-system, sans-serif"
    font-size="30"
    fill="${fg}"
    opacity="0.85"
  >${escapeXml(truncate(location, 50))}</text>

  <text
    x="1120" y="595"
    text-anchor="end"
    font-family="system-ui, -apple-system, sans-serif"
    font-size="18"
    fill="${fg}"
    opacity="0.5"
  >RSVP by ${escapeXml(rsvp_by)}</text>
</svg>`;

	return new Response(svg, {
		status: 200,
		headers: {
			"Content-Type": "image/svg+xml",
			"Cache-Control": "public, max-age=3600",
		},
	});
};

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function truncate(str: string, max: number): string {
	return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}