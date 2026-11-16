# W6 PR 6.4b: Safety, team member pages and smaller links

Agent-executed affected-flow QA on 2026-11-16 on the Mac mini, using the local
synthetic harness. Tested source: branch `feat/admin-safety-team`, based on
main `9bb714b2`, at the state committed as this PR's head. No migration and no
production data. All fixtures are synthetic (`scripts/qa/safety-fixtures.rb`).

## Context and acceptance

Admins run Safety (community reports, account-deletion requests) and Team.
Instructors see neither; the cohort Teaching team tab is admin-only too.
Sources: `AGENTS.md`, the redesign README (record header, related panel, record
link, peek card, glossary), `RecordDestination` (#247) and the record pages
from #248/#268. The audit backlog lives in Brain Dump, which this host can't
reach, so the backlog text in the task brief was the acceptance source.

Acceptance:

- Safety has Open, Resolved and Blocks views in the URL. Resolved shows who
  resolved each report, when, and the outcome (Actioned or Dismissed), paginated.
- A reported message links to its conversation only when the viewing admin can
  open it; otherwise the conversation is named as text.
- Blocks are read-only, with links to both people.
- New reports, deletion requests and paid purchases notify admins (only admins,
  never the person who caused it) after the write commits, once per admin.
- `/admin/team/:id` shows role, cohorts taught (with links), editing access
  read-only with a link to the Teaching team tab, recent activity and Message.
- Teaching team rows, Team rows, Safety staff names and search results open it.
- A staff help-request alert opens the exact request with cohort and student.

## Browser pass

`scripts/qa/safety-team.spec.ts`, Chromium, 1280×844 and 390×844, light (saved
choice) and dark (System with a dark OS): 20 of 20 passed. Each recorded page
has no horizontal overflow, no serious or critical axe rule violations, and
no colour-contrast findings after motion settles (18 page records per width).

| Scenario | Role | Result |
| --- | --- | --- |
| Safety open: two reports, deletion request, actions shown | Admin | Passed |
| Reported class chat message opens `/messages/:id?message_id=…` and the message shows; Back returns to Safety | Admin | Passed |
| Reported direct message the admin isn't in stays text with an explanation | Admin | Passed |
| Resolved view in the URL: Actioned/Dismissed with resolver and time; resolved deletion request with note; no review buttons | Admin | Passed |
| Blocks view: both people linked; staff name opens `/admin/team/2` with "Back to Safety" | Admin | Passed |
| Teaching team → team member page: role, "Can edit lessons" with grant line, "Back to Teaching team", activity | Admin | Passed |
| "Change on Teaching team" opens `/admin/cohorts/1?tab=team`; Message opens a DM; Team's Activity opens `/admin/team/:id#activity` | Admin | Passed |
| Help-request notification in Updates › Notifications opens `/admin/help-requests/1?cohort_id=1&student_id=4` | Admin, instructor | Passed |
| `/admin/moderation` and `/admin/team/1` show No access; Teaching team has no staff links | Instructor | Passed |

Screenshots and per-page JSON are in ignored `.qa-local/safety-team/`.

## Automated checks

- API: full suite with `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1`: 1712 runs, one
  failure, `LearnerProgressConsumersTest` (personal plan). It fails the same way
  on a clean checkout of main `9bb714b2`, so it predates this work (#272 area).
  OpenAPI coverage reported no untested operation, status or schema. RuboCop:
  no offences. Brakeman: no warnings.
- New API tests (`admin_safety_team_test.rb`, email, destination contract)
  fail on main: the endpoints, kinds, alerts and links don't exist there. They
  cover 403 for instructors and students on every new admin endpoint, admin-only
  recipients, de-duplication, after-commit push with a rollback case, flat query
  counts (QueryCounter, 1 vs 6 rows) for both Safety lists, and the old
  help-request rows' upgraded destination.
- Web: lint, typecheck, Vitest (190 files, 2,272 tests), build, `test:bundle`,
  `api:check`.
- Mobile: typecheck, Jest (135 suites, 1,408 tests), including installed-build
  routing of every new wire payload.

## Not run, and limits

- Real web push and Expo delivery: the harness queues jobs and blocks external
  HTTP. Payload shape and recipients are covered by tests with stubbed providers.
- Stripe: purchase alerts were tested with a synthetic paid session, not a webhook.
- The daily-unlock email was checked by rendering its HTML, not by sending mail.
- The 390 runs are resized Chromium, not Safari or native devices. WebKit can't
  start on this host. Mobile native screens were not opened; new admin alert kinds
  open Updates in the app by design.

## Cleanup

The lifecycle helper isn't used on this host; resources were tracked exactly.
Harness PIDs 35158 and 35182 were stopped and `csg_qa_35135_1794809413` dropped
by `scripts/qa/run clean`; the test database `csg_admin_safety_team_test` and a
temporary main worktree were removed. No browser or server was left running.
The shared PostgreSQL service was left running.
