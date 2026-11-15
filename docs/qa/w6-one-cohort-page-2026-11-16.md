# W6 PR 6.1: one cohort page

Agent-executed affected-flow QA on 2026-11-16, using the local synthetic harness.
Implementation source: `2497c9c5` and `ca778caa`, based on main `3b1f8c65`.
No production data, provider calls, API changes or schema changes.

## Context and acceptance

CSG is a learning hub for students, assigned instructors and admins. This work
consolidates cohort administration without changing instructor permissions.
Sources: `AGENTS.md`, `docs/PRODUCT_VISION.md`, the redesign README (glossary,
record headers, settings and feature switches), and mockups 04/06. The mockup
index has no dedicated cohort mockup. Brain Dump is unavailable on this host.

Settings is one admin-only workspace tab with one draft and Save settings action.
Offering fields, feature overrides, module configuration and resources join that
draft. The existing endpoints are separate transactions: a later failure can
leave earlier writes saved. The UI states this, keeps all drafts, and supports
idempotent retry. Saved records are refreshed only after the operation finishes.
Module/resource modal buttons finish editing locally; they do not persist early.

## Required journeys

| Scenario | Result | Evidence |
| --- | --- | --- |
| Admin: every cohort tab, including Learning insights | Passed | Chromium 1280/390, light/dark; rendered content and no horizontal page overflow |
| Instructor: every permitted tab and Learning insights | Passed | Same four dimensions; recording/session tools retained, Settings/Teaching team absent |
| Settings edit, guard, save and recovery | Passed | Edited GitHub setting, attempted Learning navigation, kept editing, saved; API read verified persisted value. All four admin dimensions. Vitest covers load errors/retry and partial-save retry with retained module and cohort drafts |
| Archive and unarchive | Passed | Chose segmented status, read/accepted consequences, saved, verified persisted archived/active status. All four admin dimensions |
| Legacy Manage URLs | Passed | Root, students, recordings, schedule, communication, curriculum and unknown fragments; matching tabs for both roles in all eight dimensions. Instructor settings root/curriculum falls back to Overview with an explanation |
| Instructor forbidden team URL | Passed | Overview renders; no editor or empty page. Also covered in Vitest |
| Offering save and repair links | Passed | Synthetic self-paced cohort price saved through the cohort form and verified as 19,950 cents. Catalog link targets `/courses?offering_id=2`; checklist links target price, team, status and Content |
| Recording progress and return context | Passed | Recording 1 opens its filtered progress table; Back points to Learning. Missing attribution does not show “by Unknown” |
| Communication and announcement context | Passed | Scoped message/update links and author/audience context covered by rendered integration tests; communication tab checked in all dimensions |
| Staff notification bell/badge | Passed | Uses existing notification count and Inbox route; admin/instructor unread-label integration tests |
| Disabled sections and roles | Passed | Integration tests verify hidden tabs and Overview fallback for disabled features and forbidden tabs |

Settings editing and lifecycle mutations are intentionally unavailable to instructors.
The 390 checks are resized Chromium, not native mobile/Safari certification.
WebKit cannot start on this host. Clerk login, actual video playback, payments,
email/push delivery and production release verification were not run.

## Engineering checks

- Node 22; `PGGSSENCMODE=disable`, `PARALLEL_WORKERS=1` for the harness.
- Typecheck, ESLint, production build and `test:bundle`: passed.
- Full Vitest collection: 178 files, 2,142 tests passed. Two recording regression
  tests added after collection also passed. Final affected suite: 7 files,
  51 tests passed, including those two regressions.
- Impeccable 4.6.0 advisory scan of Settings, workspace and enrollment UI: `[]`.
- Diff whitespace check: passed. API suite/security gates are not applicable:
  no API files changed.
- Earlier runs exposed obsolete route/header expectations and an incomplete
  overview test fixture; those were corrected. QA script retries corrected a
  wrong synthetic token, same-tick input/navigation and theme-settling races.
  Accepted UI results used separate rendered input events and waited for theme.

## Follow-up and disposition

