# Student workspace — W7 PR 7.5

Current result: fix-round source `6e958c08` has passed focused red/green regressions and all **16 required fix-round browser scenarios**. The full ASUS gate, including both API prepared-statement modes, is running after waiting for the shared runner. Earlier full gates and 72-scenario passes below are historical evidence. PR #284 stays open without merging, watching or dismissing reviews.

## Context and acceptance

Implementation worker, 2026-11-17. Isolated worktree `t3-0b20b940-41485f063e89d167`, branch `feat/student-workspace`, started from `51b0d7ce` (PR #280), then rebased onto `ac28c0b9` (PR #281 grading workbench) after it merged during verification, then explicitly merged `c62eb42a` (PR #279 Updates composer) as `ec05651b` following the amended brief. Hold for the lead: open a PR; do not merge or watch.

CSG Learn serves Code School of Guam students and their instructors across live programs, guided and self-paced courses, and the alumni library. This change helps staff review one learner in one enrollment, act on the reasons that need attention, follow linked learning/work/support, and inspect a read-only student view without leaving preview. Clerk, Rails, React/Vite, and Expo remain the existing authentication and delivery stack. Deployment is Render API / Netlify web / Neon; no production changes are authorized or needed.

Sources: `docs/PRODUCT_VISION.md`, `docs/design/2026-11-platform-redesign/README.md` §§2, 4.2–4.4, 5–6; approved `06-student-workspace.html`; Brain Dump `code-school/csg-learn-platform-audit-2026-11-14.md`; current `LearnerProgress`, `AttentionProjection`, record-route registry, and the local QA harness. Some lesson/module record links are already present on the base and need retained regression coverage.

Design: preserve Manrope, semantic light/dark tokens, quiet operational controls, 44px phone targets, explicit Back destinations, copyable record links, and recoverable section errors. Existing disclosures change immediately; navigation and tab changes add no delay or new animation. Reduced motion keeps content and controls available.

Agent-executed affected-flow QA, required at 1280px and 390px in light and dark. Native parity covers the existing staff student screen; new native workspace/preview screens are out of scope. Browser resizing establishes responsive web behavior only. External delivery, Clerk, real meetings/media, Safari and physical native devices are excluded from local synthetic QA.

| Case | Required behavior and starting fixture | Status |
| --- | --- | --- |
| S01 | Admin and instructor open program/behind profiles; Message opens exact conversation, Grade next opens the server-paged workbench with the student/cohort filters and server-selected review; Previous/Next work, Start follow-up saves and opens the plan; Why flagged matches shared status | passed |
| S02 | Every profile metric opens its explaining tab/section; lesson, module, milestone and related links preserve enrollment and Back destination, including new-tab URL context | passed |
| S03 | Switch between two authorized enrollments; preserve selected tab and origin; hide inaccessible cohorts; changing student/cohort cannot display stale responses or discard a draft silently | passed |
| S04 | Communication shows recent permitted direct messages, student channel activity and permitted meetings; exact links and Back context work; empty/failure/retry states are distinct | passed |
| S05 | Support links retain cohort, have 44px phone targets, and return correctly | passed |
| S06 | Cohort module cards expose Grade, Lessons, shared progress and an assigned-student filter; insights/objective names open exact records and return | passed |
| S07 | Preview Today Continue, next task, lesson/module links and lesson Back remain in selected enrollment preview; read-only content, dark theme, no duplicate keys, one header entry point | passed |
| S08 | Six student personas (program, behind, paused, self-paced, new self-paced, alumni) keep their learning/access behavior and never receive staff links/data; instructors cannot access unassigned cohorts | passed |
| S09 | Relevant native staff screen parity and regression checks; native simulator UI explicitly reported separately | passed automated gate; native device UI not_run |

## Automated verification

Focused API tests: 11 tests / 69 assertions passed on the dedicated local DB, including shared latest-review selection, authorized enrollment scope, completed media, retained evidence, communication privacy and query scaling. Focused web regression set: 128 tests passed; the final route/glossary contract subset passed 130 tests. Local typecheck/lint passed; advisory Impeccable scan returned `[]`. Full API coverage suite and heavy web/mobile gates run on ASUS with the repository root. Focused regressions may run locally. Every changed/new endpoint gets a QueryCounter scaling regression. No migration was added. Both the pre-integration and final integrated ASUS gates passed. The final integrated API gate passed 1,866 tests / 40,628 assertions with zero failures, errors or skips.

## Resources

Lifecycle session `01a1e659-599d-7900-a738-28b86fc1080a`; baseline audit recorded. Shared PostgreSQL, Redis, existing listeners, tabs and simulators are borrowed. QA uses owned local databases and synthetic people. The default synthetic curriculum is supplemented by the canonical production-authored prework JSON already tracked in the repo; no new private curriculum, student data or credentials enter Git.

Focused API tests own database `csg_student_workspace_test_0117`, created on the borrowed local PostgreSQL service. `dev-lifecycle` has no database resource kind; ownership and exact drop target are recorded here. The shared PostgreSQL process remains borrowed.


## Execution notes

The shared T3 preview browser passed the 26-check profile walkthrough as admin at 1280/390 in light/dark and as instructor at 1280/light and 390/light/dark. Two longer evaluations returned `Preview automation evaluate timed out after 15000ms.`; the remaining matrix moved to the harness’s bundled Chromium with one worker. A test locator initially selected a Learning-tab lesson while the milestone panel was still loading; it correctly opened the admin editor. The locator now scopes the milestone section. A module Back-label assertion now accepts the path-derived “Cohort” label as well as “QA Program” when a synthetic `qa_user` query makes the explicit return URL differ from router state. These were test-driver corrections; the exact destinations are still asserted.

The first complete batch used database `csg_qa_66046_1794867511`, loopback API 58072 and Vite 58073, owned PIDs 66546/66626; all were cleaned after that batch. The earlier exploratory database and servers were cleaned before the fresh run. The browser spec claims/releases each test page; the root runner process owns its child Chromium processes.

QueryCounter (one to five records): profile 39→39, cohort detail/module progress 31→31, Communication 11→11, Learning insights 27→27. The tests warm authentication before measuring and count query-cache hits.

## Browser results

The final default matrix passed **56 distinct scenarios**: 48 profile/action/module/student-boundary scenarios and eight behind-student/help-request scenarios. Admin and instructor each ran at 1280×844 and 390×844 in light and dark; all six student personas ran both widths/themes. Eight profile journeys passed again after the final “Class chat activity” copy change. Screenshots: [desktop/light](student-workspace-2026-11-17/profile-1280-light.png), [phone/dark](student-workspace-2026-11-17/profile-390-dark.png). Both were visually inspected. The phone full-page screenshot includes the viewport-fixed staff navigation; controls remain reachable during actual scrolling.

Actions were performed through the UI, including saving and reopening the exact follow-up plan, Message, server-selected Grade next, every Overview metric, milestone/lesson/module links, filtered roster, direct-message/class-chat/meeting links, Support queue, enrollment switching, selected-student preview Continue/module/lesson/Back, and help-request Back. Persisted follow-up enrollment, owner and summary were checked against the API. Preview anchors carry the selected student before a click; no duplicate-key console warning occurred. The original duplicate-key report could not be reproduced on the base, so it is covered by this console regression check rather than claimed as a separately reproduced fix.

Section failure/retry, draft retention, stale responses, retained submission history and unauthorized enrollment filtering also have focused component/API regressions. These fault cases were not all repeated as browser network-fault scenarios. The browser student-boundary checks assert staff API rejection and the shared No access page; instructors' unassigned-cohort rejection is also covered by API tests.

The additional canonical course batch passed **8 scenarios** (48 enrollment-profile/preview checks inside those scenarios): admin and instructor × light/dark × 1280/390, each traversing all six personas. It imports the existing production export (127 lessons / 189 blocks) into owned database `csg_qa_5786_1794869276`, using synthetic enrollments for all six personas. API PID 6808 on 61475 and Vite PID 10081 on 61476 were owned and claimed, then stopped; the exact owned database was dropped after the pass. This is local production-authored content coverage, not production delivery or data validation.

## Gate corrections and limits

The first full ASUS run exposed three migration-process fixture errors caused by its hard-coded PostgreSQL port, stale route-contract expectations, preview locked-name scanner coverage, native glossary expectations and a native redo-list variable removed while moving counts to shared status. These were corrected; the migration subprocess fixture now accepts a loopback-only test URL. Its three focused subprocess tests / 36 assertions pass locally. The ASUS copy excludes `.git`, so the gate script creates a disposable brand-asset index before Vite's tracked-asset build. No application database policy or deployment configuration changed.

Native simulator/physical-device interaction was not run. Native parity is limited to the existing staff student screen: shared counts/reasons/next-review, enrollment links, retained work and authenticated web follow-up handoff. A native Communication workspace and module cards do not exist today and remain follow-ups. Safari, software keyboards, real provider delivery/media, production deployment and current mobile distribution were not tested.

The first integrated application source was implementation commit `bf16d1f3244e184580b26246f531ce791c355af9`, based on `ac28c0b90535295ef5540e89a578bee36f97a43a`. The rebase combined both OpenAPI additions without semantic conflicts and regenerated both clients. Subsequent changes are QA scenarios, screenshots and this record. No deployment occurred.

Browser totals: **64 distinct scenarios passed**, with eight additional copy-change retests. The canonical batch exercises production-authored lesson content; synthetic status/work/message/meeting fixtures still establish the exact action and return-path checks. Each browser suite uses one worker. Local full-page evidence and Playwright traces/results remain under ignored `.qa-local/`; no real answer keys or additional production exports were added.

Reproduction commands and the optional canonical-content pass are documented in `scripts/qa/README.md`. `DEV_LIFECYCLE_SESSION` must name the current owner session. The full cross-stack ASUS gate is reproducible with `asus-test --postgres csg_learning_platform_test <repo-root> -- bash scripts/qa/student-workspace-gate.sh`; a busy runner exits 75 and must be retried without starting a concurrent run.

## Grading-workbench integration retest (before Updates merge)

After PR #281 merged, the application was rebased onto current main. Web typecheck and 159 focused tests passed on the combination. The complete standard browser matrix passed again: **56 scenarios** in 3.1 minutes. The canonical course batch then passed **8 scenarios** in 1.5 minutes, traversing all six enrollments per scenario. Updated desktop/light and phone/dark evidence above comes from this integrated run and was visually inspected.

A further **8 scenarios** passed at both widths/themes as admin/instructor: keyboard Tab reaches Grade next with `:focus-visible`, reduced-motion preference keeps controls usable, Keep editing preserves a follow-up draft, a simulated POST 503 preserves the draft and displays the error, Discard clears it, and reopening starts empty. The first driver used an exact label lookup that stopped matching after the controlled textarea acquired content; the failure snapshot still showed the retained draft. Switching to the textbox’s accessible name passed all eight cases. No product change was needed.

Final browser acceptance: **72 distinct scenarios passed** on the integrated application. Earlier passes and copy retests are history, not additional unique cases. Section-level communication failure/retry and stale responses also retain component coverage; Safari, native hardware and actual providers remain outside this run.

Final harness ownership: database `csg_qa_93866_1794872350`, API PID 94015 / port 56674, Vite PID 94054 / port 56675. Each page and runner was claimed/released; both servers were stopped and this database dropped after the final browser phase. All earlier named QA/focused-test databases were also dropped. The full gate owns only its ASUS wrapper and the helper’s disposable `asus-test-postgres` container/database; the helper removes that container and shuts down its WSL runner at completion. Shared local PostgreSQL/Redis, borrowed tabs and simulators were left running.

## Prior full gate (before Updates merge)

`asus-test --postgres csg_learning_platform_test <this repo root> -- bash scripts/qa/student-workspace-gate.sh` completed with **0 failed stages** on the integrated application source `bf16d1f3`. ASUS runs the suite serially using a disposable PostgreSQL 16 container. Its source copy matched the task files; ignored local QA data and credentials were excluded.

| Gate | Result |
| --- | --- |
| API, `OPENAPI_COVERAGE=1`, one worker | 1,866 tests / 40,628 assertions; 0 failures, errors or skips |
| RuboCop / Brakeman | passed; no offenses / 0 security warnings |
| Web typecheck / ESLint | passed |
| Web Vitest | 2,380 tests / 204 files passed |
| Web production build / post-build bundle checks / `api:check` | passed |
| Mobile typecheck / ESLint | passed |
| Mobile Jest | 1,422 tests / 136 suites passed |
| Focused integrated web regressions | 159 tests / 7 files passed |
| Impeccable 4.6 advisory on changed UI | `[]` |

The final full gate's wrapper PID 93850 was claimed and released. Its helper removed the exact disposable PostgreSQL container and terminated the task runner's WSL instance. All owned local servers, browser pages, runner processes and QA/focused-test databases were cleaned. No simulator or emulator was started. The branch/worktree is intentionally retained for the lead's PR review. Production deployment and native device interaction remain not_run; there is no runtime handoff.

## Amended brief: explicit main merge and queue links

PR #284 was already open when the brief was amended; it remains held without monitoring or merging. `origin/main` was fetched and explicitly merged as `ec05651b`, including #281 grading (`ac28c0b9`) and #279 Updates (`c62eb42a`). The conflict kept both the Updates return-path behavior and student lesson/module return paths. The merged OpenAPI regenerated both clients. This task adds **no migrations**, including none competing with main’s `20261117010000` / `20261117020000` or open #283’s `20261117090000`.

Current application source: **`7fad45b6cf71a640cfbb6e140110f91e901e17fa`**. Grade next now goes to `/admin/grading` with `student_id`, `cohort_id`, `submission` from shared status and a safe `return_to`. The workbench exposes Previous/Next and a guarded Back to the exact student tab/filter. Native Grade next opens the same authenticated web queue; the native staff screen is otherwise unchanged from this task’s earlier parity work.

Post-merge focused verification: web typecheck and **142 tests / 3 files passed**, including queue scope, shared selected review, and refusing a Back navigation while feedback is unsaved. The fresh standard browser matrix passed **64 scenarios** in 3.3 minutes, including actual queue Previous/Next and exact profile return at all staff widths/themes. The canonical-course batch passed all 8 scenarios in 1.5 minutes. **All 72 browser scenarios passed again on `7fad45b6`**, including filtered Grade next, actual Previous/Next, guarded Back, all role/viewport/theme cases and the 127-lesson course. The complete post-merge ASUS gate passed: API 1,897 tests / 40,901 assertions with no failures, errors or skips; RuboCop and Brakeman; web typecheck, lint, 2,405 Vitest tests / 205 files, build, bundle checks and `api:check`; mobile typecheck, lint and 1,430 Jest tests / 136 suites. The gate reported 0 failed stages. The refreshed Impeccable scan of the new queue-link UI returned `[]`.

Current harness ownership: database `csg_qa_51640_1794874027`, API PID 52038 / port 59401, Vite PID 52055 / port 59402. Full-gate wrapper PID 51508 is claimed. Both servers and all browser pages/runners were stopped/released, and the exact harness database was dropped after the browser phase. The full-gate wrapper was also released after success; its disposable PostgreSQL container/database was removed and the runner WSL instance terminated by `asus-test`. No owned runtime resource remains.

Review-fix focused API database: `csg_student_workspace_review_test_0117`, owned by this task on the borrowed local PostgreSQL service. It was dropped after the focused phase. No local database resource kind exists in dev-lifecycle, so this exact identity is recorded here.


## Existing-review fixes

The existing CodeRabbit review was read once after the PR snapshot showed changes requested. The following findings were verified against the code and addressed; no new review cycle is being awaited.

- Module assignment/access counters now exclude archived users consistently with the shared module projection.
- Communication excludes blocked authors in both directions using the established user-block rule; the viewer’s own replies remain visible. Both-direction regressions pass. The extra block lookups keep the query count flat at **13→13** (profile 39→39, cohort detail 31→31, insights 27→27 remain unchanged).
- All introduced fixed response objects are closed. Student progress, cohort detail and learning insights now describe the complete successful serializer payloads, with guaranteed keys required. Settings and legacy settings collections remain explicitly arbitrary metadata. Both generated clients were regenerated. Real-response contract tests reject extra record fields and missing cohort identity/roster keys.
- Follow-up completion after switching students no longer navigates to the previous student’s plan. Module Back uses restoration state rather than generating a new origin. Meeting cohort switches preserve the profile return query and state, while removing stale booking/week selection.
- Page claim/release failures now fail QA with command diagnostics. Five Node regressions cover unsuccessful, missing, terminated and successful ownership commands.

Red/green verification temporarily restored the earlier API/UI implementations and unchecked ownership behavior, then restored all fixed files byte-for-byte. The new checks produced **3 API failures**, **3 web failures** and **4 ownership failures** under that old behavior. Fixed focused checks passed: **13 API tests / 102 assertions**, web typecheck and **44 web tests**, plus **5 ownership tests**. The review-fix full ASUS gate passed on `a2a089dd`: API 1,899 tests / 40,934 assertions; web 2,408 tests / 205 files; mobile 1,430 tests / 136 suites; all required static, security, build, bundle and schema checks; five ownership tests. The standard browser rerun first passed 60/64, then 63/64 after driver corrections: allow cold profile loads, assert the live plan textbox rather than an inert exit copy, and wait for the lesson heading before using its Back link. All eight module-card scenarios then passed, covering the last failing case. These were driver issues, with traces confirming settled product behavior. The canonical rerun was interrupted when main advanced; it is superseded by the final merged-source run below.


## Final main integration: #282 and #285

The final fetch found main at `3ec803d79375b7c7cfef8f7c7cdffb843b7dcd03`. It was explicitly merged as **`08e33607`**. The merge retains the searchable learning-plan editor, replies and instructor meeting controls, while preserving lesson learner destinations, phone targets, media summaries and profile return paths. Milestones show their planned lesson count and server-provided lesson status badges; no milestone completion total is recomputed in the browser. OpenAPI was merged structurally from the common base and both generated clients were regenerated. No task migration was added.

Focused integration checks passed: web typecheck and 54 tests / four files. The changed plan/meeting UI advisory Impeccable scan returned `[]`. An initial browser run started before the workspace-specific fixture additions were applied and found only one waiting queue item; that incomplete run was stopped, the synthetic additions applied, and the full matrix restarted. The earlier canonical run was interrupted during integration and contributes no final acceptance count.

Final ownership: database `csg_qa_50830_1794879514`; API PID 52103 / port 60784; Vite PID 52158 / port 60785; full ASUS wrapper PID 52196. The prior review-fix database `csg_qa_7904_1794877512` and servers 16288/16818 were cleaned before this fresh phase. The interrupted Chromium process trees were stopped and their exact page/runner claims released. The prior ASUS wrapper 7880 was released after its successful gate. Shared services and borrowed devices remain untouched.


The complete final-main ASUS gate passed on `08e336070af5d192408f002cc10bfcfe1d0ded6a`: **1,931 API tests / 41,170 assertions**, no failures/errors/skips with `OPENAPI_COVERAGE=1`; RuboCop and Brakeman; web typecheck, lint, **2,437 Vitest tests / 209 files**, build, post-build bundle checks and `api:check`; mobile typecheck, lint and **1,432 Jest tests / 136 suites**; five ownership tests. The gate exited normally with **0 failed stages**. Jest reported a delayed-exit warning after passing, then exited 0 without a forced exit.

The seeded standard browser matrix passed 62/64 initially. One profile driver raced the Overview route against the still-rendered Learning tab; waiting for the selected navigation link resolved it. The other failure was the checked ownership helper reporting a missing page record during concurrent lifecycle ledger updates; the product assertions passed, and lifecycle calls were serialized for the retest. Both exact phone/dark cases passed again, completing **64 distinct standard scenarios** on the final merged source. The task runner also reported its lost ownership record; its process tree had exited, and remaining server ownership was rechecked. This ledger race is a local tooling limitation, not silently treated as accepted ownership. Current screenshots were refreshed from the settled final-source runs.


The final canonical batch passed **all eight scenarios** in 2.1 minutes, traversing six enrollment profiles each with 127 production-authored lessons / 189 blocks. **All 72 distinct required browser scenarios are accepted on `08e33607`** after the final main merge; repeated retests do not increase that count. Desktop/light and phone/dark evidence was refreshed. An additional settled-header bounds check at 1280/390 confirmed all rendered header controls stayed inside the viewport.

Cleanup completed: servers 52103/52158 stopped, exact database `csg_qa_50830_1794879514` dropped, all page/runner claims released, and the ASUS wrapper 52196 released after its helper removed the disposable PostgreSQL container/database and stopped WSL. A stale page claim left by the ledger race was released only after verifying that its passing case had closed the page and the exact worker had exited. `dev-lifecycle cleanup` and `status` report no active owned resources. SQL confirmed all named task databases are absent, including both focused-test databases. No simulator/emulator was started, no shared service was stopped, and no runtime handoff remains. The held branch/worktree is retained for lead review.


## Independent-review fix round (head 9b0744ca)

Scope refreshed from the independent Opus review and the requested P2/P3 list. Working tree was clean before fetching and merging main `aa0cf1b4` as `f4964b89`. Both clients were regenerated. Application fix source: `6e958c08`. No migrations. This round requires agreement between each card and its server list, hidden previews and safe destinations for blocked Communication, full-list links, lesson-based module progress, accurate preview exits, both API prepared-statement modes, and headless acceptance at 1280/390 in both themes as admin/instructor.

Owned focused database: `csg_student_workspace_fix_test_0117`. Owned QA database: `csg_qa_18358_1794882765`, API 18446 / port 55325, Vite 18464 / port 55326. The ASUS wrapper is 13633; it waits while the single runner is busy. These are task-owned deltas on the borrowed shared PostgreSQL service. No native device or additional provider resource is started. Cleanup is pending this verification phase.

Red/green evidence: three assignment variants reproduced the lesson-video discrepancy; draft recordings, blocked-row removal and mixed block/lesson percentages failed against the old implementation. After correcting test fixtures to honor HelpRequest validation/uniqueness, both scoped-list tests failed on the old controllers/projection (extra student's request and DM). Eight targeted web assertions failed on old UI/hook implementations and passed after byte-for-byte restoration of the fixes. Focused green: 51 API tests / 438 assertions; 116 web tests plus the isolated eight red/green assertions; web typecheck. Profile query count is 41→41 after adding the shared block permission, cohort detail 31→31, Communication 16→16 after attachment/channel preloads. The requested full verification and browser results follow below.


Browser fix acceptance: **16/16 passed** in 2.9 minutes on bundled Chromium, one worker, admin and instructor at 1280×844 and 390×844 in light/dark. Each media case traversed three synthetic enrollment variants (unassigned module, personal plan, lesson-only), clicked both media cards and checked visible row/done counts against the card's server summary. It also clicked waiting-work and open-support cards, checked the actual filtered response totals/student scope, and verified the destination screens. Communication retained “Message hidden” for blocked DM/channel bodies, disabled both unavailable compose actions, removed blocked DM links, opened permitted channel history, and clicked the full Messages, meetings and channel destinations with cohort/student filters. No 403 occurred along those journeys. The two block directions use admin→student and student→instructor fixtures. The original full 72-scenario matrix was not repeated this round; the required changed journeys were.

The fix-round focused DB was dropped after its phase. QA servers 18446/18464 were stopped, the exact QA DB `csg_qa_18358_1794882765` was dropped, and all browser/runner claims were released after the browser matrix. ASUS wrapper 13633 remains owned until its gate completes. Impeccable 4.6 advisory on the changed Communication/profile/preview UI returned `[]`. Native device UI, Safari and real media/provider delivery remain not_run.


The first fix-round ASUS default API run reported one failure in the unchanged main weekly-plan fixture: a resubmission still appeared as the next redo lesson (1,951 tests, no errors). It did not reproduce in the isolated 12-test file with that seed. The fixture used implicit wall-clock timestamps for attempts while its logical calendar is 2030. The fixture now gives the first and revised attempts explicit chronological timestamps and asserts that the revision is the shared latest attempt. This removes that timing assumption without changing application logic or disabling prepared statements. Focused retests passed all 12 tests / 76 assertions in both modes. Both full API modes will be repeated on ASUS; this is a fixture correction, not a claim that clock adjustment was proven as the original cause. The second focused DB `csg_student_workspace_fix_gate_test_0117` was dropped after the focused phase.


The first combined run also caught the sentence-case contract rejecting the new preview label’s capitalized “Overview.” Both preview exits now read “Back to student overview”; the naming and preview subset passed 17 tests. The other 2,450 web tests, build, bundle check and `api:check` passed in that run. Mobile typecheck/lint and all 1,508 tests / 139 suites passed; Jest is allowed to exit normally after its delayed-exit warning. The full gate will be repeated after the fixture and copy corrections; the earlier failed stages are preserved here rather than presented as a pass.


All seven original CodeRabbit threads were answered with their fixing commits and resolved via `resolveReviewThread`. The underlying review was not dismissed. The existing fixes are in `1e43ae0d`; the blocked-preview behavior was refined in `6e958c08`. Replies link those immutable commits.

Before the final repeat, two focused Communication edge assertions also failed: direct-message compose was enabled while its permission request was pending, and an unrelated realtime DM could enter a student-filtered directory. Commit `26a083ea` waits for permission and rejects realtime summaries outside the requested student/cohort. Both regressions and the complete 39-test Communication/navigation subset passed; typecheck passed. No API schema changed after its regeneration in `6e958c08`. The final complete gate is queued as owned wrapper 53994. A fresh affected-flow retest uses QA DB `csg_qa_54031_1794884181`, API 54173 / port 65342 and Vite 54212 / port 65343, all claimed. It repeats the eight Communication role/viewport/theme journeys and adds the accurately labelled preview exit.


The affected Communication retest passed **8/8** on `26a083ea` in 1.1 minutes at all four width/theme combinations for admin/instructor. The same journeys now also click “Back to student overview” from preview and verify the exact student Overview destination. There were no 403 responses. These are repeated cases, not eight extra distinct acceptance scenarios. Servers 54173/54212 were stopped, QA database `csg_qa_54031_1794884181` dropped, and each page/runner released. The only remaining owned resource is the queued ASUS wrapper 53994. Both focused databases have been dropped.
