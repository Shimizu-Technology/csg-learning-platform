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

Initial integration failures were stale test mocks for Recordings' capability fetch and stale assertions after hiding past-course controls. Both were corrected and full gates passed. Rebases retained P7 ZIP semantics and P9's attention type field. No deployment or installed native release was performed. The review-fix round below preserves installed-client compatibility; older/cached capability payloads fail closed in updated clients.

Lifecycle session `01a1619e-6dbd-7d12-874b-7f730571f751`: task browser closed, API/Vite processes stopped, temporary public video removed; no active owned resources. Task-created `api_test_p8_learner_entitlements`, `_0`, `_1`, and `csg_p8_learner_entitlements_dev` were dropped and their absence verified. Shared services and borrowed simulator remain untouched. Branch/worktree remain for lead integration.

## Review-fix round: installed clients, cache hydration and recording links

The round started from `c9f2424` in the assigned worktree. Main initially remained `b5f207f`, then advanced to `d5406f3` (#200); the branch was rebased onto it. Rebase conflicts retained #200's purchase-term snapshots and catalog/pending-purchase dashboard fields. Inactive enrollments still cannot start support. Application source verified at `9d9c124`; the final follow-up changes API test fixtures and this QA record only.

1. **Installed-client compatibility fixed.** Self-paced plans reuse the original library projection, retaining `mode: "library"`, unchanged `library_summary` counts and existing cohort/timezone/events/recording fields. Additive `plan_kind: "self_paced"`, `course_overview` and `redos` give updated web/native clients their course view. A frozen copy of main's native card-selection logic renders the legacy card from the additive payload; API service and HTTP tests pin its mode/counts and new overview. Alumni keep library selection. Inspection of the remaining API diff confirms lesson/dashboard capabilities and recording destinations add fields; no existing serialized field was removed or renamed.
2. **Old cached lessons fixed.** Learner submissions, manual completion, retrieval attempts and video tracking require explicit `can_submit === true` without read-only status. Missing capabilities leave content/work/feedback/playback readable with quiet “Refreshing…” text. React Query hydration tests cover old payloads, transition to fresh capabilities, both video players and missing-capability completion/retrieval controls. Lessons without capabilities refetch on mount even inside the ordinary 60-second freshness window. The `csg-learning-v1` buster is retained deliberately so seven-day offline reading survives; permission checks make those retained payloads read-only. Demo lessons supply explicit capabilities.
3. **Exact recording context fixed.** Recording payloads add `destination_path` through #196's `LearningDestination.recording`. Native questions prefer that path; older caches use the same canonical primary/zero-based-legacy identifier rules. Screen and helper regressions cover primary, first/later legacy and promoted recordings; primary paths use `recording=<id>`, legacy paths use `recording=legacy-<cohort>-<ordinal>`. Tests also round-trip through #196's native destination parser.

New native regressions failed against the `c9f2424` implementations before the fixes. First full runs found stale self-paced fixture expectations. After rebasing, six tests also needed cohort instructor assignments to satisfy #200's stricter support-instructor validation. Those fixture fixes passed 20 focused tests / 184 assertions before the full API rerun. No new migration or dependency change belongs to this PR.

Review-round affected-flow QA uses the same synthetic owned database and identity adapter on ports 3618/5618. Browser checks cover the additive course overview, access/support dates, retained redo and Continue course destination at desktop/narrow widths; primary and legacy recording URLs select the named non-first playlist entry. Native cache/hydration/recording-context acceptance is automated component/query testing. Installed native hardware is **not_run** (no simulator assigned). These tests do not establish real Clerk, playback-provider delivery or a new installed build.

Evidence: local `.codex/p8-review-*.log`, `.codex/p8-review-recording-paths.json`, and the superseding untracked review handoff. Impeccable advisory returned no findings. No CodeRabbit request, merge, external message or production mutation was performed.

Final combined-source gates (Ruby 3.3.7 / Node 22.22.3): API **936 tests / 5,710 assertions**, zero failures/errors/skips; RuboCop **480 files** clean; Brakeman zero warnings (one existing ignore); bundler-audit clean. Web clean `npm ci` and full `npm run check`: **103 files / 617 tests**, lint/types/platform/build/bundle passed. Native clean `npm ci` and full `npm run check`: **107 suites / 728 tests**, brand/types/lint passed with 22 existing warnings. No lockfile changes.

The overview/Continue/redo and primary/legacy destination browser checks were repeated after the rebase. Narrow browser checks found no horizontal overflow. Both rounds' owned browser tabs and API/Vite processes were cleaned; the four owned databases are removed before handoff. The untracked review handoff records final head, push and cleanup confirmation. PR remains held for the lead; CI and review on the pushed head are separate from these local gates.
