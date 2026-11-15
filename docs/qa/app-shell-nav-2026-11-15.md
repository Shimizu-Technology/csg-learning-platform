# App shell navigation acceptance — November 15, 2026

Base: main `a94579b` (#245), merged in `981294e`. Round-one fixes are the commit containing this record. Branch: `feat/app-shell-nav`.
Sources: `docs/PRODUCT_VISION.md`, design README §2–3 and §12, `01-app-shell.html`, current routes and enrollment capabilities. This hub serves students learning and communicating within an enrollment, instructors reviewing/supporting assigned students, and admins managing the school. Clerk supplies identity; the Rails API supplies enrollment permissions and resolved school/cohort switches. No production data or provider credentials were used. Brain Dump itself is unavailable on this host; the supplied brief and synced guidance were used.

CSG Learn now groups staff work into seven primary destinations and learner work into Today, Learn and Messages. Desktop More is a static labelled section, including admin destinations; phones retain More/Admin disclosures that open when their current destination is active.

| Role | Primary sidebar/drawer | Desktop More | Phone groups |
| --- | --- | --- | --- |
| Admin | Today, Cohorts, Students, Grading, Support, Content, Messages | Updates, Recordings, Meetings, School activity, Team, Safety | More: Updates, Recordings, Meetings; Admin: School activity, Team, Safety |
| Instructor | Today, Cohorts, Students, Grading, Support, Content, Messages | Updates, Recordings, Meetings | More: Updates, Recordings, Meetings |
| Guided learner | Today, Learn, Messages | My cohort, My meetings, Recordings, Resources, Updates | More: same |
| Self-paced learner, single course | Today, Learn, Messages | Resources, Updates | More: same |

Staff management destinations remain reachable regardless of school/cohort switches. Visiting a cohort never changes Today or Updates: staff saved selections are cleared, Today filters only from explicit `?cohort_id`, and filtered Today shows a cohort chip with Show all. Phone tab columns follow the actual item count.

Learner links preserve default behavior while accessible cohorts load or fail. My meetings appears if any accessible course offers live meetings and links to an eligible course. Other learner features follow selected enrollment capabilities. The accessible-cohorts API preloads enrollment cohort support instructors/workspaces, batches block checks and reuses resolved features; a query-count regression covers one versus five supported courses.

Merged main `a94579b` (#245), resolved App.tsx imports, and unified No access / Page not found into StatusPage variants. Signed-in unknown URLs use ProtectedRoute. Navigation, breadcrumbs and page titles use Today and Support.

Validation on Node 20.19.5: both TypeScript projects, ESLint, 1,538 Vitest tests across 152 files, production build, bundle gate; API 57 tests / 396 assertions and RuboCop passed. Impeccable advisory scan: no findings. Synthetic Chromium navigation QA passed for all four roles at 1280×844 / 390×844, including school-Off/cohort-On staff links, all-cohorts Today after visiting a cohort, explicit filter clearing and active disclosures. Details: `docs/qa/app-shell-nav-2026-11-15.md`.

No migrations or production configuration changes. Safari/WebKit, real phones, Expo, real Clerk authentication and deployment verification were not run. Exact task-owned runtime resources are cleaned; the worktree remains for follow-up. The lifecycle helper still reports an invalid machine-profile schema, so harness ownership records supplied cleanup.

Round-one Opus findings addressed; final-head review/CI remain for the lead. **Do not merge or watch.**


Additional execution evidence (agent-executed, synthetic fixtures):

- Preview inventory: admin, instructor, guided learner and self-paced learner at 1280×844 and 390×844 passed; all visible navigation links measured 44px high, no horizontal overflow.
- Admin and instructor visited `/admin/cohorts/1` and clicked the Today logo at both widths. Today had no cohort chip or saved key and showed five active enrollments across cohorts.
- Explicit `/admin?cohort_id=1` showed `Cohort: QA Program · Show all` at both widths. Show all cleared the query and restored the all-cohorts summary.
- In the local harness database, school Meetings/Recordings/Updates/Support switches were set Off and cohort 1 overrides On. Both staff roles retained all management links at both widths. The all-Off case is covered by unit tests.
- Phone More opened automatically on Recordings; Admin opened automatically on Team; current links were visible. Signed-in unknown URL retained its address and showed Page not found in the shell.
- Existing harness smoke and synthetic sign-in/No access cases: 10 passed (38.8s), including four-role page journeys at both widths. Raw results are in ignored `.qa-local/results.json`.
- Learner loading/failure defaults and a meeting-enabled course different from the selected course are unit-tested; this multi-course combination was not separately seeded for browser QA.

Owned resources cleaned: preview tab `tab_w_89c280d8-30cd-43c8-87b2-8d384475a23b`; harness PIDs 20491/20495 and database `csg_qa_20455_1794711190`; test database `csg_app_shell_nav_r1_test`. Listener baseline: `/tmp/246-listeners-baseline.txt`. Shared PostgreSQL remains available. Lifecycle helper could not record a session because the machine profile schema was invalid; the harness validated exact process identities during cleanup. The original checkout is clean and detached at main; stale local `feat/signin-destinations` was deleted. The PR worktree remains available for the lead. Prior Opus review remains stale until the fixed head is reviewed.
