import { TUNING } from "./runner";

/**
 * Opacity both stops of the runner's ground gradient are composited at.
 *
 * The hero's canvas fills from the ground line to the bottom of the band with a
 * vertical gradient: `theme.runner.ground ?? theme.runner.color` at the ground
 * line, `theme.runner.groundFar` (falling back to the near ink) at the hero's
 * bottom edge, painted at this alpha. The below-fold details section paints the
 * far end flat at the same alpha over the *hero background* so the two read as
 * one continuous ground rather than a coloured band with a hard seam. Both stops
 * carry this one alpha, so interpolating the two translucent stops over that
 * background lands on the same colour at every y as interpolating the two opaque
 * inks and compositing once — which is why the far end of the canvas band lands
 * exactly on the section's colour.
 *
 * The alpha is not a free feel knob: it decides how far the fill moves off the
 * sky towards the ground ink, and it is set so the gradient's near end lands on
 * ≈`#a6a3a1`, a mid grey in the player sprite's value family. Note *lighter than
 * the sprite*, not equal to it: the sprite's own pixels average ≈`#46413d`
 * (`#443e3a`–`#494341` depending on the pose frame), so the ground sits a clear
 * step above the figure — which brings the ground↔sprite contrast down from
 * ≈8.5:1 (the old near-white band) to ≈4:1. Going further would start to bury
 * the character in the ground it has to read as standing on. It
 * must stay below 1, too: the shared `GROUND_TEXTURE` dashes are the near ink at
 * `GROUND_TEXTURE_ALPHA` drawn *on top* of the fill, and a fully opaque fill
 * would swallow them instead of letting them accumulate to a visible dash.
 *
 * The value lives here once because two copies would drift, and the seam
 * between the hero and the section is exactly where it would show.
 */
export const GROUND_FILL_ALPHA = 0.45;

/**
 * Width of one dirt-texture tile, in world units. The canvas tiles it
 * horizontally along the ground band and the below-fold section paints it as a
 * repeating DOM background; both read the same list so the two never drift.
 */
export const GROUND_TEXTURE_TILE_WIDTH = 48;

/**
 * Height of one dirt-texture tile, in world units. The ground band is exactly
 * `TUNING.groundMargin` world units deep, so the tile's vertical extent is that
 * band rather than an independent art choice.
 */
export const GROUND_TEXTURE_TILE_HEIGHT = TUNING.groundMargin;

/**
 * Thickness of one dirt dash, in world units — one sprite pixel at the game's
 * scale. Shared so the canvas rect and the SVG background cannot disagree about
 * how thick a dash is.
 */
export const GROUND_TEXTURE_DASH_HEIGHT = 1;

/**
 * Opacity of the dirt dashes relative to the ground colour. Kept low: the
 * texture must read as grain rather than a pattern, and hero/details text sits
 * on the band, so the dashes cannot compete with it. It is the value at the
 * *top* of the below-fold section only — that section paints the grain on its own
 * layer and masks it down to nothing with depth (see `.details-ground-grain` in
 * `Invite.astro`), so the canvas band's dashes and the section's first rows meet
 * at this alpha and the grain then dissolves as the ground runs out.
 */
export const GROUND_TEXTURE_ALPHA = 0.3;

/**
 * CSS px per world unit when the texture is painted as a DOM background. The
 * canvas scales by the live `pixelScale` (≈1.5–2.1), which the browser cannot
 * reproduce for a remote element, so the below-fold section uses this single
 * representative value instead. Tuning it only changes the section's grain
 * size; the canvas is unaffected.
 */
export const GROUND_TEXTURE_CSS_SCALE = 2;

/**
 * The staggered dirt dashes inside one tile, in world units measured from the
 * ground line (`x` from the tile's left edge, `y` down from the ground line,
 * each dash `GROUND_TEXTURE_DASH_HEIGHT` tall and `w` units wide). The rows are
 * offset from each
 * other so the tile reads as stratified soil rather than a grid. Both renderers
 * consume this list: the canvas blits each entry as a rect, and the below-fold
 * section turns the same entries into an SVG background. Add or move a dash here
 * once and it lands in both, which is the point — separate copies would drift
 * and the section would stop matching the band.
 */
export const GROUND_TEXTURE: readonly {
	x: number;
	y: number;
	w: number;
}[] = [
	{ x: 1, y: 4, w: 7 },
	{ x: 18, y: 4, w: 5 },
	{ x: 35, y: 4, w: 9 },
	{ x: 9, y: 8, w: 9 },
	{ x: 24, y: 8, w: 4 },
	{ x: 40, y: 8, w: 7 },
	{ x: 3, y: 12, w: 5 },
	{ x: 15, y: 12, w: 7 },
	{ x: 31, y: 12, w: 10 },
	{ x: 12, y: 16, w: 6 },
	{ x: 27, y: 16, w: 3 },
	{ x: 42, y: 16, w: 5 },
	{ x: 0, y: 20, w: 9 },
	{ x: 20, y: 20, w: 6 },
	{ x: 38, y: 20, w: 8 },
];

/**
 * Resolve the ground colour a theme actually paints with. `ground` is optional
 * and falls back to `color`. The fallback lives here once because the canvas
 * fill and the below-fold section tint must agree exactly, or the seam between
 * hero and section shows as a colour step. The first overload keeps the common
 * case — a theme with a definite `color` — a definite result.
 */
export function resolveGroundColor(
	ground: string | undefined,
	color: string,
): string;
export function resolveGroundColor(
	ground: string | undefined,
	color: string | undefined,
): string | undefined;
export function resolveGroundColor(
	ground: string | undefined,
	color: string | undefined,
): string | undefined {
	return ground ?? color;
}

/**
 * Resolve the far end of the ground's vertical gradient. `groundFar` is
 * optional and falls back to the near ink, so a theme that never set it keeps
 * the flat fill it had before the field existed. The fallback lives here once
 * because the canvas gradient's far stop and the below-fold section's tint are
 * both built from it and must agree exactly, or the seam at the hero's bottom
 * edge shows as a colour step; callers must not each re-derive the chain.
 */
export function resolveGroundFarColor(
	groundFar: string | undefined,
	near: string,
): string {
	return groundFar ?? near;
}

/**
 * The dirt texture as a CSS `url(...)` for a DOM background, rebuilt from the
 * same `GROUND_TEXTURE` list the canvas blits. A single tile sits at the origin,
 * so the caller anchors it at the ground line and scales it with
 * `background-size`. The SVG is percent-encoded and quoted with single quotes
 * internally so the URL carries no raw `"`, `<`, `>` or `#`, and
 * `shape-rendering="crispEdges"` keeps the dashes from being antialiased.
 */
export function groundTextureCssUrl(color: string): string {
	const rects = GROUND_TEXTURE.map(
		(dash) =>
			`<rect x="${dash.x}" y="${dash.y}" width="${dash.w}" height="${GROUND_TEXTURE_DASH_HEIGHT}"/>`,
	).join("");
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${GROUND_TEXTURE_TILE_WIDTH}" height="${GROUND_TEXTURE_TILE_HEIGHT}" shape-rendering="crispEdges">` +
		`<g fill="${color}" fill-opacity="${GROUND_TEXTURE_ALPHA}">${rects}</g></svg>`;
	return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
}
