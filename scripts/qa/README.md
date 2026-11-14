# Local signed-in QA

Run from the repository root. Requires the repo Ruby/Node versions, Python 3,
PostgreSQL client tools on PATH, installed API gems (`cd api && bundle install`)
and web packages (`cd web && npm ci`). On the mini, run `agent-postgres start`.
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
All names, addresses, work and curriculum are invented. `example.invalid` media
and meeting links intentionally do not play or connect. Never import real
curriculum, student data, answer keys or tokens into this public repository.

Rails is forced to test mode and checks both URL and connected database name.
The harness binds only to loopback; never expose these unauthenticated role
switches on a network. Net::HTTP blocks non-loopback destinations and jobs are
queued without execution. Set `QA_ASYNC_CABLE=1` before startup for in-process
ActionCable checks; this does not test production delivery or background workers.
The stub is loaded only by this Vite runner; normal builds retain real Clerk.
Vite ignores web env files. Smoke tests also block external browser requests.

Use `PARALLEL_WORKERS=1` for separate Rails tests on the mini, with a separate
test database. In zsh, do not name a variable `path` (it changes PATH).
Smoke covers four roles at 1280 and 390 using Chromium. It does not establish
Expo/native, Safari, Clerk, video playback, email, push or payment acceptance.
No required CI job is added by this PR. Harness TypeScript lives outside web's
tsconfig scope; Playwright/Vite transpile it directly.
