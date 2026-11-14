# Paused, alumni and landing QA — review round 1

Agent-executed affected-flow QA, executed November 14, 2026 (Guam). Task and filename retain the November 15 planning date. This record supersedes the initial PR #222 QA record.

Source: `codex/paused-alumni-landing`, browser QA and primary tests used base `2f594313` with this review implementation. Before push the branch was rebased onto `origin/main` `c316034b` (#223, production Cable configuration only); final integration checks are recorded below. PR remains held for the lead; no production changes or release verification.

CSG Learn serves students, instructors and admins across guided courses, self-paced courses and the alumni library. Sources: repository `AGENTS.md`, `docs/PRODUCT_VISION.md`, the Brain Dump's `code-school/csg-learn-platform-audit-2026-11-14.md` (U-0.2/L-1.6/U-0.8), and the lead's review decisions. Acceptance: paused learners retain read-only past content and feedback using one school-date cutoff, staff DMs remain usable, class chat/rosters are unavailable, alumni receive a library unless they have a personal plan, and signed-in root visits open Today.

## Access contract

- Convert pause, content creation and availability timestamps to `LearningCalendar::TIMEZONE` before comparing dates. Content must have been created and released on or before the pause date, inclusive.
- Apply the cutoff to assigned lessons and navigation titles, lesson video streaming, recordings (publication and recorded date), ZIP resources/downloads, class resource links, and weekly plan content.
- Backfill legacy paused enrollments once from `updated_at`; subsequent edits preserve `paused_at`. Reactivation or dropping clears it. Backfill legacy recording/file/link availability once from their existing `updated_at`, a conservative historical proxy; future publication captures an explicit timestamp.
- Paused learners retain staff DMs. Peer DMs, class channels, live roster data and class-message writes are denied. Student reactions, edits and deletes require the destination's `can_post?`. Completed behavior and dropped/expired denial remain covered.
- Dashboard staff contact prefers the configured support instructor, then the first non-archived instructor. Native DM failures show an error and configured email fallback. Native support screens share `EXPO_PUBLIC_SUPPORT_EMAIL` configuration.

## Fixture preflight and environment

Copied the existing audit harness into `/tmp/csg-pr222-r1-qa`, pointed it at this worktree, and seeded a fresh isolated PostgreSQL database with synthetic users and curriculum content. Verified Casey=5 (paused Cohort 3), Fran=8 (active alumni library), Alex=3 (active learner), instructor=2. No external messages sent. Local API used the test job adapter and blocked external HTTP.

API: `127.0.0.1:3732`; Vite: `127.0.0.1:5732`; browser: 1280×800 and 390×844 CSS viewports. These are desktop-browser checks, not native-device evidence. The local Clerk shim additionally supported `qa_user=0` and `qa_loading=1` for signed-out/loading acceptance; real Clerk login was not exercised.

## Browser execution

| Case | Expected and observed outcome | Result |
| --- | --- | --- |
| Casey Today and switcher, 1280/390 | Saved-work message, Guam pause date, Paused cohort label, reachable Message staff; no page overflow | Passed |
| Casey Learn, 1280/390; past lesson at 390 | Lessons remain browsable; opening Debugging retains cohort context and shows Review only controls | Passed |
| Casey Message staff at 390 | Creates and opens Audreana Instructor DM with a usable composer; no external send | Passed after repair |
| Fran Today, 1280/390 | Library start action, Recently added and library counts; no course-progress hero | Passed |
| Fran Learn, 1280/390 | Library copy and 80 available lessons across nine nonempty visible modules; no page overflow | Passed |
| Fran resume at 390 | Open library lesson 238, return to Today; local `csg-last-lesson:8:3=238` and Continue action both retained | Passed |
| Alex root, 1280/390 | Root redirects to `/dashboard`, shows Alex and Go to Today logo semantics | Passed |
| Signed-out root at 390 | Marketing stays visible both with Clerk held loading and with loaded signed-out state; remains at `/` | Passed |
| Native device, installed PWA, live Clerk login | Native tests/typecheck and manifest inspection only; no device/install/provider journey | Not run |

Initial round-1 Casey DM navigation exposed a real error boundary: hiding the roster omitted the `members` array that the web client requires. Repaired the API to return `members: []` and `member_count: 0`, restarted the exact QA Ruby process, repeated the journey successfully, and reran the 12-test context suite. The initial implementation's interrupted full local API run is historical evidence, not a passing full-suite claim.

## Automated verification

- API isolated database `csg_pr222_r1_20261114`, `RAILS_ENV=test`, `PARALLEL_WORKERS=1`: 149 tests / 1,174 assertions passed across context, resources, learner capabilities, messaging, workspace authority/models and weekly projection. Recording/expiry/pause-backfill batch: 40 tests / 222 assertions passed. After roster response repair: context suite 12 tests / 97 assertions passed.
- Final class-link, dashboard/context, role-matrix, self-paced-access and both availability migration checks: 107 tests / 602 assertions passed. This also verifies that later title/settings edits do not advance legacy availability dates. The first class-link test expected student access to a staff-only cohort endpoint; corrected it to assert the existing 403 policy and reran the full batch.
- ASUS full API suite attempted with `asus-test --postgres csg_pr222_r1_full_20261114 <worktree> -- bash -lc 'cd api && bin/rails db:schema:load && PARALLEL_WORKERS=1 bin/rails test'`. Runner rejected it with `another asus-test run is active`. Did not disturb the other run; full API coverage remains the CI gate.
- Web: `npm run lint`, `npx tsc -b`, and all 121 Vitest files / 824 tests passed.
- Native: `npx tsc --noEmit` passed, including a final typecheck after the switcher label edit. Full Jest: 116 suites passed, one suite failed on an unchanged navigation test's 5-second timeout (875 passed / one timed out). Reran that suite and changed-screen suite with `--testTimeout=15000`: two suites / 34 tests passed. This is a successful targeted retry, not a clean first full run.
- Final full RuboCop: 488 files, no offenses. Advisory Impeccable scan returned `[]`.

Logs: `/Users/leonshimizu/.local/state/shimizu-technology/csg-pr222-r1-20261114/`. Initial regression failures came from missing fixture terms acceptance, a lesson that unlocked after the test's pause date, and an invalid managed video key; corrected fixtures and passing reruns are retained in the logs.

## Evidence

Local screenshots (not committed binary assets):

- Casey Today desktop: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgfzn8g-41db1eae.png`
- Casey staff DM phone after repair: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgg31fr-06229631.png`
- Casey review-only lesson phone: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgg457a-5a181de6.png`
- Casey Learn desktop: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgg4ctj-70fec4d0.png`
- Fran Today desktop: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgg5emx-86fe6204.png`
- Fran Today phone: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgg64g7-95f8d204.png`
- Fran Learn phone/desktop: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgg80rg-64a59533.png`, `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgg8poq-c82bb819.png`
- Marketing while Clerk stays loading: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwggaer9-08425d53.png`

## Cleanup and handback

Stopped exact Ruby PIDs 64258 and 89336 and Vite PID 64326. Closed owned preview tab `tab_30_e60e53fc-08fc-48e4-b927-3d2799347d0a`. Dropped the isolated API and QA databases and removed the task's Vite cache. Lifecycle session `01a1da34-90b3-7c03-a0f2-fe8b1de28555` reported no active owned resources. The final class-link database `csg_pr222_links_20261114` was also dropped. Worktree and branch remain available for the lead's independent re-review and merge decision.
