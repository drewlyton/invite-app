import { getCollection } from "astro:content";
import { OGImageRoute } from "astro-og-canvas";
import { resolveTheme } from "../../lib/themes";

export const prerender = true;

const events = await getCollection("event");

// Build a map of eventId -> event data for OGImageRoute to walk.
const pages = Object.fromEntries(events.map((event) => [event.id, event.data]));

export const { getStaticPaths, GET } = await OGImageRoute({
	pages,
	getSlug: (key) => key,
	getImageOptions: (_key, data) => {
		const theme = resolveTheme(data.theme);
		const bg = theme.heroBg === "transparent" ? "#ffffff" : theme.heroBg;
		const bgRgb = hexToRgb(bg);
		const accentRgb = hexToRgb(theme.accent);
		const fgRgb = hexToRgb(theme.heroText);

		const description = [
			data.subtitle,
			"",
			`${data.date} · ${data.time}`,
			data.location,
			"",
			`RSVP by ${data.rsvp_by}`,
		].join("\n");

		return {
			title: data.title,
			description,
			bgGradient: [bgRgb, bgRgb],
			border: {
				color: accentRgb,
				width: 6,
				side: "inline-start",
			},
			padding: 80,
			font: {
				title: {
					color: accentRgb,
					size: 84,
					weight: "Bold",
					lineHeight: 1.1,
				},
				description: {
					color: fgRgb,
					size: 32,
					lineHeight: 1.4,
				},
			},
		};
	},
});

function hexToRgb(hex: string): [number, number, number] {
	const normalized = hex.replace("#", "");
	const value =
		normalized.length === 3
			? normalized
					.split("")
					.map((c) => c + c)
					.join("")
			: normalized;
	const num = Number.parseInt(value, 16);
	return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
