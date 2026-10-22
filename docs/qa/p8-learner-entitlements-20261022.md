# P8 learner entitlements and recovery

2026-10-22. Implementation worker, agent-executed affected-flow QA. Branch `fix/p8-learner-entitlements`; PR #202 is held for the lead. Initial base `83f92a7` was newer than the required `dc86257`. Core QA code `32dd84d`, with the final native follow-ups through this PR, includes main `b5f207f` (P7/P9). No migration or dependency changes.

CSG Learn serves phone-heavy Code School of Guam learners and a small teaching team. Learners need actions that match their enrollment, contextual instructor support, durable drafts and useful recovery. Sources: audit WORKER_BRIEF.md/PLAN.md and verify-student.md S5/S9/S10/N-S2/N-S3/N-S4/N-S6; repository PRODUCT_VISION.md; current enrollment, help, weekly-plan and client code. Brain-Dump code-school/_overview.md supplies historical context; the newer lead decisions govern this pilot. API/web use Render/Netlify, with Clerk authentication and PostgreSQL learning records. Expo SDK 57 documentation was read as mobile/AGENTS.md requires.

## Acceptance and changes

- **S5:** Lesson/dashboard/weekly-plan payloads expose enrollment capabilities, support mode, assigned instructor, and access/support deadlines. Guided requests remain contextual. Eligible self-paced questions open an unsent assigned-instructor DM draft with exact lesson/exercise/recording context and preserve existing text. Expired support shows its end date and account support; previous responses remain readable. Closed cohorts, unavailable instructors/workspaces and blocked relationships do not advertise a writable instructor DM.
- **S9:** Past courses say “Past course · review only.” Content, submitted work and feedback remain readable; submission, manual completion, retrieval and video progress writes are disabled. Playback remains available. P7 already implemented the lead's completed-course ZIP decision; integration preserved its authorization and deadline tests.
- **S10:** Self-paced Today identifies the course, next lesson, dates, support action and redos. Alumni keep their library. Native retains the overview when no lessons are assigned and retains redo fallback when the plan has none.
- **N-S2:** Native stores every submission field in version-2 drafts, migrates existing text drafts, isolates user/cohort keys, labels local work as not submitted, supports restore/discard, clears on success/sign-out, and protects edits during submission and later reversion to submitted values.
- **N-S3:** Lesson/Profile failures render retry controls, distinguish unavailable/session/service/connection failures, preserve course context, and identify cached lessons as read-only. Profile retry preserves unrelated preferences and edited identity fields.
- **N-S4:** Web help matches cohort, context type, source and ID; superseded loads/actions cannot change another context.
- **N-S6:** The recordings list generation guard already existed on this base. Added late-success/late-failure regressions and guarded delayed watch-progress responses.

Messages.tsx and native conversation/thread screens are unchanged. Existing composer storage and routes supply the question handoff. No sales activation or production repair.

## Executed QA

Runtime used owned `csg_p8_learner_entitlements_dev`, Rails test configuration on 3618 and Vite on 5618. Synthetic learner 1, instructor 2, lesson 1, exercise 2, video 3; guided/self-paced/support-ended/completed cohorts 1/2/3/4. Actual production components called actual Rails endpoints. A temporary identity adapter replaced Clerk and a synthetic three-second local video replaced hosted stream transport. This proves player/write behavior, not live Clerk or S3 delivery. No external message, email, push, payment or production mutation was sent.

| Case | Expected and observed result | 1280x800 | 390x844 |
| --- | --- | --- | --- |
| A1 guided help | Prior response readable; create request from lesson; exact cohort 1/type lesson/id 1 and message verified in DB; saved request visible on return. | passed | passed (saved request/history) |
| A2 self-paced | Course name/next lesson/access/support dates/redo visible. Question opens instructor DM; existing unsent text and exact lesson context survive in composer and local storage. Paragraph normalization does not append the same context twice. | passed | passed |
| A3 expired support | Correct Oct 20 end date/account-support link, no question/request entry, prior response readable without send/cancel controls. | passed | passed |
| A4 past course | Submitted code/feedback remain readable; no submit/complete affordances. Three-second video reaches ended with zero learning/progress writes. | passed | passed |
| A5 load recovery | Simulated connection failure shows useful Lesson/Profile retry; retry restores actual data. Lesson retains cohort 1 return URL. | passed | passed |
| A6 recordings race | Delay A, open B, let A finish: only B's recording remains selected. | passed | passed |

Six browser cases accepted; no failed/blocked browser cases remain. Native installed-device, keyboard/gesture and provider delivery dimensions are **not_run**: no simulator was assigned. Native component/storage tests cover read-only renderers, hosted/linked tracking props, support entry/history, course plans/redos, complete drafts/migration/isolation/failure/success/sign-out. Forbidden/cache recovery, colliding help identities, and late recordings failures also have automated regressions.

Evidence: `.codex/p8-qa/results.json` contains semantic observations; task fixture scripts/logs are retained locally. Desktop past-course screenshot `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mvj017ol-a93d7b45.png`; narrow past-course screenshot `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mvj061ij-ffac41bd.png`. Visual inspection found no horizontal overflow on tested flows. Narrow screenshots are browser emulation, not native hardware.

## Gates and review

Ruby 3.3.7 / Node 22.22.3. Clean npm ci completed for both clients, with no lockfile changes.

- API: 913 tests / 5,549 assertions, no failures/errors/skips; RuboCop 478 files clean; Brakeman zero warnings (existing ignore retained); bundler-audit clean.
- Web: full npm run check passed, 98 files / 579 tests; lint/types/platform/service-worker/build/bundle checks passed.
- Native: full npm run check passed, 106 suites / 715 tests; brand/types/lint passed with 22 pre-existing warnings.
- Impeccable advisory returned `[]` for changed web/native UI. Static advice does not replace runtime acceptance.
- Independent native review found and verified fixes for two submission-draft races and the question-draft sign-out race. Independent API/web review found and verified the closed-cohort support mismatch. No remaining material API/web findings on `32dd84d`; final native follow-up verified the last generation guard and its regression after `b97d1b7`.
- CodeRabbit reported its free review limit reached; its success-labelled check is **not a completed review**. No CodeRabbit findings were available to address. Required CI/review state is separate from the local gate and must be rechecked by the lead before merge.

Initial integration failures were stale test mocks for Recordings' capability fetch and stale assertions after hiding past-course controls. Both were corrected and full gates passed. Rebases retained P7 ZIP semantics and P9's attention type field. No deployment or installed native release was performed; API and clients should ship together. Older/cached web capability payloads fail closed.

Lifecycle session `01a1619e-6dbd-7d12-874b-7f730571f751`: task browser closed, API/Vite processes stopped, temporary public video removed; no active owned resources. Task-created `api_test_p8_learner_entitlements`, `_0`, `_1`, and `csg_p8_learner_entitlements_dev` were dropped and their absence verified. Shared services and borrowed simulator remain untouched. Branch/worktree remain for lead integration.
