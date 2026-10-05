/**
 * Display formatting for scores, shared by the canvas HUD (`RunnerGame.tsx`)
 * and the DOM leaderboard (`Leaderboard.tsx`).
 *
 * Both columns must be the same width or the DOM board and the canvas read as
 * two different systems. A literal `5` on each side is exactly the duplicated
 * constant this project has already been bitten by (`MIN_WORLD_WIDTH`, a
 * hand-copied `SPEC_AIR_TIME`, the tuning table); the width lives here once.
 */

/** Width of a zero-padded score, in characters. */
export const SCORE_DIGITS = 5;

/**
 * Zero-pad a score to `SCORE_DIGITS` for an aligned, arcade-style column.
 * Clamps to a non-negative integer first, so a stray float or negative can
 * never produce a ragged or negative-width string.
 */
export function formatScore(score: number): string {
	return String(Math.max(0, Math.floor(score))).padStart(SCORE_DIGITS, "0");
}
