# R-8 model coverage inventory

Baseline: `8dd70310` (`origin/main`, 2026-11-16). Test-only changes; no production behavior changed.

## Scope and acceptance

CSG serves students, instructors, and admins through Rails REST APIs with Clerk identity, Stripe purchases, course access, progress, messaging, and school-time scheduling. Sources: `docs/PRODUCT_VISION.md`, `AGENTS.md`, current model code and schema. This work checks model contracts against synthetic local PostgreSQL rows. It does not claim new UI journey acceptance or exhaustive branch coverage.

All 66 concrete Active Record models and the MessageReadCursor module have named model test files after this change (49 new named files plus one cross-model integrity suite).

Counts below are test cases in the model’s named `test/models/<model>_test.rb`, before → after. Existing cross-model suites (for example `admin_continuity_test`, `assignment_availability_test`, and `user_invite_state_test`) remain in place; these counts deliberately do not credit their cases to every referenced model. Integration references below are a static inventory of explicit model constants or association names, not measured execution/branch coverage. Abstract database connection classes have no independent persistence contract.

## Coverage table

| Model | Direct cases before → after | Key behaviors in named tests |
|---|---:|---|
| ActivityEvent | 0 → 1 | record helper captures actor subject evidence and paired reference |
| AgentPostingToken | 6 → 6 | issue stores only a SHA-256 digest and returns the prefixed plaintext once; authenticate rejects unknown wrong-prefix revoked and expired tokens; a home base token can never authenticate as a posting token; owner must be an accepted active admin when issuing and when using; name expiry scope and active-token limit are validated; unknown and revoked tokens still use fixed length constant time digest comparison |
| Announcement | 0 → 1 | publication visibility audience access and active recipients differ from read access |
| ApplicationRecord | — | Abstract connection base; exercised through concrete models/services |
| AuthSession | 0 → 1 | digest length and uniqueness are enforced per user including SQL |
| CableTokenNonce | 0 → 1 | active and expired scopes partition used and expired nonces at exact deadline |
| Channel | 0 → 2 | visibility and posting distinguish enrolled paused archived and staff users; workspace synchronization uniqueness ordering and destroy dependencies |
| ChannelReadState | 0 → 1 | read cursor advances monotonically and breaks equal time ties by message id |
| ClerkIdentity | 2 → 2 | a user can have one identity per issuer; a Clerk subject cannot belong to two users |
| Cohort | 3 → 3 | alumni cohorts use the shared alumni organization unless another is specified; GitHub organization accepts a name and rejects a URL; blank or padded organization names are normalized before saving |
| CohortInstructorAssignment | 0 → 2 | only instructors can be assigned and duplicates are rejected by model and database; create and destroy reset cable while rollback does not |
| CohortModuleSchedule | 2 → 2 | start_date must align with the module's first scheduled weekday; start_date accepts the module's expected first weekday |
| CohortModuleSubmissionWindow | 2 → 2 | week number must fit within the module schedule; module must belong to the cohort curriculum |
| ContentBlock | 4 → 4 | effective submission type legacy truth table and explicit precedence; normalizes duplicated protocol prefixes in video urls; rejects video urls without an http host; display_title falls back to the lesson title and then a generic label |
| ContentReport | 0 → 1 | cannot report self or another authors message and open reports are unique |
| CoursePurchase | 0 → 2 | snapshots purchase terms and models uncertain checkout retry window; unique purchase and Stripe references prevent duplicate entitlements |
| Curriculum | 0 → 1 | name is required cohorts and resources restrict deletion but owned content is destroyed |
| CurriculumModule | 0 → 3 | calendar helpers use schedule weekdays offsets and release weeks; archived lessons remain protected during schedule edits and are destroyed with module; new modules assign unlocked access to active alumni only |
| CurriculumResource | 0 → 1 | ZIP metadata limits and publication timestamp remain stable across unrelated edits |
| DataDeletionRequest | 0 → 1 | status transitions require a documented resolution and terminal states cannot reopen |
| DirectConversation | 0 → 2 | canonical member keys make creation idempotent and restore archived conversations; blocked members cannot post and destroy removes members messages and preferences |
| DirectConversationMember | 0 → 1 | read cursor advances monotonically and breaks equal time ties by message id |
| Enrollment | 0 → 6 | active and read scopes expire exactly at the access deadline; pause cutoff uses Guam dates on either side of midnight; guided deadlines include the final Guam day and snapshot agreed terms; self paced support starts once and never outlives access; restart guard rejects stale writes but accepts newer requests; destroy removes assignments and nullifies historical work |
| EnrollmentRestart | 0 → 1 | restart requires audit snapshot counts and actors while enrollment is optional |
| ExpoPushReceipt | 0 → 1 | due receipts exclude future or leased work and order by availability and id |
| FeatureSwitchChange | 0 → 1 | audit record requires actor but allows schoolwide changes without a cohort |
| FeedbackSnippet | 0 → 1 | title derives from squished body and recommended scope prioritizes usage |
| GithubCheckRun | 1 → 1 | details links require a complete HTTPS URL |
| HelpRequest | 8 → 8 | acknowledging and resolving preserve an auditable visible state; resolving keeps the response's leading indentation and drops only outer blank lines; resolving with a whitespace-only response is rejected; owner must be staff and student must belong to the cohort; resolved requests remain terminal and preserve their resolution time; terminal and owned states require their audit fields; stale cancellation cannot overwrite a concurrent resolution; stale staff transitions cannot overwrite a concurrent cancellation |
| HomeBaseToken | 0 → 1 | issue stores only a digest and authentication checks revocation role archive and pending invitation |
| Intervention | 0 → 2 | resolution requires outcome stamps time and reopening clears resolution; one active trigger per enrollment and destroy removes notes and nullifies plan |
| InterventionNote | 0 → 1 | notes require staff authors nonempty bounded body and intervention |
| KnowledgeCheck | 1 → 1 | question remains immutable after student evidence exists |
| KnowledgeCheckAttempt | 0 → 1 | option must exist and SQL rejects negative choice |
| LearningObjective | 2 → 2 | normalizes codes and requires concrete success criteria; rejects alignments outside the objective curriculum |
| LearningPlan | 0 → 2 | required overrides apply only to active plans and snapshot excludes database identity; scope date and duplicate milestone validation preserve assigned learning boundaries |
| LearningPlanRevision | 0 → 1 | revision persists audit snapshot requires author and is destroyed with plan |
| Lesson | 25 → 25 | unlock_date uses the module start date plus the lesson calendar offset; unlock_date with module_assignment override uses override as base; unlock_date without module_assignment uses the cohort module schedule start date; unlock_date with day_offset on module; unlock_date treats tth module start date as the first actual release day; unlock_date uses explicit cohort module start dates when present; available? returns true when date has passed; available? uses the Guam learning date at the UTC day boundary; available? returns false when date has not passed; available? returns false when module_assignment is not accessible; available? with lesson_assignment unlocked overrides everything; available? with lesson_assignment unlock_date_override in past; available? with lesson_assignment unlock_date_override in future; available? without module_assignment uses raw date calculation; completion blocks prefer assignment-like blocks over supporting video blocks; completion blocks fall back to all blocks when no assignment-like block exists; requires title; release_day must be non-negative integer; release_day must match the module schedule; blank release_day adds validation errors instead of raising; archiving preserves the lesson while removing it from active module lessons; restoring returns an archived lesson to the active curriculum; module lessons are ordered by release day then position; module schedule changes cannot hide active lessons; module schedule changes cannot strand archived lessons |
| LessonAssignment | 0 → 1 | unlock date uses Guam today and records only newly available changes |
| Message | 0 → 3 | exactly one destination thread root and same destination are required; client id normalization uniqueness source checks and soft deletion; destroy nullifies replies and cursors while deleting reactions and attachments |
| MessageAttachment | 0 → 1 | image detection required metadata positive size and unique object keys |
| MessageDeliveryLockRecord | — | Abstract connection base; exercised through concrete models/services |
| MessagePreference | 0 → 1 | preferences are unique per user and polymorphic target |
| MessageReaction | 0 → 1 | reactions are unique per message user and emoji but allow other emoji |
| MessageReadCursor | 0 → 1 | after and through partition tied timestamps and seen matches the boundary |
| MobilePushToken | 2 → 2 | accepts current and legacy Expo token formats; rejects arbitrary endpoints |
| ModuleAssignment | 13 → 13 | accessible? returns true when unlocked is true; accessible? follows the cohort module schedule when unlocked is false; accessible? uses the Guam learning date at the UTC day boundary; accessible? returns true when override date is in the past; accessible? returns false when override date is in the future; accessible? uses explicit cohort module start dates when present; available_for? returns false when not accessible; available_for? returns true when accessible and module has no lessons; available_for? returns true when at least one lesson is available; available_for? returns false when all lessons are locked; next_unlock_date returns nil for module with no lessons; next_unlock_date returns earliest unlock date across lessons; enforces uniqueness of module_id per enrollment |
| Notification | 0 → 2 | mark read is idempotent and unread scope excludes read notifications; legacy path removes context only for supported destinations |
| ObjectiveAlignment | 0 → 1 | alignment rejects cross curriculum and wrong lesson blocks and enforces both unique indexes |
| OfficeHour | 6 → 6 | weekly occurrences preserve their wall-clock time across daylight saving changes; weekly occurrences use the anchor offset during a repeated fall-back hour; weekly occurrences choose the matching DST fold on a future fall-back date; weekly occurrences advance through a nonexistent spring-forward hour; past one-time sessions are not upcoming; meeting URL must use HTTP or HTTPS |
| PrivateMeetingBooking | 0 → 3 | database enforces positive range week count and confirmed slot and enrollment uniqueness; overlapping instructor or student meetings are rejected by exclusion constraints; destroy cascades booking events and their notifications |
| PrivateMeetingBookingEvent | 0 → 1 | event requires action actor and booking and preserves details |
| PrivateMeetingConfig | 0 → 2 | week boundaries use saved school timezone including midnight and course end; config is unique per cohort and cannot be removed with slots |
| PrivateMeetingSlot | 0 → 2 | new slots require future matching duration instructor and single course week; confirmed bookings mark booked and restrict deletion even after cancellation |
| Progress | 5 → 5 | sets completed_at when status changes to completed; clears completed_at when status changes away from completed; does not overwrite completed_at if already set; enforces uniqueness of content_block per user; enum values |
| PushSubscription | 0 → 1 | seen restores failed subscriptions and endpoint is unique |
| Recording | 3 → 3 | classifies supported secure recording hosts; external recording does not require upload metadata; uploaded recording still requires upload metadata |
| RecoveryPlan | 0 → 2 | completion requires outcome stamps time and reactivation clears completion; one active plan per enrollment and destroy removes check ins |
| RecoveryPlanCheckIn | 0 → 1 | check ins require staff authors nonempty bounded body and plan |
| Rubric | 6 → 6 | requires at least one criterion; criterion objective must belong to the rubric curriculum; content block rejects a rubric from another curriculum; content block preserves its rubric after criterion feedback is recorded; criterion wording is immutable after feedback is recorded; attached rubric cannot be deleted out from under student work |
| RubricCriterion | 0 → 1 | recorded feedback prevents edits and deletion and database rejects negative positions |
| SchoolSetting | 0 → 2 | singleton loads persistently and database rejects a second id; request cache is scoped and reset between requests |
| Submission | 0 → 2 | latest attempt resolves equal timestamps by id and isolates enrollment and user; required artifacts depend on snapshotted submission type |
| SubmissionCriterionResult | 0 → 1 | rating requires matching rubric and result is unique per criterion |
| User | 0 → 5 | normalizes handles and rejects reserved invalid and duplicate handles; cohort read and teaching access follow role enrollment expiry and archive state; committed role archive restoration and destroy reset cable but profile edits do not; archive deletes device credentials and archives a two person conversation; hard deleting a message author preserves the nullified historical message |
| UserBlock | 0 → 1 | self blocking is rejected in Ruby and SQL and between is symmetric |
| WatchProgress | 0 → 1 | completion begins at ninety percent is sticky and percentage is capped |
| Workspace | 3 → 3 | alumni cohorts receive an Alumni Chat workspace channel; regular cohorts continue to receive Class Chat; channel management follows admin community authority and assigned cohort teaching |
| WorkspaceMembership | 0 → 1 | membership role transitions and unique user per workspace |

