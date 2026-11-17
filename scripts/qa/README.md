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

### Staff workspace phone layout (W7 PR 7.6b)

Start the harness and load `student-workspace-fixtures.rb` as above. Run:

```sh
QA_SPEC='staff-mobile*.spec.ts' DEV_LIFECYCLE_SESSION=<active-session> node web/node_modules/@playwright/test/cli.js test --config scripts/qa/playwright.config.ts
```

The layout spec checks every staff cohort/student section as admin and instructor,
light/dark, at 390/1280. It also checks Settings sizing, pinned Save, the leave
guard, simulated save failure/retry, API-verified persistence, keyboard selection,
Back and Activity return context. Settings changes are reset through the UI.
No provider delivery is attempted. Screenshots go to ignored
`.qa-local/staff-layout/after/`. `QA_LAYOUT_BASELINE=1` captures the desktop
baseline instead and skips post-change acceptance; use it before editing the
page source. Browser Date is fixed for reproducible relative labels.

`staff-mobile-fixes.spec.ts` adds keyboard-only disclosure navigation, Escape,
modified-click, history and draft checks; short-dialog scrolling and accessible
editor labels; keyboard-aware pinned chrome and 16px fields; fractional
breakpoints and focus rings; roster targets and support counts; Learning return
context; update loading/error/retry; and delayed message responses. The keyboard
viewport is simulated in Chromium and does not certify iOS Safari hardware.

The web-only ASUS gate is
`asus-test --postgres csg_learning_platform_test <repo-root> -- bash scripts/qa/staff-mobile-layout-gate.sh`.
It leaves the existing cross-stack gate and migration-process port adapter intact.
See `docs/qa/staff-mobile-layout-2026-11-17.md` for evidence and limits.
### Course outline (W8 PR 8.1)

After `start`, load the course outline fixture once from `api/` (the canonical
production-authored prework in three synthetic cohorts, with personas part-way through it):
`DATABASE_URL=postgresql://localhost/<qa db> bundle exec ruby ../scripts/qa/course-outline-fixtures.rb setup`.
Then run one pass per state of the "New student experience" switch, from the repo root:

```sh
(cd api && DATABASE_URL=... bundle exec ruby ../scripts/qa/course-outline-fixtures.rb switch off)
QA_OUTLINE=off QA_SPEC=course-outline.spec.ts DEV_LIFECYCLE_SESSION=<session> node web/node_modules/@playwright/test/cli.js test --config scripts/qa/playwright.config.ts
(cd api && DATABASE_URL=... bundle exec ruby ../scripts/qa/course-outline-fixtures.rb switch on)
QA_OUTLINE=on QA_SPEC=course-outline.spec.ts DEV_LIFECYCLE_SESSION=<session> node web/node_modules/@playwright/test/cli.js test --config scripts/qa/playwright.config.ts
```

Off is today's Learn (the "before", and Lance's shape); On is the outline. Each pass
measures the first lesson's position and the page height for eight persona setups at
1280/390 in light/dark, and writes captures to `docs/qa/course-outline-2026-11-17/`.
See `docs/qa/course-outline-2026-11-17.md`.

### Student lesson redesign (W8.3)

After a fresh harness start, load `lesson-page-fixtures.rb` from `api/` with
its exact owned `DATABASE_URL`. Run `QA_SPEC=lesson-page.spec.ts` with
`DEV_LIFECYCLE_SESSION` set, using the Playwright command above. The spec resets
only its own program journey before each case, uses touch input for textarea
flows and desktop input for Monaco, and permits jsDelivr solely to load Monaco.
It checks On/Off, light/dark, 390/1280, persisted submissions and completion,
redo history, drafts, help and instructor actions. The synthetic video is a
placeholder; it does not establish provider playback. Evidence is under
`docs/qa/lesson-page-2026-11-17/`.

### Student Today and My work (W8 PR 8.2)

After `start`, load the course outline fixture and then the Today fixture, from `api/`:

```sh
DATABASE_URL=postgresql://localhost/<qa db> bundle exec ruby ../scripts/qa/course-outline-fixtures.rb setup
DATABASE_URL=postgresql://localhost/<qa db> bundle exec ruby ../scripts/qa/student-today-fixtures.rb setup
```

The Today fixture adds, on the canonical program: a graded exercise, an answered help request with its
unread notification, an open question, an unread instructor message and next week's live class for
persona 3; seven redos for persona 4 (behind); a behind learner with an agreed catch-up plan
("QA Blair Plan"); and two submissions waiting for review for persona 6. Run one pass per switch
state, from the repo root:

```sh
(cd api && DATABASE_URL=... bundle exec ruby ../scripts/qa/course-outline-fixtures.rb switch off)
QA_TODAY=off QA_SPEC=student-today.spec.ts DEV_LIFECYCLE_SESSION=<session> node web/node_modules/@playwright/test/cli.js test --config scripts/qa/playwright.config.ts
(cd api && DATABASE_URL=... bundle exec ruby ../scripts/qa/course-outline-fixtures.rb switch on)
QA_TODAY=on QA_SPEC=student-today.spec.ts DEV_LIFECYCLE_SESSION=<session> node web/node_modules/@playwright/test/cli.js test --config scripts/qa/playwright.config.ts
```

Off is today's Today (the "before", and Lance's shape). Each pass measures Today's height and the first
actionable item for seven persona setups at 1280/390 in light/dark and writes captures to
`docs/qa/student-today-2026-11-17/`. The On pass also walks View response, the redo link, My work's tabs
and Ask about this feedback; it marks persona 3's help answer unread again afterwards
(`student-today-fixtures.rb unread`). See `docs/qa/student-today-2026-11-17.md`.

