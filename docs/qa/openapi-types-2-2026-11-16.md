# Shared API types, part 2 — N-1

## Scope and acceptance

Base: `5b39dc76` (#255), refreshed with `origin/main` including #256. CSG is the learning hub for students, instructors and administrators. Sources: PRODUCT_VISION.md, API_REFERENCE.md, the prior openapi-types QA record, controllers/serializers and populated synthetic integration fixtures. Clerk identity, conversation visibility, author-only metadata and moderation permissions must remain unchanged.

This slice covers priorities 1–2 plus JSON errors: workspaces/memberships, channels/DMs/messages, destinations/threads/search, attachments/preferences, session/profile, community policy, blocks/reports/deletion requests, push settings, feature settings and assistant posting-token management. Dashboards/Today, plans and course/staff management remain for part 3. No `api/app` implementation changes are part of this PR.

Acceptance: every documented operation/status validates a real Rails response; every response component has a non-null observation, not just an empty array; both generated copies match; all requested local gates pass. Shared JSON errors are checked across API request tests, with separate coverage for 401/403/404/422/429. They are not falsely documented as possible on every operation.

## Client corrections and local models

- Session/profile names can be null. Profile GET has role but no staff/admin flags; PATCH omits role too.
- Workspace members have membership role and handle, with email only for staff. They do not carry user authorization flags.
- Message author objects omit email. Optimistic messages can still carry it locally. Guaranteed blocked/reply/source/assistant-label fields are required; author-only client IDs and computed receipts remain conditional.
- Search context includes workspace_id. Show envelopes require messages, pins and window metadata; mutation envelopes omit them. Membership creation returns 201; delayed inline delivery can return 202, including deletion.
- Web Push registration returns bodyless 200/201; its previous client response object was fictional. Push config error fallback can omit preferences. The native email preference state and switch styling accept that existing undefined case through type-only changes.
- Shared 429s require retry_after; the existing voice-specific 429 has a distinct strict message-only variant. Rails local/test 404 diagnostics are separate from application 404 envelopes.

Local models retained: web MessageView and LocalMessage, native Message (optimistic sends, uploads and historical failed-send caches); native SessionUser/SessionEnrollment (older persisted account context); native UserSummary/WorkspaceDetail/DirectConversationSummary (mention lists, unsaved membership edits and cached/demo people). These derive from generated schemas but relax only fields absent from local state. API response envelopes remain strict. Thread window options, upload selection/progress, lesson/rubric/objective/editor/submission inputs, navigation kind, and learning-plan editing inputs remain client-owned because they model UI state or caller choices. Realtime event envelopes remain outside REST coverage.

## Remaining inventory

Counts below are exact declaration spans in `web/src/types/api.ts` and `mobile/src/lib/types.ts` after this slice: first declaration token through final token, inclusive, excluding adjacent comments, imports, generated/derived aliases and blank separators. This reproduces the prior inventory scope; inline shapes in other clients are not silently counted as migrated. Client-owned inputs/views are separated from remaining handwritten transport declarations.

### Web: 1150 transport lines; 18 local declaration lines

| Remaining declaration | Lines |
| --- | ---: |
| `InviteState` | 1 |
| `UserListItem` | 14 |
| `ContentBlock` | 22 |
| `RubricRating` | 1 |
| `FeedbackSnippet` | 8 |
| `LearningObjective` | 11 |
| `LessonSummary` | 13 |
| `AttentionAction` | 7 |
| `AttentionReason` | 8 |
| `StaffAttention` | 5 |
| `SupportQueueStudent` | 28 |
| `InterventionTrigger` | 1 |
| `InterventionSeverity` | 1 |
| `InterventionStatus` | 1 |
| `InterventionOutcome` | 1 |
| `InterventionNote` | 7 |
| `Intervention` | 27 |
| `RecoveryPlanCheckIn` | 7 |
| `RecoveryPlan` | 23 |
| `SupportQueue` | 9 |
| `ModuleSummary` | 16 |
| `ModuleDetail` | 15 |
| `CurriculumSummary` | 9 |
| `CurriculumDetail` | 19 |
| `Announcement` | 20 |
| `AnnouncementsResponse` | 5 |
| `AnnouncementResponse` | 3 |
| `ChannelMessageEvent` | 8 |
| `MessageTypingEvent` | 8 |
| `OfficeHourOccurrence` | 11 |
| `OfficeHour` | 19 |
| `WeeklyPlanLessonItem` | 17 |
| `PersonalPlanLesson` | 9 |
| `PersonalLearningPlan` | 14 |
| `WeeklyPlan` | 25 |
| `CohortSummary` | 18 |
| `CohortStudent` | 23 |
| `GithubAccessStatus` | 1 |
| `GithubAccessResponse` | 5 |
| `CohortModule` | 17 |
| `CohortDetail` | 9 |
| `CourseOfferingTerms` | 9 |
| `DashboardData` | 60 |
| `CohortStudentViewLesson` | 15 |
| `CohortStudentViewModule` | 15 |
| `CohortStudentView` | 42 |
| `EnrollmentSummary` | 20 |
| `ModuleAssignment` | 11 |
| `LessonAssignment` | 10 |
| `ResourceEntry` | 12 |
| `CohortWatchProgressRow` | 6 |
| `CohortWatchProgressStudent` | 5 |
| `CohortWatchProgressResponse` | 4 |
| `CohortLessonVideoProgressRow` | 6 |
| `CohortLessonVideoProgressStudent` | 5 |
| `CohortLessonVideoProgressResponse` | 10 |
| `StudentRecordingProgress` | 12 |
| `StudentWatchProgressResponse` | 3 |
| `StudentLessonVideoProgress` | 15 |
| `StudentLessonVideoProgressResponse` | 3 |
| `ReorderRecordingsResponse` | 3 |
| `UserEnrollment` | 10 |
| `StudentProgressBlock` | 15 |
| `StudentProgressLesson` | 22 |
| `StudentProgressModule` | 10 |
| `StudentProgressResponse` | 47 |
| `LearningEvidenceStatus` | 1 |
| `LearningEvidenceItem` | 17 |
| `LearningInsightStudent` | 8 |
| `LearningInsightObjective` | 12 |
| `LearningRevisionPattern` | 20 |
| `LearningInsights` | 25 |
| `LearningInsightsResponse` | 1 |
| `GithubChecksResponse` | 1 |
| `DashboardResponse` | 4 |
| `WeeklyPlanResponse` | 3 |
| `ModuleResponse` | 3 |
| `SupportQueueResponse` | 3 |
| `InterventionsResponse` | 3 |
| `InterventionResponse` | 3 |
| `RecoveryPlansResponse` | 3 |
| `RecoveryPlanResponse` | 3 |
| `ResourcesResponse` | 3 |
| `UsersListResponse` | 3 |
| `UserDetailResponse` | 4 |
| `UserUpdateResponse` | 3 |
| `CurriculaListResponse` | 3 |
| `CurriculumResponse` | 3 |
| `CohortsListResponse` | 3 |
| `CohortResponse` | 3 |
| `AccessibleCohort` | 11 |
| `AccessibleCohortsResponse` | 3 |
| `CohortHomeStudent` | 15 |
| `CohortHome` | 41 |
| `CohortHomeResponse` | 3 |
| `CohortInstructorAssignment` | 5 |
| `CohortInstructorAssignmentsResponse` | 3 |
| `CohortStudentViewResponse` | 3 |
| `SubmissionWindowsResponse` | 3 |
| `OfficeHoursResponse` | 4 |
| `OfficeHourResponse` | 3 |
| `PrivateMeetingSlot` | 8 |
| `PrivateMeetingBooking` | 13 |
| `PrivateMeetingCohort` | 16 |
| `StaffPrivateMeetingCohort` | 3 |
| `PrivateMeetingsResponse` | 3 |
| `StaffPrivateMeetingsResponse` | 3 |
| `PrivateMeetingResponse` | 3 |
| `PrivateMeetingSlotResponse` | 3 |
| `EnrollmentsListResponse` | 3 |
| `EnrollmentResponse` | 7 |
| `ModuleAssignmentsListResponse` | 3 |
| `ModuleAssignmentResponse` | 3 |
| `LessonAssignmentsListResponse` | 3 |
| `LessonAssignmentResponse` | 3 |
| `ContentBlockResponse` | 3 |
| `ContentBlocksListResponse` | 3 |
| `LearningPlanManagement` | 5 |

Client-owned declarations: `PushSubscriptionResponse` (1), `ThreadWindowOptions` (6), `LearningPlanInput` (10), `MessageView` (1).

### Mobile: 493 transport lines; 102 local declaration lines

| Remaining declaration | Lines |
| --- | ---: |
| `AccessibleCohort` | 10 |
| `CohortHome` | 10 |
| `CohortOfficeHour` | 14 |
| `Announcement` | 17 |
| `MessageEvent` | 8 |
| `MessageTypingEvent` | 8 |
| `RealtimeMessageEvent` | 1 |
| `MessageSearchResult` | 8 |
| `LearningResource` | 13 |
| `AttentionAction` | 7 |
| `AttentionReason` | 8 |
| `StaffAttention` | 5 |
| `SupportQueueStudent` | 28 |
| `InterventionTrigger` | 1 |
| `InterventionSeverity` | 1 |
| `InterventionStatus` | 1 |
| `InterventionOutcome` | 1 |
| `InterventionNote` | 7 |
| `Intervention` | 22 |
| `RecoveryPlan` | 21 |
| `SupportQueue` | 9 |
| `OfficeHourOccurrence` | 12 |
| `WeeklyPlanLessonItem` | 17 |
| `PersonalPlanLesson` | 9 |
| `PersonalLearningPlan` | 14 |
| `WeeklyPlan` | 25 |
| `StudentDashboardLesson` | 15 |
| `StudentDashboardModule` | 14 |
| `StudentDashboard` | 52 |
| `StaffDashboard` | 5 |
| `StaffStudentSummary` | 17 |
| `StaffCohortDashboard` | 5 |
| `StudentProgressDetail` | 9 |
| `StaffProgressModule` | 19 |
| `StaffVideoProgress` | 17 |
| `StaffLessonSummary` | 13 |
| `StaffCurriculumModule` | 17 |
| `StaffCurriculumSummary` | 9 |
| `StaffCurriculum` | 3 |
| `RubricRating` | 1 |
| `LearningObjective` | 11 |
| `FeedbackSnippet` | 8 |
| `LessonSubmissionType` | 1 |

Client-owned declarations: `ConversationKind` (1), `UploadAttachmentInput` (6), `PendingAttachment` (12), `LessonEditorInput` (36), `LearningObjectiveCreateInput` (8), `RubricCreateInput` (6), `ExerciseCreateInput` (7), `CurriculumModuleInput` (10), `SubmissionInput` (10), `ThreadWindowOptions` (6).

The next slice must cover the listed staff user/enrollment/curriculum/module/cohort management, student/staff dashboards and detailed progress matrices, Today/weekly/personal/recovery plans, interventions/attention/insights, announcements, office/private meetings, resources/content/rubric/objective/feedback management, and remaining video/upload transports. The REST source of truth is the operation list in openapi.json; endpoint payloads outside that list still need response validation even where nested aliases are shared. Full request-body contracts remain separate work.

## Verification and resource disposition

Agent-executed request/component regression checks use synthetic fixtures. Required scenarios: conversation visibility and reads/writes/threads; populated message source/reaction/attachment/receipt branches; policy and moderation transitions; profile/session and feature/push preferences; real JSON auth/validation/missing-record/limit errors. This type-only slice adds no visual journey. Browser, Safari, installed-device interaction and production delivery are not run on the headless Mac mini.

Final gate results are recorded below. No app servers, browser tabs, simulators or containers were started. Lifecycle initialization failed with `Invalid machine profile: schema_version must be 1`; the exact task database is `csg_openapi_types_2_test` was dropped after the final run; an exact-name pg_database query returned no rows. Shared PostgreSQL is borrowed and remains available. No merge, watch or independent agent review is requested.


Final code tested: `1e638800` (the evidence commit adds documentation only), based
on main `8dd70310`. Node 20.19.5 for web, 22.22.3 for native; Ruby 3.3.7;
local PostgreSQL with `PGGSSENCMODE=disable`. All results below are agent-executed:

- API: `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1 bundle exec rails test` passed,
  1,355 tests / 36,703 assertions, zero failures/errors/skips. All 88 operations /
  96 success statuses and five shared error statuses exercised; all 116 response
  components observed with non-null values (118 schemas minus two request-only
  exceptions). RuboCop: 560 files, no offenses. Brakeman: zero warnings, one
  existing ignored warning. Zeitwerk passed.
- Web: `api:check`, both TypeScript projects, lint, 174 Vitest suites / 1,994 tests,
  production build and `test:bundle` passed.
- Mobile: typecheck, lint (zero errors, 33 existing warnings), 129 Jest suites /
  1,171 tests passed. Native build/export and device/Safari interaction were not
  requested for this slice and are not claimed.
- An initial synthetic block-list fixture used `user` instead of `blocker`;
  corrected it, then reran the full suite and coverage gate successfully. Earlier
  validation failures exposed the type mismatches listed above; production API
  implementations were preserved.
- Compared transpiled tokens for all 18 changed production TypeScript files against
  main (ignoring comments/formatting/trailing commas). Only synthetic demo-data
  fields differ; all other runtime tokens match. No new assertion escapes were
  added. Reviewed the combined diff after merging main; no independent or automated
  PR review is claimed by this implementation worker.
- Task database removed and absence verified. No owned servers, tabs, simulators
  or containers remain. Shared PostgreSQL and other sessions were left untouched.
  Branch and checkout remain for lead review. No merge, watch or deployment done.
