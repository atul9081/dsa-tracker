# DSA Tracker — UX Issues

> Issues verified against source code. Lines cited are exact.
> **Q:** markers are open questions where the answer is subjective — fill them in.

---

## 1 — "🏆 Completed enough problems!" banner shows alongside unfinished cards

**Verified at:** [`app/page.tsx:205-222`](file:///home/intruder-jsr/exps/dsa-tracker/app/page.tsx#L205-L222)

**What you saw in the screenshot:** Queue has 2 problems (0 solved, 1 attempting),
but the 🏆 banner appears _below_ them saying "No more unsolved problems in your
enabled topics."

**Why it happens:** `exhausted` is set to `true` when the generation algorithm
_could not fill the full daily count_ (e.g., pool had only 2 unsolveds when you
requested 5). This is a pool-exhaustion flag, not a "you finished today" flag.
The banner's copy — "No more unsolved problems — amazing work" — is factually wrong
when active problems are still visible on screen.

**Fix options:**

- Only show the banner if `problems.length === 0` (truly empty queue).
  Yes. Fine.
- If `problems.length > 0 && exhausted`: show a quieter notice like
  _"Only X problems available today — pool is running low in your enabled topics."_
  Yes. Fine.

- Never show the 🏆 banner while any card is still visible.
  Yes. Fine.

> **Q:** Should the exhausted notice appear at all when problems are still shown,
> or should it only show after all cards are solved?

---

## 2 — "↗ Solve" link vanishes after marking solved; no way to revisit the problem

**Verified at:** [`components/ProblemCard.tsx:340-418`](file:///home/intruder-jsr/exps/dsa-tracker/components/ProblemCard.tsx#L340-L418)

In the SOLVED card, there is **no top-level link** to the problem. The only link is:

- Buried inside the collapsible "View problem" section (line 410), and only if
  description is missing.
- Completely absent if the problem _has_ a cached description.

So once you mark a problem solved, you cannot quickly revisit it without digging
through the collapsible section or going to "Problems" page.

**Fix:** Add a persistent `↗ Visit` (or `↗ Open on LC` / `↗ Open on CSES`) link
in the solved card header row, always visible, not conditional on description.

> **Q:** Preferred label? Options: `↗ Visit`, `↗ Open`, `↗ View on LeetCode/CSES`,
> or a generic `↗ Open problem`. Since CSES and LC are both possible, a generic
> Yes. Fine.
> label like `↗ Open problem` or just the platform icon might work best.

---

## 3 — Same topic appears repeatedly after "Save & Regenerate" from Settings

**What happens:** After changing topic settings and clicking "Save & Regenerate",
the new queue can still contain multiple problems from the same topic.

**Root cause (two parts):**

1. The Settings page sends `difficulty_mode` in the POST body
   ([`settings/page.tsx:131`](file:///home/intruder-jsr/exps/dsa-tracker/app/settings/page.tsx#L131)),
   but the API's `resolveConfig` re-reads all settings fresh from the DB — so this
   is fine. However, `enabled_topic_slugs` is only read from the DB, meaning if you
   just changed topics _without saving_ first and clicked regenerate, the old topics
   are used. (Save happens before regen in `handleSaveAndRegen`, so this is OK if
   you use that button.)
2. The real cause: `MAX_PER_TOPIC = 3` allows up to 3 problems from the same topic.
   With default `dailyCount = 5` and only a few topics enabled, 2 topics can together
   produce 3+2 = 5, both from the same 2 topics every day. The user perceives this
   as "it's always the same topics."

**Fix:** After changing settings and regenerating, the queue should visibly reflect
the new configuration. The count cap per topic (`MAX_PER_TOPIC`) may need to be
reduced or made relative to dailyCount (e.g., `max(1, floor(dailyCount / 3))`).

> **Q:** How many problems from the same topic feels right in a 5-problem day?
> (Currently the hard limit is 3.)
> Yes. Fine.

---

## 4 — Progress counter "of 2 problems" is confusing when you expected 5

**Verified at:** [`app/page.tsx:152-154`](file:///home/intruder-jsr/exps/dsa-tracker/app/page.tsx#L152-L154)

```tsx
<span>of {problems.length} problems</span>
```

When the pool is exhausted and only 2 problems could be generated, the header reads
`0 solved of 2 problems`. There's no indication that 2 is _less than expected_. You
don't know if the settings say 5 and you only got 2, or if 2 was the configured target.

**Fix:** Show expected count alongside actual: `of 2 problems (5 expected)` or a
small muted note: `⚠ only 2 available in your topics`.

---

## 5 — "Mark Attempting" button disappears after first reveal — no way to see you're back in TO_DO mentally

**Verified at:** [`components/ProblemCard.tsx:567-582`](file:///home/intruder-jsr/exps/dsa-tracker/components/ProblemCard.tsx#L567-L582)

```tsx
{
  !revealed && <button onClick={handleReveal}>🔄 Mark Attempting</button>;
}
```

After you reveal the description, `revealed = true` permanently and the
"Mark Attempting" button is gone from the TO_DO card footer. The status in the DB
is now ATTEMPTING. The card doesn't visually transition to the ATTEMPTING card
until you interact again — there's a brief flash where the footer shows nothing
useful (only `↗ Solve` and `Skip →`).

Actually: after `handleReveal()`, `updateStatus('ATTEMPTING')` is called which
sets `status = 'ATTEMPTING'` (local state), which immediately re-renders to the
ATTEMPTING card — so this is fast. But if the API call fails, the card shows no
button to retry the status change.

> **Q:** Should there be an "I'm working on this" / "Mark Attempting" button that
> stays visible even after reveal (as a manual re-trigger), in case the API call
> silently failed or the user wants to reset their timer?

## Good idea. Can experiment.

## 6 — "Skip →" button has no confirmation and gives no feedback on what replaced the problem

**Verified at:** [`components/ProblemCard.tsx:165-178`](file:///home/intruder-jsr/exps/dsa-tracker/components/ProblemCard.tsx#L165-L178) and [`app/page.tsx:78-95`](file:///home/intruder-jsr/exps/dsa-tracker/app/page.tsx#L78-L95)

Clicking "Skip →" immediately fires the API and swaps the problem card. There is:

- No confirmation (unlike "Get a fresh set" which has a confirm step).
- No toast or notification saying _what_ replaced it or _why_.
- No undo option.

The replacement card just appears in place. If you accidentally click Skip on a
problem you wanted to work on, it's gone — and the replacement could be anything
(including from a topic you wouldn't have chosen).

> **Q:** Should skip have a confirmation step? Or is instant-skip + undo toast better?
> An undo toast ("Skipped X → undo") lasting ~5s would match the Solved flow.
> Yes. Good idea.

---

## 7 — Timer shows during ATTEMPTING but disappears from SOLVED card header

**Verified at:** [`components/ProblemCard.tsx:367-368`](file:///home/intruder-jsr/exps/dsa-tracker/components/ProblemCard.tsx#L367-L368)

In the SOLVED card, `⏱ {formatSecs(solveTimeSecs)}` is shown (line 368) —
but only if `problem.solve_duration_secs` (the DB-stored duration) is non-null.
The live `elapsed` timer from the ATTEMPTING state is not carried into the SOLVED
display. If `solve_duration_secs` was not written (e.g., if the timer didn't start
before marking solved), the SOLVED card shows no time at all.

Additionally, the `⏱` display in the SOLVED header is small and muted — very easy
to miss. There's no "You solved it in X mins" emphasis.

> **Q:** Should the solve time be more prominent (e.g., in the green "Solved" badge
> area rather than in small muted text)?
> Yes. Fine.

---

## 8 — Reveal button and "🔒 topic hidden" badge duplicate the same concept

**Verified at:** [`components/ProblemCard.tsx:517-526`](file:///home/intruder-jsr/exps/dsa-tracker/components/ProblemCard.tsx#L517-L526) and [`components/ProblemCard.tsx:256-274`](file:///home/intruder-jsr/exps/dsa-tracker/components/ProblemCard.tsx#L256-L274)

In the TO_DO card:

- Top-right: `🔒 topic hidden` badge
- Middle of description area: `👁 Reveal` button

Both convey "something is hidden." The badge is small, muted, and has a `cursor: help`
tooltip. The Reveal button is the actual action. The badge adds noise without adding
clarity — a new user might not understand that "topic hidden" is intentional, or
think it's an error.

> **Q:** Should the badge be removed in favour of a single clear line under the title
> like _"Difficulty and topics hidden until solved."_? Or keep the badge but make
> its tooltip more explanatory?
> keep the hidden badge but tooltip more explanatory

---

## 9 — "Get a fresh set" flow has 3 steps; the difficulty mode picker in the middle is redundant

**Verified at:** [`app/page.tsx:229-314`](file:///home/intruder-jsr/exps/dsa-tracker/app/page.tsx#L229-L314)

The regen flow is:

1. Click **"↺ Get a fresh set"** → confirmation section appears
2. Pick a mode (Chill / Standard / Grind) — but this always defaults to Standard,
   ignoring your saved settings
3. Click **"Yes, regenerate"**

This is 3 interactions for an action you said you won't do frequently. The mode
picker adds friction without benefit if it ignores your saved preference.

**Better options:**

- Remove the mode picker; always use saved settings. Keep only Confirm / Cancel.
- Or keep the picker but pre-select your saved difficulty mode.
  Yes. Fine. its high chance he might want to change config while regen q.

> **Q:** Do you want the difficulty picker in the regen flow at all? Or should
> "Get a fresh set" always just use whatever is in Settings?

---

## 10 — "Come back tomorrow for a fresh set" appears even if it's not night-time

**Verified at:** [`app/page.tsx:159-177`](file:///home/intruder-jsr/exps/dsa-tracker/app/page.tsx#L159-L177)

The "All done for today! 🎉 — Great work. Come back tomorrow for a fresh set." banner
fires when `allDone = solved === problems.length`. This could happen at 10 AM if
you're on fire. The message "come back tomorrow" feels premature and slightly demotivating
at that hour. There's also no option on this screen to get bonus problems or enable
more topics inline.

> **Q:** Should there be a one-click "Solve more today" button on the all-done
> one click fine.
> screen that links directly to Settings (or triggers a regen with more topics)?

---

## 11 — The "Undo" toast for Mark Solved is 5 seconds — easy to miss on mobile

**Verified at:** [`components/ProblemCard.tsx:154-156`](file:///home/intruder-jsr/exps/dsa-tracker/components/ProblemCard.tsx#L154-L156)

```ts
setToastMsg("✅ Marked as solved!");
setToastVisible(true);
// Toast duration={5000} on line 346
```

The undo window is 5s. On mobile (screenshot shows mobile view), the toast appears
bottom-right and may be partially obscured by system navigation bars. After 5s
you cannot undo. If you mis-click "Mark Solved" and miss the toast, your only
recovery is going to the Problems page and manually cycling the status button.

> **Q:** Would a longer undo window (e.g., 10s) be better? Or a persistent "Undo"
> option that stays in the solved card header until page refresh?
> cant see or understand which undo button you are talking about.

---

## 12 — No visual distinction between LeetCode and CSES problems in the queue

**Verified at:** [`components/ProblemCard.tsx:183-184`](file:///home/intruder-jsr/exps/dsa-tracker/components/ProblemCard.tsx#L183-L184)

```ts
const solveUrl =
  problem.external_url ??
  `https://leetcode.com/problems/${problem.title_slug}/`;
```

The cards look identical for LC and CSES problems. The link destination differs,
but you have no way to know before clicking. The original notes say this is
intentional ("make it generic, don't let user know which platform"). But the
"↗ Solve" link text is the same for both.

If you want to keep the source hidden until the link is clicked, this is fine. But
once a problem is SOLVED, the source could be revealed (similar to how difficulty
is revealed).

> **Q:** After solving, should a "LC" or "CSES" label appear alongside the topic
> tags? Or keep it hidden even after solve?
> After solve it can be shown.

---

## 13 — Problems page shows difficulty for unsolved problems in the sort column header

**Verified at:** [`app/problems/page.tsx:198`](file:///home/intruder-jsr/exps/dsa-tracker/app/problems/page.tsx#L198)

The Problems table has a sortable "Difficulty" column. For unsolved problems the cell
shows `🔒`, but the column is still labelled "Difficulty" and can be sorted by
difficulty. Sorting a column that's mostly `🔒` gives you a random-looking order
since hidden values don't sort meaningfully.

> **Q:** Should the difficulty sort be disabled (or removed) until a problem is solved?
> Or is sorting by difficulty useful even from the problem-selection perspective
> (e.g., when deciding what to work on)?
> leave it the way it is.

---

## 14 — History page "No history yet" message mentions "database migration" — user-facing jargon

**Verified at:** [`app/history/page.tsx:97`](file:///home/intruder-jsr/exps/dsa-tracker/app/history/page.tsx#L97)

```tsx
<p>Your daily queues will appear here after the database migration runs.</p>
```

"Database migration" is internal implementation language. A user (especially a
friend you shared the app with) has no idea what this means or what to do about it.

**Fix:** Change to something like:
_"No queues recorded yet. Visit the home page to generate today's first queue."_
yes pls.

---

## 15 — "↗ Solve" link in ATTEMPTING state has no `onClick` handler (no timer restart on re-visit)

**Verified at:** [`components/ProblemCard.tsx:470-477`](file:///home/intruder-jsr/exps/dsa-tracker/components/ProblemCard.tsx#L470-L477)

The ATTEMPTING card's `↗ Solve` link is a plain `<a>` with no `onClick`. This is
intentional — clicking it again shouldn't restart the timer. But if you close the
tab, come back later, and click "Solve" again to re-open LC, nothing happens on the
tracker side. The timer resumes from `attempt_started_at` (correct), but there's
no indication that the link re-opened or any feedback that the timer is still
counting from the original start.

> **Q:** Should clicking "Solve" again in ATTEMPTING state show any confirmation,
> e.g., a subtle "⏱ Timer running since HH:MM" tooltip on hover? Or is the
> visible timer on the card sufficient?

## current behaviour is fine.

## Summary

| #   | Area          | Issue                                            | Has clear fix | Needs your input (Q:) |
| --- | ------------- | ------------------------------------------------ | :-----------: | :-------------------: |
| 1   | Queue page    | Exhausted banner alongside live cards            |      ✅       |          ✅           |
| 2   | Problem card  | No link to problem after marking solved          |      ✅       |       ✅ label        |
| 3   | Queue gen     | Same topic repeats after regen                   |      ✅       |     ✅ cap number     |
| 4   | Queue page    | "of 2 problems" hides that you expected 5        |      ✅       |                       |
| 5   | Problem card  | "Mark Attempting" gone after reveal, no retry    |      🟡       |          ✅           |
| 6   | Problem card  | Skip has no confirmation/undo                    |      ✅       |          ✅           |
| 7   | Problem card  | Solve time not emphasized in solved card         |      🟡       |          ✅           |
| 8   | Problem card  | "🔒 topic hidden" badge duplicates Reveal button |      🟡       |          ✅           |
| 9   | Queue page    | 3-step regen flow with redundant mode picker     |      ✅       |          ✅           |
| 10  | Queue page    | "Come back tomorrow" at 10 AM is odd             |      🟡       |          ✅           |
| 11  | Problem card  | 5s undo window too short on mobile               |      🟡       |          ✅           |
| 12  | Problem card  | No platform indicator (LC vs CSES) after solve   |      🟡       |          ✅           |
| 13  | Problems page | Difficulty sort works on hidden (🔒) values      |      🟡       |          ✅           |
| 14  | History page  | "database migration" jargon in empty state       |      ✅       |                       |
| 15  | Problem card  | No feedback when re-clicking Solve in ATTEMPTING |      🟡       |          ✅           |