## Shared concern

`concerns/provider_email_provenance.rb` is covered directly by the existing `provider_email_provenance_test.rb` (Message and Notification create-time tagging, rollout activation/deactivation, and persisted send identity tags). It is a mixin rather than a separately persisted model.

## Existing direct and indirect test files

“Direct” lists the pre-existing named file and additional pre-existing model tests with explicit references. “Integration” lists explicit constants or plural association names; requests may exercise additional models without spelling their names. A missing static reference does not prove absence of integration coverage.

### ActivityEvent

Existing direct/model references: none.

Existing integration references: `activity_history_test.rb`, `checkpoint_submissions_test.rb`, `submissions_grading_test.rb`.

### AgentPostingToken

Existing direct/model references: `agent_posting_token_test.rb`.

Existing integration references: `agent_posting_test.rb`.

### Announcement

Existing direct/model references: none.

Existing integration references: `communication_test.rb`, `course_expiration_test.rb`, `feature_switches_test.rb`, `record_related_test.rb`, `role_matrix_test.rb`, `updates_test.rb`, `users_lifecycle_test.rb`.

### ApplicationRecord

Existing direct/model references: none.

Existing integration references: none found statically.

### AuthSession

Existing direct/model references: none.

Existing integration references: `activity_history_test.rb`.

