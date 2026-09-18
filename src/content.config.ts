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
	}),
});

export const collections = { event };
