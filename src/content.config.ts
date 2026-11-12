import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { TITLE_ART_NAMES } from "./lib/title-art";

const event = defineCollection({
	loader: glob({ base: "./src/content/event", pattern: "**/*.{md,mdx}" }),
	schema: z.object({
		title: z.string(),
		subtitle: z.string().optional(),
		date: z.string(),
		time: z.string(),
		location: z.string(),
		rsvp_by: z.string(),
		theme: z.string().optional(),
		// Optional pixel-art lockup to render in place of the plain-text `title`
		// in the hero heading. The `title` is still required: it names the page,
		// carries `og:title`, and becomes the heading's accessible name, so the
		// art is presentation only. Omit the field for the normal text heading.
		title_art: z.enum(TITLE_ART_NAMES).optional(),
		// ISO 8601 datetime WITH timezone offset, e.g.
		// "2026-09-26T16:00:00-04:00". Required for the .ics calendar
		// invite (the display `date`/`time` strings above are kept for
		// human readability but aren't parseable).
		start: z.string().optional(),
		// ISO 8601 end time. If omitted, defaults to start + 3 hours.
		end: z.string().optional(),
		// Additional host notification emails for this event. Merged
		// with the global HOST_NOTIFICATION_EMAILS env var at send time.
		hosts: z.array(z.email()).optional(),
		// Optional second activity guests can opt into on top of the event
		// itself (e.g. a game after dinner). Renders as a yes/no question in
		// the RSVP form; guests may skip it, in which case no answer is
		// recorded. Omit the field entirely for events without one.
		side_activity: z
			.object({
				question: z.string(),
				time: z.string(),
			})
			.optional(),
	}),
});

export const collections = { event };
