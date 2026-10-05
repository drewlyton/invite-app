/**
 * The messages for the hero's single runner status line.
 *
 * The line is one server-rendered element: `IDLE_STATUS` ships in the HTML and
 * the island rewrites it with `textContent` while a run is in flight or dead.
 * `Invite.astro` also renders `DEAD_STATUS` a second time as an invisible
 * spacer, so the slot reserves the tallest message's height on every viewport
 * where the slot is shown (it is hidden entirely under reduced motion). Keeping
 * the strings here is what stops the spacer and the island from drifting apart —
 * a spacer using a stale message would reserve the wrong height and reintroduce
 * the layout shift this line exists to remove.
 */

import { formatScore } from "./score-format";

/** Idle prompt. Server-rendered, and never rewritten — idle is terminal. */
export const IDLE_STATUS = "Click / Space / Tap to Play";

/** Written by the island once the run ends. */
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
