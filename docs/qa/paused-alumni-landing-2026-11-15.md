# Paused, alumni and landing QA — review round 1

Agent-executed affected-flow QA, executed November 14–15, 2026 (Guam). This record supersedes the initial PR #222 QA record.

Source: `codex/paused-alumni-landing`, browser QA and primary tests used base `2f594313` with this review implementation. Before push the branch was rebased onto `origin/main` `c316034b` (#223, production Cable configuration only); final integration checks and the subsequent recording-feed fix are recorded below. PR remains held for the lead; no production changes or release verification.

CSG Learn serves students, instructors and admins across guided courses, self-paced courses and the alumni library. Sources: repository `AGENTS.md`, `docs/PRODUCT_VISION.md`, the Brain Dump's `code-school/csg-learn-platform-audit-2026-11-14.md` (U-0.2/L-1.6/U-0.8), and the lead's review decisions. Acceptance: paused learners retain read-only past content and feedback using one school-date cutoff, staff DMs remain usable, class chat/rosters are unavailable, alumni receive a library unless they have a personal plan, and signed-in root visits open Today.

## Access contract

- Convert pause, content creation and availability timestamps to `LearningCalendar::TIMEZONE` before comparing dates. Content must have been created and released on or before the pause date, inclusive.
- Apply the cutoff to assigned lessons and navigation titles, lesson video streaming, both recording feeds and legacy recording links (availability/publication and recorded date), ZIP resources/downloads, class resource links, and weekly plan content.
- Review round 3 supersedes the earlier pause backfill: legacy paused enrollments receive a fixed `read_cutoff_at` from `updated_at`, while their real `paused_at` stays unknown. Later edits preserve the legacy read cutoff. Only an observed pause transition populates `paused_at`; reactivation or dropping clears the real pause timestamp. Backfill legacy recording/file/link availability once from their existing `updated_at`, a conservative historical proxy; future publication captures an explicit timestamp.
- Paused learners retain staff DMs. Peer DMs, class channels, live roster data and class-message writes are denied. Student reactions, edits and deletes require the destination's `can_post?`. Completed behavior and dropped/expired denial remain covered.
- Dashboard staff contact prefers the configured support instructor, then the first non-archived instructor. Native DM failures show an error and configured email fallback through `Linking.openURL` (the web-link helper rejects mailto URLs). Native support screens share `EXPO_PUBLIC_SUPPORT_EMAIL` configuration.

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

Final UI pass after rebase and remaining bot fixes added two saved redo submissions plus future lesson/recording/resource fixtures. Casey Today showed **both** feedback items at 1280/390; opening lesson 678 preserved saved answer and feedback with Review only controls. Browse counted all 245 available lessons, including completed work. The Resources page showed only the past link. Both recording endpoints were verified; the actual recording UI showed one past recording at 1280/390, with the future recording absent. Fran's 80-lesson Browse count matched 80 unique lesson destinations. Fran Start/Continue and Alex root were repeated after the final UI fixes.

The first final recording-page check exposed a second real authorization bug: `/api/v1/recordings` used `StudentRecordingsController`, separate from the already-fixed cohort endpoint. Applied the enrollment cutoff to both its first-class and legacy feeds, preserved original legacy item identities, restarted the API, and repeated the UI check successfully. Bot review also identified a post-pause boolean lesson unlock; assignment availability changes now carry an immutable timestamp until the next availability edit, preventing later unlocks or backdated overrides from admitting the lesson.

## Automated verification

- API isolated database `csg_pr222_r1_20261114`, `RAILS_ENV=test`, `PARALLEL_WORKERS=1`: 149 tests / 1,174 assertions passed across context, resources, learner capabilities, messaging, workspace authority/models and weekly projection. Recording/expiry/pause-backfill batch: 40 tests / 222 assertions passed. After roster response repair: context suite 12 tests / 97 assertions passed.
- Class-link, dashboard/context, role-matrix, self-paced-access and both availability migration checks: 107 tests / 602 assertions passed. This also verifies that later title/settings edits do not advance legacy availability dates. The first class-link test expected student access to a staff-only cohort endpoint; corrected it to assert the existing 403 policy and reran the full batch.
- ASUS full API suite attempted with `asus-test --postgres csg_pr222_r1_full_20261114 <worktree> -- bash -lc 'cd api && bin/rails db:schema:load && PARALLEL_WORKERS=1 bin/rails test'`. Runner rejected it with `another asus-test run is active`. Did not disturb the other run; full API coverage remains the CI gate.
- Web: `npm run lint` and `npx tsc -b` passed. Initial full Vitest: 121 files / 824 tests passed. After the remaining bot fixes, full Vitest passed 826 of 827 tests; the unchanged MessagesLifecycle concurrent-render test exceeded its explicit two-second commit wait under local load. Its retry together with Dashboard and LessonView destination suites passed: three files / 27 tests. No unrelated test or timeout setting was changed.
- Native: `npx tsc --noEmit` passed, including a final typecheck after the switcher label edit. Full Jest: 116 suites passed, one suite failed on an unchanged navigation test's 5-second timeout (875 passed / one timed out). Reran that suite and changed-screen suite with `--testTimeout=15000`: two suites / 34 tests passed. After the native email and all-empty-module fixes, final typecheck and the same focused batch passed again: two suites / 36 tests. These are successful targeted retries, not a clean first full run.
- Final full RuboCop after rebasing #223: 490 files, no offenses. Advisory Impeccable scan returned `[]`.

Logs: `/Users/leonshimizu/.local/state/shimizu-technology/csg-pr222-r1-20261114/`. Initial regression failures came from missing fixture terms acceptance, a lesson that unlocked after the test's pause date, and an invalid managed video key; corrected fixtures and passing reruns are retained in the logs.

Final API verification on base `c316034b` used the isolated `csg_pr222_rebase_20261114` database. The Cable/context/messaging integration batch passed 99 tests / 660 assertions. After recording lesson-assignment availability changes, the Cable/context/capabilities/resources/recording/expiry/weekly/migration batch passed 87 / 588. After the aggregated/legacy recording-feed repair, recording/expiry/migration tests passed 41 / 236. The final contact/context rerun passed 13 / 104, including a configured support instructor different from the cohort's first instructor and matching available DM recipients.

Extending the unpublished availability migration left an interim local schema incomplete; those invalid-schema test attempts were discarded, all three new columns were restored in the owned database, and the generated schema was verified before the passing final runs. A recording cutoff fixture used UTC `Date.current` across Guam midnight; corrected it to `LearningCalendar.today` and reran the entire 87-test batch. Legacy settings mutation tests now snapshot the full persisted settings (including availability metadata) before forbidden writes, preserving their original protection assertion.

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

Final-pass screenshots:

- Casey feedback and past resource, desktop: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwghdxgk-01c4855e.png`
- Casey feedback and past resource, phone: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwghemhw-49710b75.png`
- Casey saved answer and review-only feedback: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwghfshv-7609833e.png`
- Casey recording feed after repair: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwghqqem-143c87f0.png`

## Cleanup and handback

Stopped exact Ruby PIDs 64258 and 89336 and Vite PID 64326. Closed owned preview tab `tab_30_e60e53fc-08fc-48e4-b927-3d2799347d0a`. Dropped the isolated API and QA databases and removed the task's Vite cache. Lifecycle session `01a1da34-90b3-7c03-a0f2-fe8b1de28555` reported no active owned resources. The final class-link database `csg_pr222_links_20261114` was also dropped. The final-pass Ruby PIDs 43463 and 8407 and Vite PID 43515 were also stopped, final preview tab `tab_31_e60e53fc-08fc-48e4-b927-3d2799347d0a` closed, and `csg_pr222_rebase_20261114` plus the recreated QA database dropped. Worktree and branch remain available for the lead's independent re-review and merge decision.


## Review round 2 — November 15, 2026

Agent-executed affected-flow follow-up to independent review of `48dee388ffca71acdfe5b6740f412b767dab23e9`. Tested the round-2 implementation in this commit on unchanged integration base `c316034b0bdceeadbe2f94f278eaad725310a871`. Scope: message mutation compatibility, module assignment cutoff, deterministic migration backfill, paused Learn empty states, configured web support email, native email failure, and deployment documentation. The local handoff records the resulting commit SHA. No production data or configuration changed.

Sources: `docs/PRODUCT_VISION.md`, the existing handoff and QA record, canonical Brain Dump `code-school/csg-alumni-learning-library.md`, and current enrollment/lesson/message authorization code. CSG Learn combines curriculum, submissions, feedback, recordings and messaging for students and teaching staff. Alumni retain a library, while a paused enrollment retains only content available by its inclusive Guam pause date. Completed learner messaging rules must stay unchanged. Clerk identity, S3 signing, Render/Netlify delivery and Neon remain existing integrations; this round does not change them.

### Acceptance and evidence

| Case | Fixture, action and expected result | Execution |
| --- | --- | --- |
| R2-A01 | Completed learner, learner with expired self-paced support, and learner in a blocked DM react/unreact, edit and delete their own message. Paused learner attempts the same operations on class messages and is denied. | Passed API integration checks, including saved body/deletion/reaction state. |
| R2-A02 | Self-paced/alumni paused enrollment receives an old lesson's module through the individual module assignment API after the cutoff. Lesson and video return 403; a pre-pause module stays readable. Later guided module unlock/backdated override remains denied; an independent pre-pause lesson override remains readable. | Passed API integration checks and dashboard projection assertions. The current cohort bulk endpoint targets active enrollments; the individual assignment API can still assign paused enrollments. |
| R2-A03 | At 23:59:59 Guam on the pause date, recordings, ZIP files and class links stay available. At 00:00 on the next Guam date, they are excluded/403. | Passed recording feeds/detail, resource listing and signed-download integration checks. |
| R2-A04 | Migrate down/up twice on a legacy fixture with multiple class links and recordings. Keep array order and existing JSON availability metadata, backfill paused assignments, leave active lesson assignments null, preserve timestamps across unrelated edits. | Passed migration integration check. |
| R2-U01 | Paused preview fixture with an assigned module containing zero readable lessons: open Learn and inspect empty copy and module visibility. | Passed Chromium at 1280×900 and 390×900. Copy explains pre-pause content and resumption; empty module absent. |
| R2-U02 | Add a readable module beside the empty module; search for an absent phrase then search for the past lesson. | Passed both viewports: readable module/lesson links present, empty module absent, no-match state recovers. |
| R2-U03 | Paused Today fixture without a support instructor, with `VITE_SUPPORT_EMAIL=review-support@example.com`: inspect Message staff. | Passed both viewports: href uses the configured address; no horizontal overflow. Native mail transport was not launched by the browser fixture. |
| R2-A05 | Native Today with no support instructor: reject `Linking.openURL`. | Passed Jest: visible alert offers configured email support; no DM creation/navigation. Paused native Learn copy/empty-module regression also passed. |

UI cases used a temporary Vite entry rendering the real Materials/Dashboard components with synthetic preview props, actual CSS and router. This verifies the changed views and interactions, not live Clerk authentication or an end-to-end API-backed journey. Browser and Vite were closed after QA. Screenshots: local log directory `paused-empty-1280.png`, `paused-empty-390.png`, `paused-mixed-1280.png`, `paused-mixed-390.png`. Native device, physical mail-handler behavior and installed PWA remain not run; React Native behavior was exercised through Jest.

### Automated checks

- API, isolated `csg_pr222_r2_20261115`, `RAILS_ENV=test`, `PARALLEL_WORKERS=1`: **274 tests / 1,580 assertions passed** across messages, student context, enrollment/module access, learner capabilities, role matrix, self-paced access, recordings, resources, module model and both pause/availability migrations. Adjacent cohort/workspace/weekly-plan/submission-window/grading batch: **29 / 281 passed**. These are separate batches, not a full local API suite.
- ASUS full API attempt used `asus-test --postgres csg_pr222_r2_full_20261115`; rejected with `another asus-test run is active`. No other run was interrupted. Full API coverage remains a final-head CI gate.
- Web: lint and `npx tsc -b` passed; **121 Vitest files / 831 tests passed** with two workers.
- Mobile: `npx tsc --noEmit` passed; **117 Jest suites / 880 tests passed**, in band.
- Final RuboCop: **490 files, no offenses**. Impeccable advisory scan: `[]`. `git diff --check` passed.

Retained initial failures: the new messaging fixture tried to use an admin as the required assigned instructor, then tried to demote the last admin; replaced it with a separate assigned instructor. The new module test first used an instructor on an admin-only bulk endpoint, then assumed that bulk endpoint included paused enrollments; changed the test to the supported individual module assignment API. A Vitest parameterized empty-array case was initially expressed as positional arguments; corrected it to named fixture objects. Passing final runs above include all repairs. The first browser attempt hit a terminated shell-background Vite process; a lifecycle-owned foreground server was started and both viewport checks then passed. During isolated database setup, the extended unpublished migration could not roll back a schema missing its new module column; added that column only in the owned database, then verified migration down/up and the generated schema before tests.

Logs and screenshots: `/Users/leonshimizu/.local/state/shimizu-technology/csg-pr222-r2-20261115/`.

### Remaining review and cleanup

The lead owns final-head independent review and merge. Earlier green CI/review coverage does not establish approval of this round. Residual behavior: changing a resource link's URL counts as a new resource; a title-only edit keeps its original availability. Deployment documentation now requires migration runs through Neon's direct URL, or an explicit decision to disable advisory locks and serialize runners externally. Production config is unchanged.

Lifecycle session `01a1da7c-e62c-7811-bd6f-351b452e5ca6` reports no active owned resources after stopping exact Vite PID 73172. The terminated initial background process was also reconciled. The temporary preview entry files were removed and the owned test database was dropped. Borrowed PostgreSQL, Redis, simulators and shared services stayed running. No runtime handoff; retain the existing worktree and branch for the lead.


## Review round 3 — November 15, 2026

Agent-executed affected-flow follow-up to CodeRabbit findings on `48dee388` that remained at round-2 head `2e7b6f2ea5af94f83ee472049d7f524d8fe02409`. Verified the existing worktree/branch, clean tracked files, PR target `main`, and unchanged integration base `c316034b0bdceeadbe2f94f278eaad725310a871` after fetch. No rebase was needed. This section supersedes earlier descriptions of historical pause backfilling. The local handoff records the resulting round-3 SHA. PR is held: no merge, production changes, or other agents.

Sources and scope: existing product brief above, current Rails authorization/projection code, mobile Today/CourseSupportAction and registered conversation routes, repository `AGENTS.md`, and canonical Brain Dump `code-school/csg-alumni-learning-library.md`. Preserve a paused learner's past library and staff contact while refusing new content and peer conversations. Clerk, object storage, and deployment configuration are unchanged.

### Acceptance and results

| Case | Action and expected outcome | Result and evidence |
| --- | --- | --- |
| R3-A01 | Expire or revoke read access after selecting cohorts but before resolving enrollments. List class resources/course files and aggregated legacy recordings. | Passed API integration tests: both feeds omit the cohort instead of passing nil to permissive link helpers. First-class recording items are also absent. |
| R3-A02 | Edit lesson/module overrides between dates already readable at pause time; change irrelevant boolean/date fields. Contrast with actual late unlocks and edits moving currently open content across the historical cutoff. | Passed model and integration tests: neutral edits keep history readable; newly available content stays denied. Legacy null assignment timestamps preserve their previous updated_at baseline. Module date edits also check later lesson availability. Removing a later lesson does not hide an earlier lesson that remains available. |
| R3-A03 | Assigned instructor/admin selects a paused learner and creates a cohort DM. Peer and unrelated instructor attempt the same; expire the paused enrollment. | Passed actual recipient/create API calls and persisted conversation visibility/posting assertions. Staff can start the DM; peers, unrelated staff and expired learner recipients remain excluded. System recipient_users keeps its active-only policy. |
| R3-A04 | Apply/reverse the pause migration twice, reapply up after unrelated edits, and then pause again through the app. | Passed migration and dashboard integration checks. Only legacy paused rows receive read_cutoff_at, with no invented paused_at or paused_since. Cutoff stays fixed across edits/reapplied up; a real new paused_at supersedes it for access. Missing both dates fails closed. Other availability migration remains unchanged, including paused-only assignment backfill and deterministic JSON ordering. |
| R3-A05 | Press Message staff after createCohortDm succeeds. Render a historical pause with no known date. | Passed React Native Jest: navigates to /conversation/dm/42 with no Href cast; unknown pause date is omitted. Type-check with generated Expo routes passes; a temporary @ts-expect-error negative control confirms the old /messages/dm/42 path is rejected. |
| R3-A06 | Request a default weekly plan with paused-only access, add active access, then expire/drop access. | Passed projection tests: paused-only remains enrolled/read-only; active wins; expired/dropped access does not provide fallback. Explicit cohort selection retains its existing read-access behavior. |

Native device navigation, live Clerk/provider flows, and new browser QA were not run in round 3. The native change was tested through rendered React Native interactions and generated route types. Prior-round browser evidence remains historical evidence for those earlier heads. Web source was unchanged, so web lint/typecheck/Vitest were not rerun this round.

### Automated checks

- Final isolated API batch, `RAILS_ENV=test DATABASE_URL=postgresql://localhost/csg_pr222_r3_20261115 PARALLEL_WORKERS=1`: **323 tests / 2,022 assertions passed**, no failures/errors/skips. Covers resources, both recording feeds, lesson/module assignment, enrollment/dashboard context, workspace/DM, weekly plan, both migrations, messaging, learner capabilities, self-paced access and role matrix. This is affected/adjacent coverage, not a full API-suite claim.
- ASUS full API attempt with `--postgres csg_pr222_r3_full_20261115` rejected with **another asus-test run is active** (exit 75). No other run was disturbed. Full API remains a final-head CI gate.
- Mobile: **117 Jest suites / 882 tests passed**. Standard and generated-route `npx tsc --noEmit` passed, including the old-route negative control. Brand check and URI decoder tests passed. Expo lint passed with 27 existing warnings and zero errors.
- RuboCop: **491 files, no offenses**. Brakeman: no warnings. Bundler audit: no vulnerabilities. Advisory Impeccable: `[]`. `git diff --check` passed. Generated Rails schema differs only by the new read_cutoff_at column.

Initial attempts retained in logs: schema load launched from the monorepo root failed to find the Rakefile, then succeeded from api/. Four new assignment test failures came from Ruby block binding on inline travel_to calls; changed these to explicit do/end, then reran the expanded batch successfully. Later regressions added null assignment history and both-currently-past cutoff-crossing cases; the final 323-test batch includes them. The earlier 318-test passing batch is superseded by this final batch.

Logs: `/Users/leonshimizu/.local/state/shimizu-technology/csg-pr222-r3-*.log`. Review-thread replies and final GitHub state are recorded in the local handoff. Lead owns independent final-head review and any merge decision. No automatic review/watch or merge approval is implied by these local results.

### Round-3 cleanup

Dropped `csg_pr222_r3_20261115` and verified its absence in pg_database. Removed the generated Expo route declarations, temporary route negative control and task-created Expo lint cache. No servers, browser tabs, simulators or containers were started. Lifecycle session `01a1da88-df0e-7112-9a02-f6f0afedeaee` reports no active owned resources after cleanup. Borrowed PostgreSQL, Redis, simulators and shared services remain untouched. Existing dependencies/worktree/branch are retained for the lead; no runtime resource handoff.


Round-3 CI follow-up: full API CI on initial round-3 head `0baeef5e` ran **1,080 tests / 7,457 assertions** and found one failure in the new legacy-cutoff fixture: Linux Ruby supplied nanosecond time while PostgreSQL persisted microseconds. The expected and actual cutoff differed by 560 nanoseconds. Normalized that fixture to whole seconds; application code is unchanged. Local affected context/migration/assignment checks passed after the correction: **30 tests / 211 assertions**, with the changed test file RuboCop-clean. The recreated isolated database was dropped again. Final-head CI must still be read separately from the earlier source verification.
