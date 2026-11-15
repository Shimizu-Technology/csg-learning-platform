# App shell navigation acceptance — November 15, 2026

Base: `46de161` (main, feature switches #240/#242). Branch: `feat/app-shell-nav`.
Sources: `docs/PRODUCT_VISION.md`, design README §2–3 and §12, `01-app-shell.html`, current routes and enrollment capabilities. This hub serves students learning and communicating within an enrollment, instructors reviewing/supporting assigned students, and admins managing the school. Clerk supplies identity; the Rails API supplies enrollment permissions and resolved school/cohort switches. No production data or provider credentials were used. Brain Dump itself is unavailable on this host; the supplied brief and synced guidance were used.

Agent-executed affected-flow QA used the synthetic #227 harness, Chromium preview, 1280×844 and 390×844. The tested source is the implementation committed with this record. No native, Safari/WebKit, Clerk login, delivery, payment, or production deployment acceptance is claimed.

## Required scenarios

All eight role/viewport combinations passed navigation inventory, logo href, absence of a global staff switcher, single-course learner switcher hiding, no horizontal overflow, and at least 44px visible navigation targets:

| Role | Primary sidebar/drawer links | More | Admin |
| --- | --- | --- | --- |
| Admin | Today, Cohorts, Students, Grading, Support, Content, Messages | Updates, Recordings, Meetings | School activity, Team, Safety |
| Instructor | Today, Cohorts, Students, Grading, Support, Content, Messages | Updates, Recordings, Meetings | absent |
| Guided learner | Today, Learn, Messages | My cohort, My meetings, Recordings, Resources, Updates | absent |
| Self-paced learner, single course | Today, Learn, Messages | Resources, Updates | absent |

Messages unread counts remained visible. Staff links stay global even after visiting a cohort. All three logos use `/admin` for staff and `/dashboard` for learners. Clicking the phone drawer logo returned to Today and closed the drawer. Collapsing the desktop sidebar produced 68px width, labeled icon links, and `aria-current="page"` on Today.

Phone web tabs are Today / Grading / Support / Messages / More for staff, and Today / Learn / Messages / More for learners. The drawer has the full inventory above. Native Expo grouping is deferred to W10; no mobile source changed.

More keyboard execution on the phone: ArrowDown opened the group and focused Updates; End focused Meetings; Escape closed only More, restored its trigger's focus, and kept the drawer open. More and Admin arrow/Home/End/Escape behavior is also covered by component tests. The drawer traps Tab; destinations retain ordinary link keyboard behavior and current-page aria.

Unknown signed-in and signed-out URLs kept their address and rendered Page not found. Signed-in admin saw the app shell and a Today link to `/admin`; signed-out saw a public home link and no app shell. Route tests additionally cover instructor/student and every role's three logo hrefs.

## Automated checks

- Node 20.19.5, fresh `npm ci`.
- Both web TypeScript projects, ESLint, production build, and `test:bundle`: passed.
- Vitest: 151 files, 1,466 tests passed. Includes role/feature on/off navigation, distinct icons, learner capability resolution, single/multiple-course switcher, disclosures, unknown routes and logos.
- Focused Rails cohort-workspace/channel integration tests and RuboCop: passed (28 tests, 164 assertions). Existing Channel policy already blocks self-paced class channels; a regression test now verifies list and direct access alongside the exposed live-support capability. No channel policy change was necessary.
- Impeccable 4.6.0 advisory scan of changed shell components: no findings (`[]`).

## Scope and cleanup

App.tsx overlaps #245 only for the NotFoundRoute import, wildcard replacement, and staff home title Today. ProtectedRoute, SignIn and RecordLink remain untouched. #245 was still open, so NotFound is a sibling component rather than a dependency on its No access page.

This slice groups existing destinations; it does not create the future My work, Office hours, Catalog or School settings routes from the full redesign. Existing meetings and resources remain reachable. Capability-driven class-channel policy is preserved; direct instructor messages remain available to self-paced learners.

The preview tab was closed, both exact harness-owned server PIDs were stopped and the synthetic database dropped with `scripts/qa/run clean`. The separate branch-named API test database was also dropped. Shared PostgreSQL was already available and remains running.

Local guidance tooling has setup drift: lifecycle begin reports `Invalid machine profile: schema_version must be 1`, and the shared-context read-only check reports missing `~/.config/shimizu-technology/agent-context.json`. No shared setup was changed. Harness PID/start-signature/database records supplied exact cleanup ownership instead.
