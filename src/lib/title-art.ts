/**
 * The pixel-art title lockups an event can opt into with `title_art`.
 *
 * The names live here rather than in either consumer because both need them:
 * `src/content.config.ts` validates the frontmatter against them, and
 * `src/components/TitleArt.astro` switches on them to pick the artwork. Adding
 * a lockup means adding its name here and its shapes in that component.
 */
export const TITLE_ART_NAMES = ["drew-30th"] as const;

export type TitleArtName = (typeof TITLE_ART_NAMES)[number];