### First run and states (W8 PR 8.4)

Start the owned harness, then run `first-run-states-fixtures.rb` from `api/`
with its exact owned `DATABASE_URL`. Run `QA_SPEC=first-run-states.spec.ts`
with `DEV_LIFECYCLE_SESSION` and the Playwright config above. It covers brand-new
self-paced, program first day, alumni, two workspaces, paused, and synthetic
Lance/Off at 390/1280 in light/dark; welcome dismissal/reload, lesson entry,
workspace context, profile targets, and public legal recovery. Each new pass
resets only its welcome dismissal fixtures. See `docs/qa/first-run-states-2026-11-18.md`.

### Student polish and renderer split (W8.5)

Start an owned harness, load `first-run-states-fixtures.rb`, then
`student-polish-fixtures.rb`, `lesson-page-fixtures.rb`, and
`student-workspace-course-fixtures.rb`, each from `api/` with the exact owned
`DATABASE_URL`. Run `QA_SPEC=student-polish.spec.ts` with the lifecycle session
using the Playwright command above. Its Off comparison also needs a second Vite
harness on its own port, from unchanged `main` at `90f075e3`, proxying the same local
API. Set `QA_MAIN_WEB_PORT` to that owned Vite port for the comparison pass. Give that checkout its own installed dependencies so Vite can serve fonts.
It compares visible text, control/heading geometry, fonts and colors; heading
levels may differ for the documented semantic fixes. Run the first-run spec
before the additional fixtures, and the existing lesson-page spec afterwards.
All provider requests are blocked except Monaco's script CDN; no real learner,
GitHub push, payment or provider playback is used. See
`docs/qa/student-polish-2026-11-18.md` for the acceptance ledger and limits.

The student-polish spec now writes captures and comparison JSON under ignored
`.qa-local/student-polish/`; rerunning it does not overwrite the committed W8.5
report evidence. For the small renderer follow-ups, start a fresh harness and
load only `first-run-states-fixtures.rb`, then run
`QA_SPEC=renderer-followups.spec.ts` with the lifecycle session. It checks legacy
Expand/Collapse sizing and the On missing-module recovery at both widths/themes.
Captures and measured sizes go to ignored `.qa-local/renderer-followups/`.

### Staff home, scheduled updates and record pages (W6.4 + L-5.1)

After `start`, load the fixture from `api/` with the exact owned database:
`DATABASE_URL=postgresql://localhost/<qa db> RAILS_ENV=test bundle exec ruby ../scripts/qa/staff-home-scheduled-updates-fixtures.rb setup`.
It posts a pinned, partly read update to QA Program and writes ids to `.qa-local/staff-home-scheduled.json`.
Then run from the repo root:
`QA_SPEC=staff-home-scheduled-updates.spec.ts node web/node_modules/@playwright/test/cli.js test --config scripts/qa/playwright.config.ts`.
The spec schedules, reschedules, cancels and reschedules an update in the browser, checks the student
can't see it, then calls the fixture's `due` and `tick` commands. These run the real `ScheduledTick`
(only its `scheduled_updates` task) against the harness database, with push on the test adapter, and
check it posts once. It also covers the staff home links, School activity, the update page and the
submission page. See `docs/qa/staff-home-scheduled-updates-2026-11-18.md`.

### Staff reliability (U-0.6, U-0.7, U-0.12, U-0.14, #299)

Start a fresh owned harness, then from `api/` run
`DATABASE_URL=postgresql://localhost/<owned csg_qa_ database> bundle exec ruby ../scripts/qa/staff-reliability-fixtures.rb`.
Run `QA_SPEC=staff-reliability.spec.ts DEV_LIFECYCLE_SESSION=<session> node web/node_modules/@playwright/test/cli.js test --config scripts/qa/playwright.config.ts`
from the repo root, with `dev-lifecycle` on PATH. The one-worker Chromium matrix
covers 1280/390: lesson Back, record links, browser Back, tab-close/reload prompts,
backup restoration and lesson switching; update and plan Cancel; unfinished rubric
state across inspector tabs/phone closure; resolving help across staff surfaces;
On/Off manual-complete filename copy; a paused learner after module/cohort date
changes; and refused scheduled-update notifications and drafts. API writes and
fixtures are synthetic and local. Screenshots/traces stay in `.qa-local/`;
selected evidence and limitations are in `docs/qa/staff-reliability-2026-11-18.md`.

### Connected records, finish (L-5.2, L-3.2, L-2.9)

After `start`, load the fixture once from `api/`:
`DATABASE_URL=postgresql://localhost/<qa db> RAILS_ENV=test bundle exec ruby ../scripts/qa/connected-records-finish-fixtures.rb`.
It adds a return plan with check-ins for the behind student, two community reports and a block, lesson activity,
"QA Finish Other Program" (same curriculum, another instructor) with its own plan and report, 30 synthetic purchases
on QA Self paced, and an imported course package used by "QA Package Cohort" (its JSON goes to
`.qa-local/finish-package.json`). Then run, from the repo root:
`QA_SPEC=connected-records-finish.spec.ts DEV_LIFECYCLE_SESSION=<session> node web/node_modules/@playwright/test/cli.js test --config scripts/qa/playwright.config.ts`.
The report scenario marks one synthetic report Reviewing (saved). See `docs/qa/connected-records-finish-2026-11-18.md`.
