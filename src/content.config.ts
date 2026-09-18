import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

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
		// ISO 8601 datetime WITH timezone offset, e.g.
		// "2026-09-26T16:00:00-04:00". Required for the .ics calendar
		// invite (the display `date`/`time` strings above are kept for
		// human readability but aren't parseable).
		start: z.string().optional(),
		// ISO 8601 end time. If omitted, defaults to start + 3 hours.
		end: z.string().optional(),
		// Additional host notification emails for this event. Merged
		// with the global HOST_NOTIFICATION_EMAILS env var at send time.
		hosts: z.array(z.string().email()).optional(),
	}),
});

export const collections = { event };