PR 6.3: add an admin read-only purchase/checkout list. The existing controller
requires a student and scopes purchases to `current_user`; it cannot safely
supply a staff listing without an API addition.

The branch is held for lead review; do not merge or watch. No deployment was made.
The original checkout and branches for other work were preserved. Task worktree:
`/Users/agent/work/csg-one-cohort`, branch `feat/one-cohort-page`.

The lifecycle helper failed because this host has no valid machine profile.
The harness instead recorded exact owned process identities. The QA tab was
closed, servers 95824/95855 were stopped, and owned database
`csg_qa_95574_1794763604` was dropped. Process and database queries confirmed
absence. Shared PostgreSQL and other sessions were left available.

## Fix round 1

Implemented in the root checkout on `feat/one-cohort-page`, after merging
`origin/main` at `1504d18a`. PR #267's separate worktree was not changed.
Agent-executed affected-flow QA used a fresh synthetic local database on
2026-11-16. Scope: admin invitation recovery, offering preservation, module
assignment, office hours, status consequences, and draft navigation.

- Roster invite actions use the shared invite presentation (including expiry
  and failure reason); retries show queued delivery and preserve error recovery.
  Presence updates, last login, and last active timestamps are visible again.
- Cohort and offering saves send changed fields only. Untouched archived
  offerings stay clean and retain checkout. The API has no cohort optimistic
  locking contract; no lock parameter or backend change was added. Concurrent
  edits to the same field remain last-write-wins.
- Assigning a module omits an unchanged date, allowing the server to choose the
  next scheduled day. Explicit date edits still send the chosen date.
- Office-hours forms expose description and timezone. Status choices and
  confirmation explain catalog/checkout, attention lists, read-only class chat
  and direct messages, and the end of self-paced instructor help. Archive uses
  danger styling.
- Dialog input Enter cannot implicitly submit Settings. Same-page hashes keep
  the draft; query/path changes still use the leave guard. Internal destinations
  use router links. Main does not support curriculum hash scrolling; Content
  links use its supported `open` module parameter. Cohort lists refresh after
  partial saves. Invalid addresses have no retry; home load rejection is caught;
  unused detail exports/preloader were removed.

| Required admin scenario | 1280 Chromium | 390 Chromium | Saved outcome |
| --- | --- | --- | --- |
| Retry/resend student invite | Passed | Passed | Local API reports queued; no external delivery |
| Archive then unarchive checkout offering | Passed | Passed | Active again; checkout remains true |
| Assign a module mid-cohort | Passed | Passed | Assigned; server chose 2026-11-16 instead of legacy 2026-10-25 |
| Office hours description and timezone | Passed | Passed | Description retained; Tokyo 10:00 saved as 01:00Z, Guam 10:00 as 00:00Z |

All four required cases passed; no failed/blocked/not-run required cases.
No horizontal page overflow in the checked roster, schedule, and settings views.
Additional 390 checks: Enter in module input was prevented; dirty offering
checklist navigation retained `?tab=settings`, hash, and edited price without a
leave dialog. Synthetic fixtures were reset/added only in this task's database.
A failed fixture command used a nonexistent User full_name attribute; corrected
fixture creation used first_name/last_name. Initial browser assertion selected a
hidden navigation dialog; the confirmation itself showed the correct copy.

Regression validation temporarily loaded the four production components from
reviewed head `b836f74` while retaining the new tests: eight tests failed across
all six P1/P2 findings. Restored implementation passes those tests. Full web
checks and final test totals are recorded in the PR update. Impeccable advisory
scan returned `[]`; diff whitespace validation passed.

Limits: resized Chromium does not certify native mobile or Safari. Clerk login,
actual invite delivery, payments, and production deployment were not tested.
The harness queues jobs and blocks external HTTP. Review of this fix is pending.
No merge or PR watch was performed.

The lifecycle helper rejected this host's machine profile (`schema_version must
be 1`); exact harness ownership was used instead. Owned PIDs 26318/26326 were
stopped, database `csg_qa_26292_1794765484` dropped, and the owned preview tab
closed. PID absence and removed harness state were verified. Borrowed listeners
and the other worker's checkout/resources were preserved.
