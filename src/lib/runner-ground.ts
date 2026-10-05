import { TUNING } from "./runner";

/**
 * Opacity of the runner's ground fill.
 *
 * The hero's canvas fills from the ground line to the bottom of the band with
 * `theme.runner.ground ?? theme.runner.color` at this alpha, and the below-fold
 * details section paints the same colour at the same alpha over the page so the
 * two read as one continuous ground rather than a coloured band with a hard
 * seam. The value lives here once because two copies would drift, and the seam
 * between the hero and the section is exactly where it would show.
 */
export const GROUND_FILL_ALPHA = 0.22;

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
 * ground is already muted at `GROUND_FILL_ALPHA` and hero/details text sits on
 * it, so the texture must read as grain, not as a pattern.
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
