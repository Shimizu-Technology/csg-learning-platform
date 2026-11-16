# Student workspace — W7 PR 7.5

## Context and acceptance

Implementation worker, 2026-11-17. Isolated worktree `t3-0b20b940-41485f063e89d167`, branch `feat/student-workspace`, base `51b0d7ce` (PR #280). Hold for the lead: open a PR; do not merge or watch.

CSG Learn serves Code School of Guam students and their instructors across live programs, guided and self-paced courses, and the alumni library. This change helps staff review one learner in one enrollment, act on the reasons that need attention, follow linked learning/work/support, and inspect a read-only student view without leaving preview. Clerk, Rails, React/Vite, and Expo remain the existing authentication and delivery stack. Deployment is Render API / Netlify web / Neon; no production changes are authorized or needed.

Sources: `docs/PRODUCT_VISION.md`, `docs/design/2026-11-platform-redesign/README.md` §§2, 4.2–4.4, 5–6; approved `06-student-workspace.html`; Brain Dump `code-school/csg-learn-platform-audit-2026-11-14.md`; current `LearnerProgress`, `AttentionProjection`, record-route registry, and the local QA harness. Some lesson/module record links are already present on the base and need retained regression coverage.

Design: preserve Manrope, semantic light/dark tokens, quiet operational controls, 44px phone targets, explicit Back destinations, copyable record links, and recoverable section errors. Existing disclosures change immediately; navigation and tab changes add no delay or new animation. Reduced motion keeps content and controls available.

Agent-executed affected-flow QA, required at 1280px and 390px in light and dark. Native parity covers the existing staff student screen; new native workspace/preview screens are out of scope. Browser resizing establishes responsive web behavior only. External delivery, Clerk, real meetings/media, Safari and physical native devices are excluded from local synthetic QA.

| Case | Required behavior and starting fixture | Status |
| --- | --- | --- |
| S01 | Admin and instructor open program/behind profiles; Message opens exact conversation, Grade next selects the server's next review, Start follow-up saves and opens the plan; Why flagged matches shared status | passed |
| S02 | Every profile metric opens its explaining tab/section; lesson, module, milestone and related links preserve enrollment and Back destination, including new-tab URL context | passed |
| S03 | Switch between two authorized enrollments; preserve selected tab and origin; hide inaccessible cohorts; changing student/cohort cannot display stale responses or discard a draft silently | passed |
| S04 | Communication shows recent permitted direct messages, student channel activity and permitted meetings; exact links and Back context work; empty/failure/retry states are distinct | passed |
| S05 | Support links retain cohort, have 44px phone targets, and return correctly | passed |
| S06 | Cohort module cards expose Grade, Lessons, shared progress and an assigned-student filter; insights/objective names open exact records and return | passed |
| S07 | Preview Today Continue, next task, lesson/module links and lesson Back remain in selected enrollment preview; read-only content, dark theme, no duplicate keys, one header entry point | passed |
| S08 | Six student personas (program, behind, paused, self-paced, new self-paced, alumni) keep their learning/access behavior and never receive staff links/data; instructors cannot access unassigned cohorts | passed |
| S09 | Relevant native staff screen parity and regression checks; native simulator UI explicitly reported separately | automated gate pending; native device UI not_run |

## Automated verification

Focused API tests: 11 tests / 69 assertions passed on the dedicated local DB, including shared latest-review selection, authorized enrollment scope, completed media, retained evidence, communication privacy and query scaling. Focused web regression set: 128 tests passed; the final route/glossary contract subset passed 130 tests. Local typecheck/lint passed; advisory Impeccable scan returned `[]`. Full API coverage suite and heavy web/mobile gates run on ASUS with the repository root. Focused regressions may run locally. Every changed/new endpoint gets a QueryCounter scaling regression. No migration was added. Full gate round 2 is pending on the busy ASUS runner.

## Resources

Lifecycle session `01a1e659-599d-7900-a738-28b86fc1080a`; baseline audit recorded. Shared PostgreSQL, Redis, existing listeners, tabs and simulators are borrowed. QA uses owned local databases and synthetic people. The default synthetic curriculum is supplemented by the canonical production-authored prework JSON already tracked in the repo; no new private curriculum, student data or credentials enter Git.

Focused API tests own database `csg_student_workspace_test_0117`, created on the borrowed local PostgreSQL service. `dev-lifecycle` has no database resource kind; ownership and exact drop target are recorded here. The shared PostgreSQL process remains borrowed.


## Execution notes

The shared T3 preview browser passed the 26-check profile walkthrough as admin at 1280/390 in light/dark and as instructor at 1280/light and 390/light/dark. Two longer evaluations returned `Preview automation evaluate timed out after 15000ms.`; the remaining matrix moved to the harness’s bundled Chromium with one worker. A test locator initially selected a Learning-tab lesson while the milestone panel was still loading; it correctly opened the admin editor. The locator now scopes the milestone section. A module Back-label assertion now accepts the path-derived “Cohort” label as well as “QA Program” when a synthetic `qa_user` query makes the explicit return URL differ from router state. These were test-driver corrections; the exact destinations are still asserted.

Final batch uses database `csg_qa_66046_1794867511`, loopback API 58072 and Vite 58073, owned PIDs 66546/66626. The earlier exploratory database and servers were cleaned before the fresh run. The browser spec claims/releases each test page; the root runner process owns its child Chromium processes.

QueryCounter (one to five records): profile 39→39, cohort detail/module progress 31→31, Communication 11→11, Learning insights 27→27. The tests warm authentication before measuring and count query-cache hits.

## Browser results

The final default matrix passed **56 distinct scenarios**: 48 profile/action/module/student-boundary scenarios and eight behind-student/help-request scenarios. Admin and instructor each ran at 1280×844 and 390×844 in light and dark; all six student personas ran both widths/themes. Eight profile journeys passed again after the final “Class chat activity” copy change. Screenshots: [desktop/light](student-workspace-2026-11-17/profile-1280-light.png), [phone/dark](student-workspace-2026-11-17/profile-390-dark.png). Both were visually inspected. The phone full-page screenshot includes the viewport-fixed staff navigation; controls remain reachable during actual scrolling.

Actions were performed through the UI, including saving and reopening the exact follow-up plan, Message, server-selected Grade next, every Overview metric, milestone/lesson/module links, filtered roster, direct-message/class-chat/meeting links, Support queue, enrollment switching, selected-student preview Continue/module/lesson/Back, and help-request Back. Persisted follow-up enrollment, owner and summary were checked against the API. Preview anchors carry the selected student before a click; no duplicate-key console warning occurred. The original duplicate-key report could not be reproduced on the base, so it is covered by this console regression check rather than claimed as a separately reproduced fix.

Section failure/retry, draft retention, stale responses, retained submission history and unauthorized enrollment filtering also have focused component/API regressions. These fault cases were not all repeated as browser network-fault scenarios. The browser student-boundary checks assert staff API rejection and the shared No access page; instructors' unassigned-cohort rejection is also covered by API tests.

The additional canonical course batch passed **8 scenarios** (48 enrollment-profile/preview checks inside those scenarios): admin and instructor × light/dark × 1280/390, each traversing all six personas. It imports the existing production export (127 lessons / 189 blocks) into owned database `csg_qa_5786_1794869276`, using synthetic enrollments for all six personas. API PID 6808 on 61475 and Vite PID 10081 on 61476 were owned and claimed, then stopped; the exact owned database was dropped after the pass. This is local production-authored content coverage, not production delivery or data validation.

## Gate corrections and limits

The first full ASUS run exposed three migration-process fixture errors caused by its hard-coded PostgreSQL port, stale route-contract expectations, preview locked-name scanner coverage, native glossary expectations and a native redo-list variable removed while moving counts to shared status. These were corrected; the migration subprocess fixture now accepts a loopback-only test URL. Its three focused subprocess tests / 36 assertions pass locally. The ASUS copy excludes `.git`, so the gate script creates a disposable brand-asset index before Vite's tracked-asset build. No application database policy or deployment configuration changed.

Native simulator/physical-device interaction was not run. Native parity is limited to the existing staff student screen: shared counts/reasons/next-review, enrollment links, retained work and authenticated web follow-up handoff. A native Communication workspace and module cards do not exist today and remain follow-ups. Safari, software keyboards, real provider delivery/media, production deployment and current mobile distribution were not tested.

The implementation source was tested on branch `feat/student-workspace` based on `51b0d7ce`; final commit and complete gate results will be recorded below. No rebase or deployment has occurred.

Browser totals: **64 distinct scenarios passed**, with eight additional copy-change retests. The canonical batch exercises production-authored lesson content; synthetic status/work/message/meeting fixtures still establish the exact action and return-path checks. Browser work ran serially. Local full-page evidence and Playwright traces/results remain under ignored `.qa-local/`; no real answer keys or additional production exports were added.

Reproduction commands and the optional canonical-content pass are documented in `scripts/qa/README.md`. `DEV_LIFECYCLE_SESSION` must name the current owner session. The full cross-stack ASUS gate is reproducible with `asus-test --postgres csg_learning_platform_test <repo-root> -- bash scripts/qa/student-workspace-gate.sh`; a busy runner exits 75 and must be retried without starting a concurrent run.
