# Backlog — Pending Work

_Last updated: 2026-09-30. Update this file as items are completed or reprioritized._

---

## 🔴 Needs Your Input (Q: questions — answer before implementation)

### UX Issues

Answer the Q: in each item, then tell me to implement. Full context in `ux_issues.md` (agent artifact).

| # | Where | Issue | Your decision needed |
|---|---|---|---|
| 1 | Queue page | Exhausted banner shows alongside unfinished cards | Only show when `problems.length === 0`? Or quiet notice while cards visible? |
| 2 | Problem card | No link to problem after marking Solved | Label: `↗ Open`, `↗ Open on LC/CSES`, or generic `↗ View`? |
| 5 | Problem card | "Mark Attempting" gone after reveal, no retry if API failed | Keep a retry button after reveal? |
| 6 | Problem card | Skip has no confirmation or undo | Confirmation dialog, or instant-skip + 5s undo toast? |
| 7 | Problem card | Solve time not prominent in Solved card | Move time into green "Solved" badge area? |
| 8 | Problem card | "🔒 topic hidden" badge duplicates Reveal button | Remove badge, replace with a single explanatory line? |
| 9 | Queue page | 3-step regen has redundant mode picker | Remove mode picker, always use saved settings? |
| 10 | Queue page | "Come back tomorrow" fires at 10 AM | Add "Solve more today" button linking to Settings? |
| 11 | Problem card | 5s undo window too short on mobile | Longer (10s) or persistent undo in solved card header? |
| 12 | Problem card | No platform indicator (LC vs CSES) after solve | Show "LC" / "CSES" label after solving (like topic reveal)? |
| 13 | Problems page | Difficulty sort works on 🔒 hidden values | Disable difficulty sort for unsolved rows? |
| 15 | Problem card | No feedback when re-clicking Solve in ATTEMPTING | Show "⏱ Timer running since HH:MM" tooltip on hover? |

---

## 🟡 Ready to Fix (no input needed — clear fixes)

| # | Where | Fix | Effort |
|---|---|---|---|
| 3 | Queue gen | Same topic repeats — reduce `MAX_PER_TOPIC` cap | ~10 min |
| 4 | Queue page | "of 2 problems" should show expected count when exhausted | ~5 min |
| 14 | History page | Replace "database migration" jargon in empty state | ~2 min |

---

## 🟢 Manual Actions (you need to run these)

| Item | SQL / Action |
|---|---|
| Fix your `display_name = NULL` in admin panel | `UPDATE user_access SET display_name = 'Vedant' WHERE user_id = '132f68cd-86c4-4995-8235-8ab3013940a4';` |
| Update new-user trigger to capture email + name | Run statement 4 from `docs/migrations/admin_panel.sql` in Supabase SQL Editor |

---

## 🔵 Future Features (no timeline)

| Feature | Notes |
|---|---|
| Local caching for perf | You said "not sure about it yet" — worth revisiting once you've identified what's slow |
| Good Morning/Evening greeting in header | Was in notes, polish item |
| Admin panel — landing page upgrade (Option B) | Move queue to `/home`, make `/` a full public landing page. Currently using Option A (info section on login page). Do when you want to go public. |
| Admin panel — email notification on access request | Currently skipped (admin panel is enough). Add later if the user volume grows. |