### CableTokenNonce

Existing direct/model references: none.

Existing integration references: none found statically.

### Channel

Existing direct/model references: none.

Existing integration references: `agent_posting_test.rb`, `channels_test.rb`, `cohort_workspaces_test.rb`, `community_safety_test.rb`, `endpoint_query_counts_test.rb`, `guided_course_access_test.rb`, `home_base_digest_test.rb`, `message_sources_test.rb`, `self_paced_course_access_test.rb`, `slack_messaging_test.rb`, `student_progress_context_test.rb`, `users_lifecycle_test.rb`, `workspace_authority_test.rb`.

### ChannelReadState

Existing direct/model references: none.

Existing integration references: `channels_test.rb`, `home_base_digest_test.rb`, `slack_messaging_test.rb`.

### ClerkIdentity

Existing direct/model references: `clerk_identity_test.rb`.

Existing integration references: `learning_plans_test.rb`.

### Cohort

Existing direct/model references: `assignment_availability_test.rb`, `cohort_module_schedule_test.rb`, `cohort_module_submission_window_test.rb`, `cohort_test.rb`, `help_request_test.rb`, `lesson_test.rb`, `module_assignment_test.rb`, `office_hour_test.rb`, `provider_email_provenance_test.rb`, `recording_test.rb`, `workspace_test.rb`.

Existing integration references: `activity_history_test.rb`, `agent_posting_test.rb`, `api_authz_guards_test.rb`, `cable_access_reset_test.rb`, `channels_test.rb`, `checkpoint_submissions_test.rb`, `cohort_grading_test.rb`, `cohort_module_submission_windows_test.rb`, `cohort_workspaces_test.rb`, `communication_test.rb`, `community_safety_test.rb`, `course_expiration_test.rb`, `course_packages_test.rb`, `curriculum_resources_test.rb`, `direct_conversation_titles_test.rb`, `endpoint_query_counts_test.rb`, `enrollment_restarts_test.rb`, `enrollments_and_module_access_test.rb`, `feature_switches_test.rb`, `guided_course_access_test.rb`, `help_requests_test.rb`, `home_base_digest_test.rb`, `intervention_workflows_test.rb`, `last_seen_throttle_test.rb`, `learner_capabilities_test.rb`, `learning_insights_test.rb`, `learning_plans_test.rb`, `lessons_api_test.rb`, `message_sources_test.rb`, `office_hours_test.rb`, `private_meetings_test.rb`, `record_related_test.rb`, `record_summaries_test.rb`, `recordings_test.rb`, `role_matrix_test.rb`, `self_paced_course_access_test.rb`, `slack_messaging_test.rb`, `student_progress_context_test.rb`, `submission_github_checks_test.rb`, `submissions_grading_test.rb`, `updates_test.rb`, `uploads_test.rb`, `user_handles_test.rb`, `users_index_pagination_test.rb`, `users_lifecycle_test.rb`, `web_handoffs_test.rb`, `weekly_plans_test.rb`, `workspace_authority_test.rb`.

