# P1b: shared authoring and community authority

Owner decisions: audit `PLAN.md` T15/T16 and `WORKER_BRIEF.md` supplied by the integration lead, October 22, 2026. Base inspected: `3eee7c4` (main after #191). Sources: `docs/PRODUCT_VISION.md`, Brain Dump `code-school/csg-learning-platform-plan.md` (historical architecture), current controller/model/client code, and `verify-staff.md` T15/T16.

Code School students learn in assigned cohorts; instructors teach, inspect solutions, grade and manage assigned-cohort teaching operations. Reusable curricula are shared across cohorts. Clerk supplies identity; Rails enforces roles; React and Expo use the session role for affordances. Shared course authoring and community administration belong to admins. This slice retains existing staff-wide community visibility, including participation; it does not migrate existing communities to membership-only visibility.

## Controller audit

Every `require_staff!` controller was inspected. These are the mutation decisions; read-only uses in curricula/modules/objectives/rubrics/cohorts/users/progress/watch-progress/learning-insights remain available to staff under their existing scope checks.

| Controller | Mutation actions / decision |
| --- | --- |
| Lessons | `create`, `create_exercise`, `update` (including position/release-day move/reorder), `update_editor` (instructions/solutions, checks, runner and video settings), `archive`, `restore`: change to admin. `destroy` already admin. |
| ContentBlocks | `create`, `update`, `video_presign`, `generic_video_presign`: change to admin. `destroy` already admin. Student `video_progress` and staff read/stream stay unchanged. |
| CurriculumResources | `create`, `complete`, `destroy`: change to admin. Existing read/download cohort access stays. |
| Uploads | `multipart_initiate`, `multipart_part_url`, `multipart_complete`, `multipart_abort`, `abandon`: shared `content_videos/` require admin. Recording uploads retain staff access with assigned-cohort validation, including later key-based operations. |
| Workspaces | Community `create`, `update` (name/description/archive/restore): admin. Cohort workspaces are still derived from cohorts. |
| WorkspaceMemberships | `create`, `destroy`: admin. No membership-role update endpoint exists; caller-supplied roles cannot grant authority. Cohort membership still follows enrollment. |
| Channels | `create`, `update`, `destroy`: community admin; active cohort workspace admin or assigned instructor. Both workspace-ID and legacy cohort-ID creation paths are tested. |
| FeedbackSnippets | `create`, `use`, own `update`/`destroy`: keep staff. Snippets are grading feedback aids, owned by `created_by`, with owner-or-admin mutation, not curriculum content. |
| LearningObjectives | `create`, `update`, `destroy`: already admin; keep. |
| ObjectiveAlignments | `update`: already admin; keep. |
| Rubrics | `create`, `update`, `destroy`, including nested criteria: already admin; keep. |
| Curricula / Modules | `create`, `update`, `destroy`: already admin; keep. |
| CoursePackages | `preview`, `create`: already admin; keep. |
| ModuleAssignments / LessonAssignments | `create`, `update`, `destroy`: keep staff; per-enrollment teaching overrides, not shared authoring. |
| Submissions / SubmissionGithubChecks | `grade` / check-run `create`: keep staff; assessment of assigned learners. `github_issue` is read-only. |
| CohortGrading | `sync_all`, `sync_student`: keep staff; cohort-scoped grading/GitHub operations. |
| Recordings | `create`, `update`, `destroy`, `presign`, `reorder`: keep staff; cohort-scoped teaching recordings. |
| OfficeHours | `create`, `update`, `destroy`: keep staff; assigned-cohort live sessions. |
| StaffPrivateMeetingSlots / StaffPrivateMeetings | slot `create`/`destroy`, meeting `update`: keep existing staff/owner/admin rules; teaching schedules. |
| Announcements | `create`, `update`, `destroy`: keep existing staff audience/cohort management rules; teaching communication. |
| Interventions / InterventionNotes | intervention `create`/`update`, note `create`: keep staff; learner support, not curriculum. |
| RecoveryPlans / RecoveryPlanCheckIns | plan `create`/`update`, check-in `create`: keep staff; learner support. |
| ContentReports / DataDeletionRequests | staff `update` was present on the initial base; privacy administration belongs to wave-1 #192. Do not duplicate its changes; final rebase must retain its admin restriction. |

## Required acceptance (agent executed)

1. Instructor shared-authoring requests are forbidden, including editor/check/video/runner payloads, archive/restore, course ZIP staging/confirmation/deletion and every multipart path. Admin authoring persists successfully; instructor reads include saved solutions.
2. Instructor library browsing and direct editor URLs show saved preview/solutions plus “Only admins can change the shared course library.” No add/edit/archive/reorder/settings/upload forms. Admin controls remain usable.
3. Community writes fail for unrelated, member and manager instructors. Admin workspace lifecycle, membership add/remove and channel writes persist. Existing staff-wide visibility and member conversation participation continue.
4. Assigned instructors retain cohort channel creation/edit/archive by both API target styles; unrelated instructors are denied. Assigned-cohort recording multipart lifecycle remains usable.
5. Web and native controls follow session `is_admin`, including stale `can_manage=true` community responses. Native editor and library regressions cover gating; iOS simulator is explicitly excluded.

## Verification ledger

Implementation and agent-executed affected-flow verification are complete. The PR is held for the integration lead; no merge or deployment was performed. Results and exclusions follow. Clerk login and S3 delivery are not represented by synthetic local-session checks.

### Local browser execution

Agent executed the real web components against Rails at API 3614 / web 5614 using only `csg_p1b_authoring_authority_dev`. Rails ran in test mode, with synthetic local identity tokens; a temporary Vite entry replaced the Clerk session provider. Neither the entry nor authentication stand-in is included in the PR. Storage credentials were blank and jobs used the test adapter. Fixture IDs: admin 1, instructor 2, student 3, curriculum/lesson/cohort workspace 1, community workspace 2. Tested viewports: 1280×800 and 390×844 desktop browser emulation (not native mobile).

| Case | Result | Evidence / limits |
| --- | --- | --- |
| Instructor library | passed desktop + narrow | Expanded module and week; only preview/navigation controls remained, zero inputs/selects; no horizontal page overflow. Saved admin title appeared after refresh. |
| Instructor direct editor and preview URLs | passed desktop + narrow | Saved instructions rendered, exact restriction note, no authoring forms. Solution disclosure displayed `puts "P1b saved solution"` in the read-only Monaco editor; no student submission control. |
| Admin lesson edit/save | passed desktop | Changed lesson title through the actual editor, clicked Save Changes, saw success; independent GET returned the saved title. Narrow admin save not run (existing layout). |
| Instructor community | passed narrow; desktop component tests | No community create, membership management or channel creation controls; member opened General and posted a synthetic message. Independent GET returned the saved message. No actual delivery/provider claims. |
| Admin community create | passed desktop | Created `P1b admin-created community` in Messages; independent workspace list returned it. |
| Admin membership add/remove | passed desktop | Added student 3 through member picker, then removed through UI; independent workspace GET showed members `[2]` afterward. |
| Instructor cohort channels | failed then fixed; passed desktop | Found cross-workspace dropdown defaulting to an unauthorized community. Restricted choices to assigned-cohort workspaces and defaulted to current workspace. Created `P1b instructor teaching channel`; independent GET confirmed workspace/cohort 1. |
| API authority and teaching exceptions | automated | Role matrix enumerates shared mutations; workspace tests cover unrelated/member/manager instructors, admin lifecycle/memberships, cohort targets and persisted outcomes; recording multipart tests cover assigned versus unrelated cohorts. |
| Native role gating | automated; device not run | Native component/screen tests are part of the mobile gate. No iOS simulator was started, per assignment. |
| Clerk login, S3 transfer, production deployment | not run | Local identity/storage isolation; no deployment or merge authorized. |

A false-start fixture seed used the wrong association name and was corrected before browser execution. One snapshot was retried during Vite refresh. Initial obsolete dependency requests recovered on reload. These were harness setup issues, not accepted app failures.

### Engineering and cleanup

Before-fix regression: restoring only the original lesson controller caused the new role-matrix test to fail on instructor lesson creation (`201`, expected `403`). Restored the implementation before all subsequent gates.

Web: `npm ci && npm run check` passed (83 files, 475 tests), including lint, strict TypeScript, Netlify routing, build, and bundle checks. The first full run had all assertions pass but an existing modal-exit timer outlived its environment; the new gating tests now complete their modal exit cleanup, and the complete rerun passed. Advisory Impeccable scan returned `[]`.

API: complete suite passed, 798 tests / 4,123 assertions, using only the dedicated test database and its two parallel copies. RuboCop: 458 files, no offenses. Brakeman: zero security warnings (one existing ignored warning). Bundler audit: no vulnerabilities. Existing importer duplicate-key warnings remain unchanged.

QA lifecycle: owned API PID 50636 and Vite PID 50862 terminated through the lifecycle helper. Tab `tab_4w_62d87cd1-1de8-4198-b58d-ab023365657f` closed and released. `dev-lifecycle status` reports no active owned resources. No simulator or container started. Temporary Vite files were removed. The dedicated QA database, test database and `_0`/`_1` parallel copies were all dropped after verifying zero active connections.


Final implementation source: `50e9f04` (API/web `f7e2058`, native integration `d453c20`, role-change modal regression `50e9f04`). Rebased onto verified `origin/main` `3eee7c4`; no conflicts and no changes to wave-1 files beyond the lesson-controller authorization lines. Later commits to this ledger contain evidence only.

Native: `npm ci && npm run check` on Node 22.22.3 passed brand validation, TypeScript, ESLint (19 existing warnings), 92 suites / 592 tests. Jest retains existing asynchronous cache timers after assertions; it was allowed to exit naturally. No dependencies changed. Native advisory Impeccable scan also returned `[]`.

Independent read-only review of `3eee7c4...50e9f04` found no material findings. It covered API mutation boundaries, community/cohort rules, multipart recording scope, web/native direct editors, role changes, and the regression tests. Its limits are static review only; the browser ledger and engineering gates supply the execution evidence. CodeRabbit/CI status is recorded in the PR and local handoff rather than inferred from this review.

No schema migration, production configuration, or enrollment data change. Deploy API and web together; include the native changes in the next mobile build. Existing clients attempting authoring as instructors will receive the intended API denial. Existing staff-wide community visibility remains deliberate; a membership-only visibility migration is outside this slice.
