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
