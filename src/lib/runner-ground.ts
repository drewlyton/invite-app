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
