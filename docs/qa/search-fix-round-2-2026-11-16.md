# Search fix round 2 — 2026-11-16

Scope: PR #263, root checkout, branch `feat/search-everything`. Integrated main through #264, #268 and #269 in merge commit `4bd0ab47`. The separate lesson-editor worktree was untouched.

The platform is Code School of Guam's learning hub (source: `docs/PRODUCT_VISION.md`). Learners search learning materials and conversations they can open; staff search their authorized administrative records. This round preserves enrollment, release, read-cutoff, feature, membership and blocking rules while bounding learner authorization work.

Acceptance and agent-executed regression coverage:
- Whole-request monotonic deadline (1.5 seconds), checked before/after batches and during authorization, preserves completed groups and marks partial results. Existing per-statement cancellation remains transaction-local and pooler-safe.
- Ranked keyset pages of 50 candidates, maximum 100 scanned per type, retain exact-match/rank/id ordering. Cast rank cursors to PostgreSQL `real` so float precision cannot skip tied ranks. Reaching the scan budget conservatively sets `partial`.
- Load non-archived lessons for matched modules together, grouped by module ID; reuse module objects and preload assignment modules to avoid per-record association queries. Removed ordered `in_batches` and its ignored-order warning.
- Seeded regression: 300 matched modules with unlocked assignments and 1,200 unreleased lessons. Learner `th`: **0.057 s / 34 queries**; `the`: **0.060 s / 34 queries**. Both omit locked modules/lessons and return partial. Test requires fewer than 100 queries, less than one second, and no OFFSET.
- A readable lesson after 60 locked matches verifies traversal into a second keyset page.
- A dropped enrollment cannot authorize lessons through another active enrollment on the same curriculum. Own help requests cannot reveal a draft recording or one newer than the paused enrollment's read cutoff. Independently removing the enrollment read scope or the help-request recording guard makes its targeted test fail (one assertion failure each, no errors). The recording fixture first proves published access with the supported query-string destination.
- Loofah text extraction decodes named entities and normalizes nonbreaking spaces.
- Web and mobile show “Some results took too long. Showing what we found.” with polite live-region semantics, then clear the notice on the next query. Mobile DM groups use “Direct messages”.
- Restored `LessonReadAccess.check_many` to main's implementation. The combined ContentManagement retains main's URL state and search hash scrolling; a regression opens an expanded module and scrolls the curriculum hash after loading.

Validation uses Node 22.23.5, local PostgreSQL, `PGGSSENCMODE=disable`, `PARALLEL_WORKERS=1`, and the isolated `csg_search_round2` database. An initial db:prepare seeded unrelated application users and caused recipient-count failures; that run was stopped, the database rebuilt with db:schema:load, and the full gate restarted on the clean database.

- API full suite with OPENAPI_COVERAGE=1: 1,575 tests / 38,432 assertions, zero failures, errors or skips.
- RuboCop: 628 files, no offenses. Brakeman: zero warnings, one existing ignore. Zeitwerk passed.
- Web: typecheck, lint, 184 Vitest files / 2,182 tests, production build, bundle gate, generated API type check passed.
- Mobile: typecheck, lint (zero errors, 38 existing warnings), 133 Jest suites / 1,321 tests passed.
- Impeccable advisory scan: no findings.

Limits: no real browser, native device, VoiceOver/TalkBack, or deployed-environment walkthrough was run. DOM and React Native renderer checks establish the notice and accessibility props, not actual screen-reader speech or device behavior. No deployment, PR merge or watch was requested or performed. Independent review and remote checks for the new head remain pending.

Resource tracking: the lifecycle helper failed with `Invalid machine profile: schema_version must be 1`. No app server, browser tab, simulator or container was started. The shared PostgreSQL service was borrowed and remains running. The task database was dropped; pg_database confirms it is absent.