### CohortInstructorAssignment

Existing direct/model references: none.

Existing integration references: `activity_history_test.rb`, `api_authz_guards_test.rb`, `cable_access_reset_test.rb`, `cohort_module_submission_windows_test.rb`, `cohort_workspaces_test.rb`, `community_safety_test.rb`, `curriculum_resources_test.rb`, `direct_conversation_titles_test.rb`, `endpoint_query_counts_test.rb`, `help_requests_test.rb`, `intervention_workflows_test.rb`, `learner_capabilities_test.rb`, `learning_insights_test.rb`, `learning_plans_test.rb`, `message_sources_test.rb`, `office_hours_test.rb`, `private_meetings_test.rb`, `record_related_test.rb`, `record_summaries_test.rb`, `recordings_test.rb`, `role_matrix_test.rb`, `self_paced_course_access_test.rb`, `slack_messaging_test.rb`, `student_progress_context_test.rb`, `submission_github_checks_test.rb`, `submissions_grading_test.rb`, `updates_test.rb`, `uploads_test.rb`, `user_handles_test.rb`, `users_index_pagination_test.rb`, `users_lifecycle_test.rb`, `workspace_authority_test.rb`.

### CohortModuleSchedule

Existing direct/model references: `cohort_module_schedule_test.rb`, `lesson_test.rb`, `module_assignment_test.rb`.

Existing integration references: `activity_history_test.rb`, `enrollments_and_module_access_test.rb`, `role_matrix_test.rb`.

### CohortModuleSubmissionWindow

Existing direct/model references: `cohort_module_submission_window_test.rb`.

Existing integration references: `cohort_grading_test.rb`, `cohort_module_submission_windows_test.rb`, `learning_plans_test.rb`, `submissions_grading_test.rb`.

### ContentBlock

Existing direct/model references: `content_block_test.rb`, `lesson_test.rb`, `progress_test.rb`.

Existing integration references: `activity_history_test.rb`, `api_authz_guards_test.rb`, `checkpoint_submissions_test.rb`, `cohort_grading_test.rb`, `cohort_workspaces_test.rb`, `course_expiration_test.rb`, `course_packages_test.rb`, `curriculum_structure_api_test.rb`, `endpoint_query_counts_test.rb`, `enrollment_restarts_test.rb`, `feature_switches_test.rb`, `help_requests_test.rb`, `home_base_digest_test.rb`, `intervention_workflows_test.rb`, `learner_capabilities_test.rb`, `learning_insights_test.rb`, `learning_plans_test.rb`, `lessons_api_test.rb`, `message_sources_test.rb`, `office_hours_test.rb`, `record_related_test.rb`, `record_summaries_test.rb`, `recordings_test.rb`, `role_matrix_test.rb`, `self_paced_course_access_test.rb`, `student_progress_context_test.rb`, `submission_github_checks_test.rb`, `submissions_grading_test.rb`, `uploads_test.rb`, `weekly_plans_test.rb`.

### ContentReport

Existing direct/model references: none.

Existing integration references: `community_safety_test.rb`, `role_matrix_test.rb`.

### CoursePurchase

Existing direct/model references: none.

Existing integration references: `self_paced_course_access_test.rb`.

### Curriculum

Existing direct/model references: `assignment_availability_test.rb`, `cohort_module_schedule_test.rb`, `cohort_module_submission_window_test.rb`, `cohort_test.rb`, `content_block_test.rb`, `help_request_test.rb`, `knowledge_check_test.rb`, `learning_objective_test.rb`, `lesson_test.rb`, `module_assignment_test.rb`, `office_hour_test.rb`, `progress_test.rb`, `provider_email_provenance_test.rb`, `recording_test.rb`, `rubric_test.rb`, `workspace_test.rb`.

Existing integration references: `activity_history_test.rb`, `agent_posting_test.rb`, `api_authz_guards_test.rb`, `cable_access_reset_test.rb`, `channels_test.rb`, `checkpoint_submissions_test.rb`, `cohort_grading_test.rb`, `cohort_module_submission_windows_test.rb`, `cohort_workspaces_test.rb`, `communication_test.rb`, `community_safety_test.rb`, `course_expiration_test.rb`, `course_packages_test.rb`, `curriculum_resources_test.rb`, `curriculum_structure_api_test.rb`, `direct_conversation_titles_test.rb`, `endpoint_query_counts_test.rb`, `enrollment_restarts_test.rb`, `enrollments_and_module_access_test.rb`, `feature_switches_test.rb`, `guided_course_access_test.rb`, `help_requests_test.rb`, `home_base_digest_test.rb`, `intervention_workflows_test.rb`, `last_seen_throttle_test.rb`, `learner_capabilities_test.rb`, `learning_insights_test.rb`, `learning_plans_test.rb`, `lessons_api_test.rb`, `message_sources_test.rb`, `office_hours_test.rb`, `private_meetings_test.rb`, `record_related_test.rb`, `record_summaries_test.rb`, `recordings_test.rb`, `role_matrix_test.rb`, `rubrics_api_test.rb`, `self_paced_course_access_test.rb`, `slack_messaging_test.rb`, `student_progress_context_test.rb`, `submission_github_checks_test.rb`, `submissions_grading_test.rb`, `updates_test.rb`, `uploads_test.rb`, `user_handles_test.rb`, `users_index_pagination_test.rb`, `users_lifecycle_test.rb`, `weekly_plans_test.rb`, `workspace_authority_test.rb`.

