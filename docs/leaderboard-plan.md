# Leaderboard

Pre-party leaderboard for the runner: an invitee who beats their own record can enter a
short handle and post the score, and anyone can view the standings without playing.

Companion to [`hero-runner-game.md`](./hero-runner-game.md), which owns the game itself —
its band, phases, focus behaviour and `Space` semantics. This document owns the scoring
feature and the staged plan for building it.

Status: **planned.** Stages are implemented one at a time and each is reviewed before the
next is dispatched.

## Settled decisions

These were chosen deliberately, several against the obvious alternative. Recorded with
their reasoning so nobody "improves" them later without knowing what was traded.

| Question | Decision |
| --- | --- |
| Trust model | **Trust the client's score.** No server-side replay. A plausibility cap only. |
| Identity | **One row per device**, not per name. Random device id in `localStorage`. |
| Trigger | The dialog auto-opens **only on a new personal best**. |
| Second entry point | A `HIGH SCORES` button in the hero (top-right), read-only mode. |
| Placement | **No** leaderboard section below the RSVP form. |
| Handle | Uppercase `A–Z0–9`, 1–8 chars, no spaces. |
| Abandoned score | Dismissing the dialog **forfeits** that score. No recovery path. |
| Rate limiting | Rely on the existing per-IP middleware limit. |
| Storage | Append-only NDJSON at `data/<eventId>-scores.ndjson`. |
| Dialog | Native `<dialog>` + `showModal()`. |
| Grouping | Server groups by `deviceId` and takes the **max** score per device. |
| Ordering | Score descending, then earliest submission ascending. |
| Board size | Top 10. |

**Why no replay validation.** `runner.ts` is pure, seeded and integer-only in its RNG, so
the server *could* re-simulate a submitted input timeline and compute the score itself.
It was rejected because it needs new bookkeeping in the hot loop (a step counter plus
input transitions keyed to step index rather than wall clock), a new payload shape, and
it only defeats "I typed 999999" — not someone writing a bot. For pre-party banter that
is pure cost. The property that keeps the option open is worth protecting anyway:
**`runner.ts` must never call `Date.now()` or `Math.random()`**, and the purity assertion
in `scripts/verify-runner.ts` guards it.

**Why per device rather than per name.** Per-name deduplication forces a choice between
"keep the latest" and "keep the maximum", and the correct answer depends on whether
`localStorage` was cleared. Per-device grouping sidesteps that entirely: the server keeps
the max per device, so repeat submissions are idempotent and harmless, and nobody can
*lower* another device's row because the id is unguessable. Accepted cost: clearing
storage or switching devices produces a second row. That is the simplicity that was asked
for.

**Why the board is not below the RSVP form.** The leaderboard's home is the game-over
dialog, with a hero button as the alternate entry point. Keeping it out of the page flow
means it can never sit between a visitor and the RSVP form.

## The trigger, and the bug it must avoid

The dialog opens when the run's final score beats the player's best **as it was before
the run started**.

This is not the obvious implementation. `step` updates the high score *during play*:

```ts
highScore = Math.max(highScore, score);   // runner.ts
```

and the component persists it at death, so at the moment a run ends
`view(game).highScore` **already equals the new score**. A check like
`finalScore > view(game).highScore` is false when you set a record (they are equal) and
false when you don't (the old best is higher) — **the dialog would never appear at all.**

So the component must snapshot the best when a run **starts** (a ref set in the same
place `start()` / `restart()` is called) and compare the final score against that
snapshot. The live bumping is correct for the HUD — `HI` ticking up mid-run the moment you
pass your record is proper arcade behaviour — so do **not** change the simulation.

Consequences worth knowing:

- The **first ever run always qualifies**, since the best starts at 0. That is desirable:
  it is how a first-time player discovers the leaderboard exists.
- A score of 0 does not qualify. `score = floor(distance / 10)`, so this is effectively
  unreachable anyway.
- Gating on a personal best is also the anti-spam rule: every score that reaches the
  server is a genuine improvement *for that device*, so the board cannot fill with junk
  from someone mashing submit.

## Data and API

### Storage

`data/<eventId>-scores.ndjson`, one JSON object per line, appended with
`fs.appendFileSync` — the same pattern as the RSVP endpoint, and append-only so there is
no read-modify-write race between two simultaneous submissions.

Every submission is appended; grouping happens on read:

```jsonc
{ "deviceId": "…", "name": "DREW", "score": 137, "at": "2027-01-02T18:04:11.221Z" }
```

