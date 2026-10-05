/**
 * The messages for the hero's single runner status line.
 *
 * The line is one server-rendered element: `IDLE_STATUS` ships in the HTML and
 * the island rewrites it with `textContent` while a run is in flight or dead.
 * `Invite.astro` also renders `deadStatus(MAX_SCORE, MAX_SCORE)` a second time
 * as an invisible spacer, so the slot reserves the tallest message's height on
 * every viewport where the slot is shown (it is hidden entirely under reduced
 * motion). Keeping the strings here is what stops the spacer and the island
 * from drifting apart — a spacer using a stale message would reserve the wrong
 * height and reintroduce the layout shift this line exists to remove.
 *
 * The dead state is the tallest: it keeps the final score visible alongside the
 * game-over message, on two lines (the running line, then `DEAD_STATUS`).
 */

import { formatScore } from "./score-format";

/** Idle prompt. Server-rendered, and never rewritten — idle is terminal. */
export const IDLE_STATUS = "Click / Space / Tap to Play";

/** The game-over line. Shown as the dead state's second line. */
export const DEAD_STATUS = "Game over — press space to retry";

/**
 * The running message: the live high score and score in two fixed-width
 * columns. The three spaces between them are load-bearing — the status element
 * carries `whitespace-pre-wrap` so they are not collapsed, which is what keeps
 * the two columns aligned as the numbers change. `formatScore` is shared with
 * the leaderboard so both read as one arcade system.
 */
export function runningStatus(highScore: number, score: number): string {
	return `HI ${formatScore(highScore)}   ${formatScore(score)}`;
}

/**
 * The dead message: the final score line, then the game-over line below it.
 * The spacer must be given `MAX_SCORE` (the widest score the store accepts),
 * not zero: `formatScore` pads to `SCORE_DIGITS` but a legitimate score can
 * exceed that width, so a zero-score spacer would reserve a box one character
 * narrower than a real final score line. `scores.ts` is deliberately not
 * imported here — this module is part of the client island and must stay free
 * of `node:fs`.
 */
export function deadStatus(highScore: number, score: number): string {
	return `${runningStatus(highScore, score)}\n${DEAD_STATUS}`;
}