### CurriculumModule

Existing direct/model references: `cohort_module_schedule_test.rb`, `cohort_module_submission_window_test.rb`, `content_block_test.rb`, `knowledge_check_test.rb`, `learning_objective_test.rb`, `lesson_test.rb`, `module_assignment_test.rb`, `progress_test.rb`, `rubric_test.rb`.

Existing integration references: `activity_history_test.rb`, `api_authz_guards_test.rb`, `checkpoint_submissions_test.rb`, `cohort_grading_test.rb`, `cohort_module_submission_windows_test.rb`, `cohort_workspaces_test.rb`, `course_expiration_test.rb`, `course_packages_test.rb`, `curriculum_structure_api_test.rb`, `endpoint_query_counts_test.rb`, `enrollment_restarts_test.rb`, `enrollments_and_module_access_test.rb`, `feature_switches_test.rb`, `guided_course_access_test.rb`, `help_requests_test.rb`, `home_base_digest_test.rb`, `intervention_workflows_test.rb`, `learner_capabilities_test.rb`, `learning_insights_test.rb`, `learning_plans_test.rb`, `lessons_api_test.rb`, `message_sources_test.rb`, `office_hours_test.rb`, `record_related_test.rb`, `record_summaries_test.rb`, `recordings_test.rb`, `role_matrix_test.rb`, `self_paced_course_access_test.rb`, `student_progress_context_test.rb`, `submission_github_checks_test.rb`, `submissions_grading_test.rb`, `uploads_test.rb`, `weekly_plans_test.rb`.

### CurriculumResource

Existing direct/model references: none.

Existing integration references: `curriculum_resources_test.rb`, `role_matrix_test.rb`.

### DataDeletionRequest

Existing direct/model references: none.

Existing integration references: `community_safety_test.rb`, `role_matrix_test.rb`.

### DirectConversation

Existing direct/model references: none.

Existing integration references: `agent_posting_test.rb`, `cohort_workspaces_test.rb`, `community_safety_test.rb`, `direct_conversation_titles_test.rb`, `endpoint_query_counts_test.rb`, `guided_course_access_test.rb`, `home_base_digest_test.rb`, `message_sources_test.rb`, `rate_limits_test.rb`, `record_related_test.rb`, `self_paced_course_access_test.rb`, `slack_messaging_test.rb`, `student_progress_context_test.rb`, `user_handles_test.rb`, `users_lifecycle_test.rb`, `workspace_authority_test.rb`.

### DirectConversationMember

Existing direct/model references: none.

Existing integration references: `home_base_digest_test.rb`, `slack_messaging_test.rb`.

### Enrollment

Existing direct/model references: `assignment_availability_test.rb`, `help_request_test.rb`, `lesson_test.rb`, `module_assignment_test.rb`.

Existing integration references: `activity_history_test.rb`, `agent_posting_test.rb`, `api_authz_guards_test.rb`, `channels_test.rb`, `checkpoint_submissions_test.rb`, `cohort_grading_test.rb`, `cohort_workspaces_test.rb`, `communication_test.rb`, `community_safety_test.rb`, `course_expiration_test.rb`, `course_packages_test.rb`, `curriculum_resources_test.rb`, `direct_conversation_titles_test.rb`, `endpoint_query_counts_test.rb`, `enrollment_restarts_test.rb`, `enrollments_and_module_access_test.rb`, `feature_switches_test.rb`, `guided_course_access_test.rb`, `help_requests_test.rb`, `home_base_digest_test.rb`, `intervention_workflows_test.rb`, `last_seen_throttle_test.rb`, `learner_capabilities_test.rb`, `learning_insights_test.rb`, `learning_plans_test.rb`, `lessons_api_test.rb`, `message_sources_test.rb`, `office_hours_test.rb`, `private_meetings_test.rb`, `record_related_test.rb`, `record_summaries_test.rb`, `recordings_test.rb`, `role_matrix_test.rb`, `self_paced_course_access_test.rb`, `slack_messaging_test.rb`, `student_progress_context_test.rb`, `submission_github_checks_test.rb`, `submissions_grading_test.rb`, `updates_test.rb`, `user_handles_test.rb`, `users_index_pagination_test.rb`, `users_lifecycle_test.rb`, `weekly_plans_test.rb`.

### EnrollmentRestart

Existing direct/model references: none.

Existing integration references: `enrollment_restarts_test.rb`.

### ExpoPushReceipt

Existing direct/model references: none.

Existing integration references: none found statically.

### FeatureSwitchChange

Existing direct/model references: none.

Existing integration references: `feature_switches_test.rb`.

### FeedbackSnippet

Existing direct/model references: none.

Existing integration references: `feedback_snippets_test.rb`.

### GithubCheckRun

Existing direct/model references: `github_check_run_test.rb`.

Existing integration references: `learning_insights_test.rb`, `submission_github_checks_test.rb`.

