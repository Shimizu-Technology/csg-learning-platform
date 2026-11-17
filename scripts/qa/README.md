# Local signed-in QA

Run from the repository root. Requires the repo Ruby/Node versions, Python 3,
a running local PostgreSQL server and PostgreSQL client tools on PATH, installed API gems (`cd api && bundle install`)
and web packages (`cd web && npm ci`). On the Mac mini specifically, start its test server with `agent-postgres start`.
No Clerk account, production database, or provider credentials are needed.

```sh
scripts/qa/run start
# In another terminal, from web/:
npx playwright install chromium
npx playwright test --config ../scripts/qa/playwright.config.ts
# From the repository root:
scripts/qa/run stop   # stop exact owned PIDs, retain DB
scripts/qa/run clean  # stop if needed, drop exactly the owned DB
```

Startup creates a fresh `csg_qa_<pid>_<timestamp>` database, loads only schema
(no production seeds), seeds synthetic fixtures, and starts Rails/Puma and Vite
on free loopback ports. It prints ports, process IDs and persona URLs. Open a
printed link, or add `?qa_user=<id>` to any app route. Identity persists in that
tab's sessionStorage; use a new persona link to switch and reload. A bare URL in
a fresh tab is signed out. Logs, ownership state, JSON smoke results and failure
traces are under ignored `.qa-local/`. Do not delete state before cleanup.
`stop` retains the DB for inspection; use `clean` then `start` to reset/restart.
Failed startup attempts clean their database and servers automatically.

| ID | Role / persona | Demonstrates |
|---|---|---|
| 1 | Admin | All staff and authoring pages |
| 2 | Instructor | Assigned cohorts, grading and support |
| 3 | Program student | Personal plan, graded, redo and ungraded work |
| 4 | Behind student | Last seen 12 days ago, open help and scheduled follow-up |
| 5 | Paused student | Paused access and communication boundaries |
| 6 | Self-paced student | Mid-course submitted work and personal plan |
| 7 | New self-paced student | First-open experience, no submitted work |
| 8 | Alumni student | Alumni-only library |

Fixtures include prework/live modules, repeated lesson positions across days,
three weeks, Markdown/code, video placeholders, text/repository exercises,
manual completion, synthetic knowledge checks and a rubric. Program communication
includes a DM, class channel, announcement, recording and weekly office hours.
The default fixture names, addresses, work and curriculum are invented. `example.invalid` media
and meeting links intentionally do not play or connect. Never import real
curriculum, student data, answer keys or tokens into this public repository.

Rails is forced to test mode and checks both URL and connected database name.
The harness binds only to loopback; never expose these unauthenticated role
switches on a network. Net::HTTP blocks non-loopback destinations and jobs are
queued without execution. Set `QA_ASYNC_CABLE=1` before startup for in-process
ActionCable checks; this does not test production delivery or background workers.
The stub is loaded only by this Vite runner; normal builds retain real Clerk.
Vite ignores web env files. Smoke tests also block external browser requests.

"Make a copy for this cohort" has its own spec, outside the default run because the
copy happens once: `DATABASE_URL=postgresql://localhost/<qa db> bundle exec ruby ../scripts/qa/copy-fixtures.rb setup`
(from `api/`), then the three `QA_SPEC=copy-for-cohort.spec.ts` passes listed at the top of that spec,
then `copy-fixtures.rb verify`.

The learning-plan editor and instructor meetings checks use an extra fixture: a synthetic 240-lesson course with
persona 4 enrolled, plus meetings hosted by the admin. Load it once after startup, from `api/`:
`DATABASE_URL=postgresql://localhost/<qa db> bundle exec ruby ../scripts/qa/plan-editor-meetings-fixtures.rb`.
See `docs/qa/plan-editor-meetings-2026-11-17.md`.

Help requests and follow-up plans (W7 PR 7.4) have their own spec, outside the default run
because Reply & resolve closes a request: after `start`, run
`DATABASE_URL=postgresql://localhost/<qa db> RAILS_ENV=test bundle exec ruby ../scripts/qa/help-followup-fixtures.rb`
(from `api/`), then `QA_SPEC=help-followup.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts`
(from `web/`). It can be re-run against the same database; each run asks a fresh synthetic question.

"Where used" and the content record pages (W5 PR 5.4) need an extra fixture: a second cohort sharing QA Program Lab
that the QA instructor doesn't teach, and a third cohort on its own copy. Load it once after startup, from `api/`:
`DATABASE_URL=postgresql://localhost/<qa db> RAILS_ENV=test bundle exec ruby ../scripts/qa/where-used-fixtures.rb`, then
`QA_SPEC=where-used.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts` (from `web/`). It reads
the ids the fixture writes to `.qa-local/where-used.json`. See `docs/qa/where-used-2026-11-17.md`. Then run
`QA_SPEC=where-used-copy.spec.ts` once: it makes QA Program 2's own copy as the admin (a lasting change to the fixture),
and checks that QA Program's instructor never sees that cohort's name in the copy's name.