Reading groups by `deviceId`, keeps the entry with the **highest** score for each device
(using that entry's `name` and `at`), sorts by score descending then `at` ascending, and
truncates to the limit. A device with two entries at the same maximum keeps the
**earliest** submission, consistent with the global tie-break. Malformed lines are skipped
rather than throwing — a corrupt line must not take the whole board down.

### Records are normalized, not echoed

Unlike the RSVP endpoint, which appends the raw client body, this endpoint must store a
**normalized** record. That endpoint is a write-only log read by a human; this data is
read back and displayed to other visitors. So the server owns the shape, and the client's
input is never stored verbatim.

### Endpoints

`src/pages/api/scores/[eventId].ts`, with `export const prerender = false` like the RSVP
route. Both verbs are covered by the existing per-IP middleware rate limit.

**The event id is validated before it touches the filesystem** —
`/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/` — because it names a file on disk. This is stricter
than the RSVP route, which builds `data/<eventId>.ndjson` from the URL param with no check
at all. That gap was investigated and is **not** a path traversal: Astro keeps an encoded
`%2F` in the segment, so a crafted id produces a junk file *inside* `data/` rather than
escaping it. Still worth closing on the RSVP route eventually, since the guard now exists
to reuse.

**`GET /api/scores/[eventId]`** → `200 { board: Entry[] }`

**`POST /api/scores/[eventId]`** — body `{ deviceId, name, score }` →

- `201 { entry, board }` — the normalized entry plus the recomputed top-N board, so the
  client can render the authoritative result from a single request with no follow-up
  fetch.
- `400 { error }` — validation failure, with a message safe to display.

Validation, all server-side (`maxlength` is a browser suggestion):

| Field | Rule |
| --- | --- |
| `deviceId` | String, `/^[A-Za-z0-9-]{8,64}$/` |
| `name` | Uppercase, **strip** to `/^[A-Z0-9]+$/`, then length 1–8 |
| `score` | Integer, `>= 0`, `<= MAX_SCORE` |
| `at` | Never read from the client; stamped server-side as an ISO timestamp |

A note on `name`, because the settled-decisions table says only "no spaces" while the rule
here is *strip*. Those are not the same, and the implementation follows the strip: `drew sm`
normalizes to `DREWSM` and is **accepted**, not rejected. Stripping is the deliberate
choice — forgiving is right for a submit button, since failing a whole submission over a
stray character is worse than cleaning it. The input should nonetheless stop a space being
typed in the first place, which is what "no spaces" was about.

`MAX_SCORE` should be **derived from `TUNING`** rather than hardcoded — roughly
`maxSpeed × 3600 / scoreUnit`, an hour of perfect running, which is generous while still
rejecting absurd values. Deriving it keeps the constant honest if the game is ever
re-tuned; a literal here would silently drift, which is the bug class this project has hit
more than once.

### Accepted gaps

Known and deliberate, so they are not mistaken for oversights:

- **No event-existence check.** Any slug-shaped id writes a file, including ids with no
  content entry. Bounded by the slug pattern and the rate limiter, and it matches the RSVP
  route's behaviour. Not worth a `getEntry` lookup on this path.
- **The HTTP contract is not covered by the headless harness.** `verify-scores.ts` drives
  the store directly, because the route cannot be imported under Node's type stripping
  (it uses a `.js` specifier, which type stripping does not rewrite to `.ts`). The route's
  201/400 behaviour was verified live with `curl` instead. Stage 2 exercises both verbs
  for real from the browser, which is the meaningful regression cover.
- **One `.ts` import specifier.** `scores.ts` imports `runner.ts` as `"./runner.ts"`
  rather than the repo's usual `"./runner.js"`, because the harness must be able to import
  `runner.ts` under Node. Vite, Astro and `tsc` all accept it; it is a deliberate
  inconsistency, not an accident.
- **ISO strings are compared with `localeCompare`.** Correct for ASCII timestamps, but a
  plain comparison would be locale-independent and cheaper. Left as is; not worth the
  churn.

## Client behaviour

### Identity and memory

- Device id: `crypto.randomUUID()` stored at `runner:device:<eventId>`. **Needs a
  `Math.random`-based fallback** — `crypto.randomUUID` requires a secure context, which
  holds in production over https but not over plain http on a LAN. The id only has to be
  stable and collision-unlikely, not cryptographic.
- Handle: remembered at `runner:name:<eventId>` and used to prefill the input on later
  records, so beating your record again is one tap.
- Existing key `runner:hi:<eventId>` continues to hold the personal best.

### Two entry points, one component

`src/components/Leaderboard.tsx` owns the dialog. It takes props and holds no opinion
about what opened it:

| Entry point | Mode |
| --- | --- |
| Game over, new personal best | Board with your score slotted in at its computed position, plus the handle input and submit |
| `HIGH SCORES` button | Read-only board — no input, no submit |

`RunnerGame.tsx` owns the wiring — the open state, the pending score, and binding the
button — so there is one React tree and no cross-island event plumbing. The button itself
is rendered in `Invite.astro` as server-rendered markup (so its styling and theme font
live where the theme does) and the island binds a click to it, matching how the island
already finds `[data-hero]` and `[data-parallax]`.

### Focus choreography

This matters because `Space` is the only game button, so focus *is* the input routing.

- **On open:** focus the handle input in the personal-best mode; focus the dialog itself
  in read-only mode.
- **On close:** return focus to the **band** when opened from game over, so `Space` still
  means retry. Return it to the **button** when opened from the button — deliberately not
  the band, because a focused button would make `Space` re-open the leaderboard instead of
  playing.
- **`Space` closes** (skip/retry) and **`Enter` submits.** This preserves the existing
  reflex exactly — mashing space after dying just starts another run — and makes an
  accidental blank submit impossible.
- `Escape` closes, which in personal-best mode means forfeiting that score.

### Why a native `<dialog>`

The hero is `overflow-hidden` with `isolate`, so a normal absolutely-positioned overlay
would be **clipped by the hero** and would have to fight the sky layers for stacking.
Top-layer content is not subject to ancestor clipping or stacking contexts, so
`showModal()` escapes all of that for free and additionally provides focus trapping,
`Escape`, page inertness and `::backdrop`.

### Fetching, and failing

- **Prefetch the board once on island mount** and keep it in memory. `client:load`
  hydrates immediately, so opening should never show a loading flash — a skeleton at the
  moment of a new personal best would undercut the payoff. A skeleton is only for a
  genuine cold fetch.
- **The scores API must not be able to break anything.** In personal-best mode, render the
  score and the handle input even if the `GET` failed; only the board *region* shows an
  error with a retry. A failed `POST` keeps the score, keeps the local high score, and
  offers a retry. Nothing about the invite, the game or the game-over flow may depend on
  the endpoint being up.
- After a successful submit, keep the dialog open and highlight the new row so the flow
  reads: *die → "NEW BEST 137" → handle → submit → watch yourself appear → Space to go
  again.*
- Guard against double submission: disable the button while a request is in flight.

### The band's game-over line

Suppress `Game over — press space to retry` while the dialog is open. Otherwise the band
and the dialog announce the same moment simultaneously, which is the exact
double-message wart already fixed once for the play prompt. The band keeps the line for
ordinary, non-record deaths — which is most of them, and is what preserves the fast
`die → space → retry` loop.

## Styling

Arcade high-score table, matching the in-game HUD so the DOM board and the canvas read as
one system:

- Rank, handle, score. `Press Start 2P`, uppercase.
- Scores **zero-padded and right-aligned** using the same 5-wide padding the canvas HUD
  uses, so columns line up like an arcade table.
- The just-submitted row gets a `NEW` badge; the visitor's own rows are highlighted.
- Empty state ("No scores yet"), loading state, error-with-retry state.
- Must stay readable and scrollable at 390px wide. `Press Start 2P` glyphs are roughly
  square, so 8 characters plus a rank and a 5-digit score is already wide.
- Untrusted handles render as **text nodes only** — never `innerHTML`. This is the first
  place in the app where data submitted by one visitor is displayed to another.

## Stages

Each stage leaves the app working and is reviewable on its own. A stage is dispatched only
after the previous one has been reviewed.

### Stage 1 — score store and API

| | |
| --- | --- |
| Scope | `src/lib/scores.ts`, `src/pages/api/scores/[eventId].ts`, `scripts/verify-scores.ts` |
| Deliverables | Normalization/validation, append, read-and-group, both verbs |
| Non-goals | No UI, no changes to the game, no changes to the RSVP endpoint |
| Depends on | Nothing |

Acceptance:

- Normalization: name uppercased, stripped to `A–Z0–9`, 1–8 chars; `deviceId` bounded;
  `score` a non-negative integer within `MAX_SCORE`.
- Reader ignores malformed lines instead of throwing.
- Grouping takes the **max** score per `deviceId`, using that entry's name and `at`.
- Order is score desc, then `at` asc; result truncated to the limit.
- `POST` returns `{ entry, board }`; `GET` returns `{ board }`; invalid input returns 400.
- `scripts/verify-scores.ts` asserts all of the above against a temp file, exits non-zero
  on failure, and derives its numbers from `TUNING` rather than copies.

### Stage 2 — the board dialog and the hero button

| | |
| --- | --- |
| Scope | `Leaderboard.tsx`, button markup in `Invite.astro`, binding + open state in `RunnerGame.tsx` |
| Deliverables | Read-only mode end to end: prefetch, render, all states, button, `<dialog>`, Escape, focus return |
| Non-goals | No game-over trigger, no submission |
| Depends on | Stage 1 |

Acceptance:

- Button renders only when `theme.runner` is set; top-right of the hero; above the sky
  layers; ≥44px tap target; **works under reduced motion** (viewing scores is not play).
- Clicking the button does **not** start the game. The existing tap guard already excludes
  `button`, so this is a regression check, not new work.
- The dialog escapes the hero's `overflow-hidden` and `isolate` — verify it is not clipped
  and paints above the sky layers.
- Prefetch on mount means opening shows no loading flash.
- Board renders rank/handle/zero-padded score, with empty, loading and error states.
- Usable at 390px wide; `Escape` closes and returns focus to the button.
- No submission affordance in this mode.

### Stage 3 — game-over trigger and submission

| | |
| --- | --- |
| Scope | `RunnerGame.tsx` (snapshot, auto-open, wiring), `Leaderboard.tsx` (input, submit) |
| Deliverables | The whole user-facing feature |
| Non-goals | No polish pass, no docs |
| Depends on | Stage 2 |

Acceptance:

- **The pre-run snapshot is used, not the live `highScore`.** Verified by playing three
  runs in a browser: first run (best 0) opens the dialog; a lower second run does **not**;
  a higher third run does.
- Submitting posts `{ deviceId, name, score }` and the returned board is rendered with the
  new row highlighted and badged.
- Handle input: uppercased, `A–Z0–9`, max 8, live counter, submit disabled while empty,
  prefilled from `localStorage` on later records.
- Double submission is impossible; a failed `POST` keeps the score and the local high
  score and offers a retry.
- With the scores API unreachable, the dialog still shows the score and the input; only
  the board region errors. The game and the invite keep working.
- Focus returns to the band after a game-over dialog, and to the button after a
  button-opened one; `Space` closes, `Enter` submits, `Escape` closes.
- The band's game-over line is hidden while the dialog is open, and `data-phase` is
  correct again once it closes.

### Stage 4 — edge cases, regression pass, docs

| | |
| --- | --- |
| Scope | Verification and documentation |
| Deliverables | Edge-case and regression results, both docs updated |
| Non-goals | No new features |
| Depends on | Stage 3 |

Acceptance:

- 390px viewport and reduced motion both exercised end to end.
- A full keyboard-only pass: load → play → record → handle → submit → `Space` → retry.
- Device-id fallback verified with `crypto.randomUUID` unavailable.
- The RSVP path is untouched: typing in the form never moves the player, and the
  "RSVP by…" link navigates without starting the game.
- The invite renders and the game plays with JavaScript's `fetch` failing.
- `docs/hero-runner-game.md` updated where the game-over behaviour changed (the band's
  line is now conditional; the dialog exists), and this document's status updated.

## Invariants that must not regress

- **RSVP safety.** Keys are handled on the focused element, never on `window`. Typing in
  the RSVP form must never reach the game. Do not add a `window` keydown listener.
- **Band focus and `Space` semantics.** Focus is the input routing mechanism; anything
  that moves focus must restore it deliberately (see the focus choreography above).
- **The game itself.** No changes to physics, tuning, cloud count, ground, parallax rates,
  or the layout split.
- **No new runtime dependencies.** Browser tooling for verification has been run from the
  npx cache throughout; keep it out of `package.json`.
- **Tooling stays green:** `npx astro check` (0 errors), `npx biome check .` (clean),
  `npm run build`. Do not reformat unrelated files.

## Verification

```sh
node --experimental-strip-types scripts/verify-runner.ts   # purity, spacing, fairness, resize, vertical fit
node --experimental-strip-types scripts/verify-scores.ts   # added in Stage 1
npx astro check
npx biome check .
npm run build
```

Behaviour that the Node harnesses cannot reach — the dialog, focus, prefetch, failure
degradation — must be verified **by measurement in a real browser**, not by reading code.
That has caught several real defects in this project that code review did not.