### HelpRequest

Existing direct/model references: `help_request_test.rb`.

Existing integration references: `endpoint_query_counts_test.rb`, `feature_switches_test.rb`, `help_requests_test.rb`, `home_base_digest_test.rb`, `learner_capabilities_test.rb`, `message_sources_test.rb`, `record_related_test.rb`, `record_summaries_test.rb`.

### HomeBaseToken

Existing direct/model references: `agent_posting_token_test.rb`.

Existing integration references: `agent_posting_test.rb`, `home_base_digest_test.rb`.

### Intervention

Existing direct/model references: none.

Existing integration references: `enrollment_restarts_test.rb`, `home_base_digest_test.rb`, `intervention_workflows_test.rb`, `record_related_test.rb`, `web_handoffs_test.rb`.

### InterventionNote

Existing direct/model references: none.

Existing integration references: none found statically.

### KnowledgeCheck

Existing direct/model references: `knowledge_check_test.rb`.

Existing integration references: `enrollment_restarts_test.rb`, `feature_switches_test.rb`, `learning_insights_test.rb`, `lessons_api_test.rb`.

### KnowledgeCheckAttempt

Existing direct/model references: none.

Existing integration references: `enrollment_restarts_test.rb`, `lessons_api_test.rb`.

### LearningObjective

Existing direct/model references: `learning_objective_test.rb`, `rubric_test.rb`.

Existing integration references: `learning_insights_test.rb`, `lessons_api_test.rb`, `role_matrix_test.rb`.

### LearningPlan

Existing direct/model references: none.

Existing integration references: `learning_plans_test.rb`.

### LearningPlanRevision

Existing direct/model references: none.

Existing integration references: none found statically.

### Lesson

Existing direct/model references: `cohort_module_submission_window_test.rb`, `content_block_test.rb`, `knowledge_check_test.rb`, `learning_objective_test.rb`, `lesson_test.rb`, `module_assignment_test.rb`, `progress_test.rb`, `rubric_test.rb`.

Existing integration references: `activity_history_test.rb`, `api_authz_guards_test.rb`, `checkpoint_submissions_test.rb`, `cohort_grading_test.rb`, `cohort_module_submission_windows_test.rb`, `cohort_workspaces_test.rb`, `course_expiration_test.rb`, `course_packages_test.rb`, `curriculum_structure_api_test.rb`, `endpoint_query_counts_test.rb`, `enrollment_restarts_test.rb`, `enrollments_and_module_access_test.rb`, `feature_switches_test.rb`, `guided_course_access_test.rb`, `help_requests_test.rb`, `home_base_digest_test.rb`, `intervention_workflows_test.rb`, `learner_capabilities_test.rb`, `learning_insights_test.rb`, `learning_plans_test.rb`, `lessons_api_test.rb`, `message_sources_test.rb`, `notification_destinations_test.rb`, `office_hours_test.rb`, `record_related_test.rb`, `record_summaries_test.rb`, `recordings_test.rb`, `role_matrix_test.rb`, `self_paced_course_access_test.rb`, `student_progress_context_test.rb`, `submission_github_checks_test.rb`, `submissions_grading_test.rb`, `uploads_test.rb`, `web_handoffs_test.rb`, `weekly_plans_test.rb`.

### LessonAssignment

Existing direct/model references: `lesson_test.rb`.

Existing integration references: `activity_history_test.rb`, `api_authz_guards_test.rb`, `cohort_workspaces_test.rb`, `enrollment_restarts_test.rb`, `enrollments_and_module_access_test.rb`, `learning_plans_test.rb`, `message_sources_test.rb`, `self_paced_course_access_test.rb`, `student_progress_context_test.rb`.

### Message

Existing direct/model references: `provider_email_provenance_test.rb`.

Existing integration references: `agent_posting_test.rb`, `channels_test.rb`, `cohort_workspaces_test.rb`, `community_safety_test.rb`, `endpoint_query_counts_test.rb`, `home_base_digest_test.rb`, `message_sources_test.rb`, `rate_limits_test.rb`, `record_related_test.rb`, `self_paced_course_access_test.rb`, `slack_messaging_test.rb`, `student_progress_context_test.rb`, `users_lifecycle_test.rb`, `workspace_authority_test.rb`.

### MessageAttachment

Existing direct/model references: none.

Existing integration references: `slack_messaging_test.rb`.

### MessageDeliveryLockRecord

Existing direct/model references: none.

Existing integration references: none found statically.

### MessagePreference

Existing direct/model references: none.

Existing integration references: `slack_messaging_test.rb`.

### MessageReaction

Existing direct/model references: none.

Existing integration references: `slack_messaging_test.rb`, `student_progress_context_test.rb`.

### MessageReadCursor

Existing direct/model references: none.

Existing integration references: none found statically.

### MobilePushToken

Existing direct/model references: `mobile_push_token_test.rb`.

Existing integration references: `clerk_identity_transition_test.rb`, `mobile_push_tokens_test.rb`, `users_lifecycle_test.rb`.

### ModuleAssignment

Existing direct/model references: `lesson_test.rb`, `module_assignment_test.rb`.