Use `PARALLEL_WORKERS=1` for separate Rails tests on the mini, with a separate
test database. In zsh, do not name a variable `path` (it changes PATH).
Smoke covers four roles at 1280 and 390 using Chromium. It does not establish
Expo/native, Safari, Clerk, video playback, email, push or payment acceptance.
No required CI job is added by this PR. Harness TypeScript lives outside web's
tsconfig scope; Playwright/Vite transpile it directly.

### Inline invitation latency checks

Set `QA_INVITE_DELAY=0.8` before `scripts/qa/run start` to run invitations inline
with synthetic Clerk and Resend calls delayed by 0.8 seconds each. Addresses
containing `delivery-fail` simulate a Resend exception. External HTTP stays
blocked; this mode never sends real invitations. Use fresh synthetic addresses
so the 10-minute delivery dedupe does not bypass the delays. See
`docs/qa/setup-wizard-round2-2026-11-16.md` for the recorded resume scenario and
per-request times.

### Student workspace W7 checks

With the harness started, run the extra fixtures from `api/`, using the exact
owned database printed by startup:

```sh
DATABASE_URL=postgresql://localhost/<owned csg_qa_ database> bundle exec ruby ../scripts/qa/student-workspace-fixtures.rb
```

Then run from the repo root:

```sh
QA_SPEC=student-workspace.spec.ts DEV_LIFECYCLE_SESSION=<active-session> node web/node_modules/@playwright/test/cli.js test --config scripts/qa/playwright.config.ts
```

 The spec claims and releases each page; claim the runner
process too. This covers admin/instructor actions and six student personas at
1280/390 in light/dark with one browser worker.

An optional second pass uses the canonical production-authored prework export
already tracked at `scripts/prework_exercises.json`. From `api/`, run
`student-workspace-course-fixtures.rb` with the same owned `DATABASE_URL`;
then repeat the browser command with `QA_CANONICAL_COURSE=1` and
`--grep 'canonical course'`. This imports 127 real lessons into the local
fixture database, attaches synthetic enrollments, and checks all six profiles
and preview boundaries. It never reads a production database or imports real
students. Course metadata and traces stay in ignored `.qa-local/`; run
`scripts/qa/run clean` after QA.

For the PR #284 fix round, start a **fresh** owned harness. Instead of the normal
workspace additions, run `student-workspace-fix-fixtures.rb` from `api/` with its
owned `DATABASE_URL` (it loads those additions itself). Then use
`QA_SPEC=student-workspace-fix.spec.ts` in the browser command above. Its 16
scenarios cover admin/instructor × 1280/390 × light/dark: assigned video and
published recording card/list agreement, personal-plan and lesson-only cases,
waiting-review and open-support server queues, blocked previews in both block
directions, and scoped full-message/channel/meeting links. Media keys and people
are synthetic; no external media is played. Claim the runner and clean the exact
harness database and servers afterward. The full ASUS gate now runs the API
suite with prepared statements enabled and disabled, retaining the loopback
migration-process port adapter.

After that media matrix, the record-route extension uses the same personal-plan
fixtures but normal module assignments for the learner-boundary journey. Restore
persona 6 with `User.find(6).enrollments.find_by!(cohort_id: 2).assign_cohort_content_defaults!`
via the local QA boot script and owned database. Then run the workspace spec with
`QA_WORKSPACE_FIX=1` and `--grep 'module cards|learner boundaries'`. Its 32 cases
check the new staff record pages and exact Back paths, milestone/media lesson
links, preview module/lesson containment and all six normal student personas.
The separate 16-case media matrix retains the lesson-only assignment fixture.

### Staff record pages (L-5.2)

After `start`, load the fixture once from `api/`:
`DATABASE_URL=postgresql://localhost/<qa db> RAILS_ENV=test bundle exec ruby ../scripts/qa/record-pages-fixtures.rb`.
It adds one of each record to QA Program (a recording a lesson plays, a booking, plan revisions, channel
messages with a blocked sender, an activity event) and "QA Other Program", which shares the curriculum but
which the QA instructor doesn't teach. Then run `QA_SPEC=record-pages.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts`
from `web/`. It covers the seven pages, every new link and its Back, instructor scope, a refused student and
copying a message link. See `docs/qa/record-pages-2026-11-17.md`.

### Catalog and course pages

Start with `QA_CHECKOUT_READY=1 scripts/qa/run start`, then from `api/` run
`DATABASE_URL=postgresql://localhost/<qa db> bundle exec ruby ../scripts/qa/catalog-fixtures.rb`.
This explicitly lists a synthetic offering, adds buyer persona 9, and creates a
synthetic paid purchase for persona 7. Run
`QA_SPEC=catalog-course-pages.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts`
from `web/`. The spec covers light/dark at both widths, restores its own onboarding
fixture, and writes screenshots under `docs/qa/catalog-course-pages-2026-11-17/`.
The checkout spec intercepts the purchase request and hosted page; it never calls
Stripe. Existing API regressions cover actual checkout/session/webhook logic.
