# Student workspace — W7 PR 7.5

Current result: **full post-merge gate passed; 72 browser scenarios passed**. Application source `7fad45b6cf71a640cfbb6e140110f91e901e17fa`, with current main (`c62eb42a`) explicitly merged as `ec05651b`. Grade next opens the filtered paged workbench and supports Previous/Next plus a guarded return to the exact profile context. All owned resources and test databases are cleaned. PR #284 is held for lead review; native device interaction and production delivery remain not_run. Earlier runs below are historical evidence; the amended-brief section records the current acceptance.

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