Existing integration references: `activity_history_test.rb`, `api_authz_guards_test.rb`, `checkpoint_submissions_test.rb`, `cohort_grading_test.rb`, `cohort_workspaces_test.rb`, `course_expiration_test.rb`, `course_packages_test.rb`, `endpoint_query_counts_test.rb`, `enrollment_restarts_test.rb`, `enrollments_and_module_access_test.rb`, `feature_switches_test.rb`, `guided_course_access_test.rb`, `help_requests_test.rb`, `intervention_workflows_test.rb`, `learner_capabilities_test.rb`, `learning_plans_test.rb`, `lessons_api_test.rb`, `message_sources_test.rb`, `office_hours_test.rb`, `record_related_test.rb`, `record_summaries_test.rb`, `recordings_test.rb`, `role_matrix_test.rb`, `self_paced_course_access_test.rb`, `student_progress_context_test.rb`, `submissions_grading_test.rb`, `weekly_plans_test.rb`.

### Notification

Existing direct/model references: `provider_email_provenance_test.rb`.

Existing integration references: `agent_posting_test.rb`, `channels_test.rb`, `communication_test.rb`, `community_safety_test.rb`, `endpoint_query_counts_test.rb`, `enrollment_restarts_test.rb`, `help_requests_test.rb`, `intervention_workflows_test.rb`, `last_seen_throttle_test.rb`, `notification_destinations_test.rb`, `private_meetings_test.rb`, `role_matrix_test.rb`, `slack_messaging_test.rb`, `updates_test.rb`, `workspace_authority_test.rb`.

### ObjectiveAlignment

Existing direct/model references: `learning_objective_test.rb`.

Existing integration references: `learning_insights_test.rb`, `lessons_api_test.rb`, `role_matrix_test.rb`.

### OfficeHour

Existing direct/model references: `office_hour_test.rb`.

Existing integration references: `feature_switches_test.rb`, `learning_plans_test.rb`, `office_hours_test.rb`, `record_summaries_test.rb`.

### PrivateMeetingBooking

Existing direct/model references: none.

Existing integration references: `home_base_digest_test.rb`, `private_meetings_test.rb`, `self_paced_course_access_test.rb`.

### PrivateMeetingBookingEvent

Existing direct/model references: none.

Existing integration references: `private_meetings_test.rb`.

### PrivateMeetingConfig

Existing direct/model references: none.

Existing integration references: `private_meetings_test.rb`, `self_paced_course_access_test.rb`.

### PrivateMeetingSlot

Existing direct/model references: none.

Existing integration references: `home_base_digest_test.rb`, `private_meetings_test.rb`, `self_paced_course_access_test.rb`.

### Progress

Existing direct/model references: `progress_test.rb`.

Existing integration references: `activity_history_test.rb`, `api_authz_guards_test.rb`, `checkpoint_submissions_test.rb`, `cohort_grading_test.rb`, `cohort_workspaces_test.rb`, `endpoint_query_counts_test.rb`, `enrollment_restarts_test.rb`, `feature_switches_test.rb`, `learning_plans_test.rb`, `lessons_api_test.rb`, `record_summaries_test.rb`, `recordings_test.rb`, `role_matrix_test.rb`, `self_paced_course_access_test.rb`, `student_progress_context_test.rb`, `submissions_grading_test.rb`.

### PushSubscription

Existing direct/model references: none.

Existing integration references: `clerk_identity_transition_test.rb`, `communication_test.rb`, `users_lifecycle_test.rb`.

### Recording

Existing direct/model references: `recording_test.rb`.

Existing integration references: `activity_history_test.rb`, `communication_test.rb`, `course_expiration_test.rb`, `enrollment_restarts_test.rb`, `feature_switches_test.rb`, `help_requests_test.rb`, `record_related_test.rb`, `record_summaries_test.rb`, `recordings_test.rb`, `uploads_test.rb`, `web_handoffs_test.rb`.

### RecoveryPlan

Existing direct/model references: none.

Existing integration references: `home_base_digest_test.rb`, `intervention_workflows_test.rb`, `record_related_test.rb`.

### RecoveryPlanCheckIn

Existing direct/model references: none.

Existing integration references: none found statically.

### Rubric

Existing direct/model references: `rubric_test.rb`.

Existing integration references: `learning_insights_test.rb`, `lessons_api_test.rb`, `record_related_test.rb`, `role_matrix_test.rb`, `rubrics_api_test.rb`, `submissions_grading_test.rb`.

### RubricCriterion

Existing direct/model references: none.

Existing integration references: `learning_insights_test.rb`, `lessons_api_test.rb`, `record_related_test.rb`, `role_matrix_test.rb`, `rubrics_api_test.rb`, `submissions_grading_test.rb`.

### SchoolSetting

Existing direct/model references: none.

Existing integration references: `feature_switches_test.rb`, `record_related_test.rb`.

### Submission

Existing direct/model references: `rubric_test.rb`.

Existing integration references: `activity_history_test.rb`, `api_authz_guards_test.rb`, `checkpoint_submissions_test.rb`, `cohort_grading_test.rb`, `cohort_module_submission_windows_test.rb`, `cohort_workspaces_test.rb`, `endpoint_query_counts_test.rb`, `enrollment_restarts_test.rb`, `feature_switches_test.rb`, `help_requests_test.rb`, `home_base_digest_test.rb`, `intervention_workflows_test.rb`, `learner_capabilities_test.rb`, `learning_insights_test.rb`, `learning_plans_test.rb`, `lessons_api_test.rb`, `message_sources_test.rb`, `record_related_test.rb`, `record_summaries_test.rb`, `role_matrix_test.rb`, `student_progress_context_test.rb`, `submission_github_checks_test.rb`, `submissions_grading_test.rb`, `web_handoffs_test.rb`.

### SubmissionCriterionResult

Existing direct/model references: `rubric_test.rb`.

Existing integration references: `learning_insights_test.rb`, `submissions_grading_test.rb`.

### User

Existing direct/model references: `admin_continuity_test.rb`, `agent_posting_token_test.rb`, `assignment_availability_test.rb`, `clerk_identity_test.rb`, `help_request_test.rb`, `knowledge_check_test.rb`, `lesson_test.rb`, `mobile_push_token_test.rb`, `module_assignment_test.rb`, `progress_test.rb`, `provider_email_provenance_test.rb`, `rubric_test.rb`, `user_invite_state_test.rb`, `user_record_seen_test.rb`, `workspace_test.rb`.

Existing integration references: `activity_history_test.rb`, `agent_posting_test.rb`, `api_authz_guards_test.rb`, `cable_access_reset_test.rb`, `channels_test.rb`, `checkpoint_submissions_test.rb`, `clerk_identity_transition_test.rb`, `cohort_grading_test.rb`, `cohort_module_submission_windows_test.rb`, `cohort_workspaces_test.rb`, `communication_test.rb`, `community_safety_test.rb`, `course_expiration_test.rb`, `course_packages_test.rb`, `curriculum_resources_test.rb`, `curriculum_structure_api_test.rb`, `direct_conversation_titles_test.rb`, `endpoint_query_counts_test.rb`, `enrollment_restarts_test.rb`, `enrollments_and_module_access_test.rb`, `feature_switches_test.rb`, `feedback_snippets_test.rb`, `guided_course_access_test.rb`, `help_requests_test.rb`, `home_base_digest_test.rb`, `intervention_workflows_test.rb`, `last_seen_throttle_test.rb`, `learner_capabilities_test.rb`, `learning_insights_test.rb`, `learning_plans_test.rb`, `lessons_api_test.rb`, `message_sources_test.rb`, `mobile_push_tokens_test.rb`, `notification_destinations_test.rb`, `office_hours_test.rb`, `private_meetings_test.rb`, `rate_limits_test.rb`, `record_related_test.rb`, `record_summaries_test.rb`, `recordings_test.rb`, `role_matrix_test.rb`, `rubrics_api_test.rb`, `self_paced_course_access_test.rb`, `slack_messaging_test.rb`, `student_progress_context_test.rb`, `submission_github_checks_test.rb`, `submissions_grading_test.rb`, `transcriptions_test.rb`, `updates_test.rb`, `uploads_test.rb`, `user_handles_test.rb`, `users_index_pagination_test.rb`, `users_lifecycle_test.rb`, `web_handoffs_test.rb`, `weekly_plans_test.rb`, `workspace_authority_test.rb`.

### UserBlock

Existing direct/model references: none.

Existing integration references: `agent_posting_test.rb`, `community_safety_test.rb`, `home_base_digest_test.rb`, `learner_capabilities_test.rb`, `slack_messaging_test.rb`.

### WatchProgress

Existing direct/model references: none.

Existing integration references: `course_expiration_test.rb`, `enrollment_restarts_test.rb`, `recordings_test.rb`.

### Workspace

Existing direct/model references: `workspace_test.rb`.

Existing integration references: `agent_posting_test.rb`, `channels_test.rb`, `course_expiration_test.rb`, `home_base_digest_test.rb`, `record_related_test.rb`, `slack_messaging_test.rb`, `student_progress_context_test.rb`, `user_handles_test.rb`, `workspace_authority_test.rb`.

### WorkspaceMembership

Existing direct/model references: none.

Existing integration references: `agent_posting_test.rb`, `channels_test.rb`, `course_expiration_test.rb`, `slack_messaging_test.rb`, `workspace_authority_test.rb`.

## Findings and limits

- No production changes. One skipped regression in `user_test.rb`: `User.messages` uses `dependent: :nullify`, but `messages.author_id` is NOT NULL. A hard delete of an author raises `ActiveRecord::NotNullViolation` (observed while testing uploader deletion; source: `User.messages` in `api/app/models/user.rb` and the `messages.author_id` declaration in `api/db/schema.rb`). Resolve the historical-author retention policy before changing the association or schema. Other tested destroy/nullify/restrict paths pass.
- CHECK and unique-index tests use validation-bypassing `update_columns` inside savepoints. Rails also normalizes handles on that path, so the lowercase CHECK uses a quoted SQL UPDATE instead. Meeting overlap tests cover PostgreSQL exclusion constraints.
- `database_integrity_test.rb` adds cross-model cases beyond the named-file counts, including progress, cohort terms, module schedules/assignments, Clerk identity, assistant tokens, objectives, and meeting slots.
- New shared test setup freezes time at 2026-04-06 00:05 ChST (2026-04-05 14:05 UTC); deadline tests use explicit travel. Existing scheduling tests already cover DST recurrence; new enrollment and private meeting tests cover Guam midnight.
- Local lifecycle automation is unavailable: `dev-lifecycle begin` rejects the installed machine profile (`schema_version must be 1`). No application server/browser/container was started. Task database cleanup is tracked manually.

## Validation

Results are recorded in the PR after running the final gates. Baseline uses the original test paths on an empty schema, excluding all new tests; no seeds are loaded. `PARALLEL_WORKERS=1`, Ruby 3.3.7, local PostgreSQL 16. No external credentials or production data.
