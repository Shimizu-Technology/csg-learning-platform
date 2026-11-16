# CSG Learning Platform — API Reference

**Base URL:** `/api/v1/`
**Auth:** All endpoints require a valid Clerk JWT in the `Authorization: Bearer <token>` header unless noted otherwise.
**Content-Type:** `application/json`

---

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/up` | None | Rails health check (200 if app is running) |
| `GET` | `/health` | None | Database-free process health check used by Render: `{"status":"ok"}` |
| `GET` | `/api/v1/ready` | None | Manual PostgreSQL and background-worker readiness diagnostic |

---

## Authentication

### `POST /api/v1/sessions`

Syncs an invited user record from the Clerk JWT. Production access is invite-only: the Clerk identity must already match an active CSG user by Clerk ID or email address.

**Request:** No body required — user info is extracted from the JWT.

Every authenticated request records activity in `users.last_seen_at`, at most once a minute per user (one conditional `UPDATE`, so concurrent requests write once). `POST /api/v1/presence`, the web app's heartbeat, always records the current time and broadcasts it on `PresenceChannel` to the staff who can see that user: admins, and the instructors assigned to one of the user's cohorts (`presence:cohort:<id>`; admins stream `presence:admins`). Students cannot subscribe. Streams are chosen when the subscription starts; changing a user's role, archiving or restoring them, or adding or removing a cohort assignment closes that user's cable connections, and the client reconnects with a fresh token so every channel re-authorizes. A connection is refused for an archived user. The payload is `{ event: "presence.updated", user_id, last_seen_at }`. Staff presence shows "online" for two minutes after `last_seen_at`.

**Response:**
```json
{
  "user": {
    "id": 1,
    "email": "student@example.com",
    "first_name": "Kevin",
    "last_name": "Santos",
    "role": "student",
    "github_username": "kevinsantos",
    "avatar_url": "https://...",
    "last_sign_in_at": "2026-04-07T10:00:00Z"
  }
}
```

**Access-denied response (`403`):**
```json
{
  "error": "This account does not have access to CSG Learning yet. Ask a Code School administrator to invite this email address.",
  "code": "account_not_authorized"
}
```

Archived users receive the same status with `code: "account_archived"`. Missing, invalid, and expired Clerk JWTs remain `401` responses.

A new verified Clerk session with a `sid` creates one sign-in history event and updates `last_sign_in_at`. Refreshing the same session does neither. Tokens without `sid` do not create a sign-in event.

### `GET /api/v1/activity_events`

Returns paginated account and learning history. Optional query parameters: `user_id`, `category` (`account`, `learning`, `work`, or `content`; content audit events such as `lesson_editing_granted`/`lesson_editing_revoked` appear only when `category=content` or that `event_type` is requested), `cohort_id`, `before_id`, and `limit` (up to 100, default 40). Members can read their own history; instructors can read students' history; administrators can read any member's history. Each event includes a timestamp, actor, event type, record reference and current label when available, cohort, and evidence label. Video evidence is `player_reported`.

### `POST /api/v1/web_handoffs`

Creates a one-time, 60-second Clerk sign-in link for an allowlisted responsive-web destination. Mobile uses this for browser-shaped tools without placing the device session JWT in a URL. All signed-in users may hand off to numeric lesson and module paths. Staff may also hand off to allowlisted student workspaces, submission/help/intervention records, cohort operations, grading, content, and team destinations. For example:

```json
{ "destination": "/lessons/42" }
```

The response contains a Clerk Account Portal URL whose post-authentication redirect is resolved from `PUBLIC_FRONTEND_URL`. External, malformed, and unsupported destinations are rejected.

---

## Profile

### `GET /api/v1/profile`

Returns the current authenticated user's profile.

### `PATCH /api/v1/profile`

Updates the current user's profile.

**Body:**
```json
{
  "user": {
    "first_name": "Kevin",
    "last_name": "Santos",
    "github_username": "kevinsantos"
  }
}
```

`handle` (optional) is the person's @handle, shown next to their name in pickers,
@mention suggestions and people search so same-name people can be told apart
without emails. It is stored lowercase (a leading `@` is dropped; the database
rejects any uppercase handle), must be unique regardless of case,
3–30 letters, numbers or underscores starting with a letter or number, and can't
be a reserved word such as `everyone` or `here`. A blank value clears it. Invalid
or taken handles return `422` with `errors`. Picker and member payloads
(`available_users`, workspace members, users) include `handle`.

---

## Records

### `GET /api/v1/records/:type/:id/summary`

What a peek card shows (L-0.5) for `type` `student` (a user id), `lesson` or
`cohort`, with optional `cohort_id`. Returns `{ summary: { type, id, title,
subtitle, facts: [{ key, label, value, kind, attention }], ... } }` with four
facts. Staff see learners and cohorts in cohorts they can access (admins: all)
and lessons with counts limited to those cohorts. Students may peek only at
lessons they can open, and see only their own work. Anything the viewer can't
open, an unknown type, or a missing record returns `404` (never `403`), so the
response never confirms a record exists. A learner's lesson is checked with
`LessonReadAccess.lookup`, which reads only the lesson's schedule columns and
the learner's own enrollment and assignments, so a lesson they can't open costs
at most one query more than a missing one and its title never loads. Sent with
`Cache-Control: private, no-store`.

### `GET /api/v1/records/:type/:id/related`

A record page's related panel and breadcrumb names (L-0.4), in one request.
`type` is `submission`, `help_request`, `intervention` (follow-up plan),
`lesson`, `student` (a user id; `cohort_id` required, since a student page is
one enrollment) or `cohort`. Returns
`{ related: { type, id, view?, context: { cohort?, student?, lesson?, module? }, items: [{ key, count, value, ...ids }] } }`.

| Type | Item keys |
| --- | --- |
| `submission` | `lesson`, `module_grid`, `rubric` (when the exercise has one), `other_attempts`, `help`, `conversation` |
| `help_request` | `lesson` or `recording`, `follow_up`, `conversation`, `other_requests` |
| `intervention` | `evidence`, `recovery_plan`, `help_request`, `conversation` |
| `lesson` (learner view) | `your_work`, `help`, `recordings` |
| `lesson` (staff view) | `waiting_review`, `open_help`, `recordings` (with `cohort_id`), `used_in` (without) |
| `student` | `cohort`, `help_requests`, `follow_ups`, `conversation`, `meetings`, `other_enrollments` |
| `cohort` | `students`, `waiting_review`, `open_help`, `follow_ups`, `recordings`, `updates` |

Items carry counts, short values (a status, a name the viewer can already
see) and the ids the web app needs to build links; never message text,
answers or feedback. Every count stays inside the record's cohort and
enrollment (a learner's attempts or help in another cohort are never counted).
Rows for a feature switched off for the cohort, by its effective switches
including cohort overrides (`help_requests`, `interventions`, `recordings`,
`private_meetings`, `announcements`), are left out; an unscoped staff lesson
counts open help only in cohorts with help on, and drops the row when none
has it. The record is authorized from its cohort id (a learner's lesson from
its schedule columns, via `LessonReadAccess.lookup`) before anything else
loads, so a record the viewer can't open costs at most one query more than a
missing one. `conversation` is the viewer's own direct
conversation with the learner, or `direct_conversation_id: null` when there
isn't one yet. Staff see records in cohorts they can access (admins: all).
Students see only lessons they can open, with their own work and help; staff
can pass `cohort_id` and `student_id` to see one enrolled learner's lesson rows
in a cohort they can access (View as student). Everything else returns `404`,
as for summaries. Sent with `Cache-Control: private, no-store`.

---

## Dashboard

### `GET /api/v1/dashboard`

Returns role-appropriate dashboard data.

**Student response:** Current cohort, pinned/unread announcements, unread notification count, modules with progress and unlock state, next lesson, current redo items, latest passing grades, resources, and upcoming office hours.

**Staff response:** All active cohorts with student progress and activity signals. Each student summary includes `ungraded_count` and `redo_count`; each cohort and the backward-compatible top-level summary include the total ungraded count.

**One status source (U-0.5, T-3).** Every learner count and status on every staff and learner surface comes from the same two services, so the Students list, the student page, cohort home, the attention list (Support), Today, Learn, the student preview and peek cards report identical numbers:

- `LearnerProgress` (`api/app/services/learner_progress.rb`) decides counts and statuses: `completed_blocks`/`total_blocks`/`progress_percentage` count steps handed in (work waiting for review counts; a redo doesn't, even when an old progress record says completed), and `completed_lessons`/`total_lessons` count whole lessons. Staff lists use `LearnerProgress.for_all`, which loads any number of learners in a fixed number of queries.
- `LearnerActivity` (`api/app/services/learner_activity.rb`) decides "last active": the learner's own learning activity in that enrollment (submissions, their own activity events, retrieval-check attempts). Sign-ins, app presence (`last_seen_at`) and staff grading don't count. Rows carry it as `last_activity_at`; the student page and cohort roster as `last_active_at`.
- "Behind" means the attention list (`AttentionProjection`, see `docs/SUPPORT_WORKFLOW.md`). Each row's `needs_attention`, `reasons` and `status_label` ("On track", "Going quiet", "Work to review", ...) are the one status; clients never derive their own.

Lesson counts, `status_label` and `last_active_at` are additive; older payloads omit them.

```json
{
  "dashboard": {
    "user": { "id": 1, "full_name": "Leon Shimizu", "role": "admin" },
    "cohort": { "id": 3, "name": "Cohort 3", "start_date": "2026-03-31" },
    "students": [
      {
        "user_id": 2,
        "full_name": "Kevin Santos",
        "progress_percentage": 45.5,
        "completed_blocks": 58,
        "total_blocks": 128,
        "completed_lessons": 31,
        "total_lessons": 64,
        "last_activity_at": "2026-04-06T15:30:00Z",
        "needs_attention": true,
        "status_label": "Work to review",
        "ungraded_count": 2,
        "redo_count": 1,
        "enrollment_status": "active"
      }
    ],
    "ungraded_count": 5,
    "cohorts": [ "..." ]
  }
}
```

### `GET /api/v1/weekly_plan`

Returns the authenticated student’s shared web/native **This Week** projection. Staff receive `403`; students without an active enrollment receive `{ "enrolled": false }`.

The `Pacific/Guam` Monday–Sunday projection contains:

- required and optional lessons, including incomplete work carried forward from earlier weeks;
- completion/open/upcoming/closed state and any submission close instant;
- the latest open redo per assignment;
- one-time or recurring live-class and office-hour occurrences;
- the next lesson unlocks and up to three incomplete class recordings;
- content-free summary counts used by `weekly_plan_viewed` analytics.

Clients should link lesson, recording, and meeting actions from the provided typed IDs/URLs and cache the projection only inside the signed-in user’s existing scoped cache.

### Contextual help and staff support

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/help_requests` | Signed-in user | Students list their own requests; staff list all. Optional `cohort_id`, valid `status`, and valid `context_type` filters apply; staff may also filter by `student_id`. |
| `GET` | `/api/v1/help_requests/:id` | Owner student / Staff | Return one stable help-request record with its authorized student, cohort, learning context, ownership, status, and response relationships. Requests outside the caller's scope return `404`. |
| `POST` | `/api/v1/help_requests` | Student | Create one active request for an authorized lesson, exercise, uploaded recording, or legacy recording. Duplicate active context returns the existing record with `created: false`. |
| `PATCH` | `/api/v1/help_requests/:id` | Owner student / Staff | Students may cancel active requests. Staff may acknowledge or resolve; resolution requires a nonblank `staff_response`. |
| `GET` | `/api/v1/support_queue` | Staff | Return active requests, recent resolutions, summary counts, and explainable redo/ungraded/inactivity student signals. |

Create input is nested under `help_request` and includes `cohort_id`, `context_type` (`lesson`, `exercise`, or `recording`), `context_source` (`primary` or legacy recordings only), numeric `context_id`, `category`, `urgency`, and `message`. The server re-resolves the context label/path and rechecks active enrollment, curriculum, assignment, release, and recording ownership; clients cannot choose those display values.

States are `open`, `acknowledged`, `resolved`, and `canceled`. Terminal records cannot be reopened. Notifications omit authored request text. See `SUPPORT_WORKFLOW.md` for the product and operating contract.

---

## Hub Endpoints

### `GET /api/v1/recordings`

Returns one normalized `items` list. Students receive published recordings across their active cohort enrollments; staff receive draft and published recordings across all active and upcoming cohorts. Each first-class item has a numeric `id`, stable `item_key`, cohort, status, recording date, media metadata, and `source` (`uploaded`, `youtube`, `vimeo`, `loom`, `direct`, or `external`). Students also receive their watch progress for every first-class source. Unmigrated settings links may temporarily appear with a synthetic string ID and do not support progress.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/cohorts/:cohort_id/recordings` | Staff | Creates an uploaded recording from managed-upload metadata, or a hosted recording from an HTTPS `source_url` |
| `PATCH` | `/api/v1/cohorts/:cohort_id/recordings/:id` | Staff | Updates recording details, status, and the URL/provider of a hosted recording |
| `DELETE` | `/api/v1/cohorts/:cohort_id/recordings/:id` | Staff | Deletes a recording; managed uploaded media is cleaned up asynchronously |
| `GET` | `/api/v1/cohorts/:cohort_id/recordings/:id/stream_url` | Staff or active cohort member | Returns a `stream_url` valid for up to two hours, capped by the learner enrollment deadline, and ISO 8601 `expires_at` for uploaded media; hosted recordings return `422` |
| `PATCH` | `/api/v1/watch_progress` | Staff or active cohort member | Saves monotonic watch time and resume position; completes at 90% |
| `GET` | `/api/v1/content_blocks/:id/video_stream` | Authorized lesson viewer | Returns a lesson-video `stream_url` valid for up to two hours, capped by the learner enrollment deadline, plus `expires_at` and current progress |
| `PATCH` | `/api/v1/content_blocks/:id/video_progress` | Authorized lesson viewer | Saves authoritative lesson-video progress |
| `POST` | `/api/v1/content_blocks/:id/video_presign` | Staff | Presigns a normal upload for an existing lesson video block |
| `POST` | `/api/v1/video_presign` | Staff | Presigns a normal upload before a lesson video block exists |
| `POST` | `/api/v1/uploads/multipart/initiate` | Staff | Starts a large recording or lesson-video upload using `cohort_id` or `content_block_id` |
| `POST` | `/api/v1/uploads/multipart/part_url` | Staff | Presigns one validated multipart upload part |
| `POST` | `/api/v1/uploads/multipart/complete` | Staff | Completes a multipart upload from ordered part ETags |
| `DELETE` | `/api/v1/uploads/multipart/abort` | Staff | Aborts an unfinished multipart upload |
| `DELETE` | `/api/v1/uploads/abandon` | Staff | Deletes an unreferenced managed upload after an editor or create failure |
| `GET` | `/api/v1/watch_progress/student/:user_id` | Staff | Returns recording progress for the student's active enrollments, or the exact enrolled cohort when `cohort_id` is provided |
| `GET` | `/api/v1/watch_progress/student/:user_id/lesson_videos` | Staff | Returns curriculum lesson-video progress for active enrollments, or the exact enrolled cohort when `cohort_id` is provided |

Signed URLs are temporary secrets. Clients should renew before `expires_at`, avoid logging or persisting them, and retain playback position when renewing a URL for the same source. Replacing the hosted video resets watch progress for the new file.

### `GET /api/v1/resources`

Students receive resources/links for their active cohort. Staff receive resources across all active and upcoming cohorts; each item includes `cohort_id` and `cohort_name` and uses a cross-cohort-safe synthetic ID.

---

## Users (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/users` | Staff | List users; supports `role`, admin-only `include_archived`, `include_enrollments`, and `people_search` (enrolled learners only; excludes blocked relationships in both directions while retaining staff cohort access scope). Returns the full list by default; pass `page` and/or `per_page` (default 50, max 100) to get one page plus a `meta` block (`page`, `per_page`, `total_count`, `total_pages`, `has_next_page`, `has_prev_page`) |
| `GET` | `/api/v1/users/:id` | Staff | Show user details |
| `POST` | `/api/v1/users` | Admin | Create user (sends Clerk invite) |
| `PATCH` | `/api/v1/users/:id` | Admin | Update user |
| `DELETE` | `/api/v1/users/:id` | Admin | Archive user; hard-delete only unused pending invites |
| `POST` | `/api/v1/users/:id/resend_invite` | Admin | Resend Clerk invitation email |
| `PATCH` | `/api/v1/users/:id/unarchive` | Admin | Restore archived user; re-sends invite when still pending |

Archived users are hidden from default user lists, team management, active cohort/member lists, messaging pickers, and notification recipients. Their historical messages, announcements, and records remain attached for audit/history. Admins can pass `include_archived=true` to `GET /api/v1/users` when they need to inspect archived accounts.

Pagination on `GET /api/v1/users` is opt-in because every current web and mobile caller, including installed mobile builds, reads the whole list. Pages are ordered by last name, first name, then id, so they walk the same order as the full list.

**Create body:**
```json
{
  "user": {
    "email": "student@example.com",
    "first_name": "Kevin",
    "last_name": "Santos",
    "role": "student"
  }
}
```

---

## Curricula (Staff/Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/curricula` | Staff | List all curricula |
| `GET` | `/api/v1/curricula/:id` | Staff | Show curriculum with modules |
| `POST` | `/api/v1/curricula` | Admin | Create curriculum |
| `PATCH` | `/api/v1/curricula/:id` | Admin | Update curriculum |
| `DELETE` | `/api/v1/curricula/:id` | Admin | Delete curriculum |

---

## Modules

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/curricula/:curriculum_id/modules` | Staff | List modules in curriculum |
| `POST` | `/api/v1/curricula/:curriculum_id/modules` | Admin | Create module |
| `GET` | `/api/v1/modules/:id` | Authenticated | Show module with lessons |
| `PATCH` | `/api/v1/modules/:id` | Admin | Update module |
| `DELETE` | `/api/v1/modules/:id` | Admin | Delete module |

**Create/Update body:**
```json
{
  "curriculum_module": {
    "name": "Prework",
    "module_type": "prework",
    "position": 1,
    "day_offset": 0,
    "total_days": 35,
    "schedule_days": "weekdays",
    "description": "Pre-class exercises and videos"
  }
}
```

---

## Lessons

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/modules/:module_id/lessons` | Staff | List lessons in module |
| `POST` | `/api/v1/modules/:module_id/lessons` | Staff | Create lesson |
| `POST` | `/api/v1/modules/:module_id/exercises` | Staff | Create exercise lesson (shorthand) |
| `GET` | `/api/v1/lessons/:id` | Authenticated | Show lesson with content blocks |
| `PATCH` | `/api/v1/lessons/:id` | Staff | Update lesson |
| `PATCH` | `/api/v1/lessons/:id/editor` | Staff | Atomically update lesson details, video/exercise blocks, learning design, and hosted-video metadata using `base_updated_at`. Replacing a video (hosted upload or link) that students have progress on returns 422 ("Students have watched this video. Replace it from the web lesson editor…") unless `editor.video.confirm_watch_reset` is `true`, which resets that progress |
| `GET` | `/api/v1/lessons/:id/block_editor` | Staff | Every block in order (LessonDetail), learner work per block (`block_activity`), and editor context: curriculum, module schedule days, cohorts using the curriculum, submission and help counts, and `access` (see Lesson editing access below) |
| `PUT` | `/api/v1/lessons/:id/block_editor` | Lesson editing access | Save the whole lesson in one transaction: settings, every block in order (`id` for saved blocks, `client_id` for new ones), `removed_block_ids` and objective alignments. Block ids are kept on reorder. `409 stale_editor` when `base_updated_at` isn't current; `422` with `learner_data` (removing or retyping a block that has learner work), `learner_access` (a `release_day` change that learners with work in the lesson couldn't open yet, by the same rule as `POST /lessons/:id/move`), `confirm_watch_reset` (replacing a video that students have progress on without listing it in `confirm_watch_reset_block_ids`; the response's `block_ids` names those blocks) or `blocks_mismatch` (an existing block missing from both lists), and `retry` when the save collided with learner writes and nothing was saved. At most 20 blocks. Every other path that changes blocks (`/content_blocks`, `PATCH /editor`, objective alignments, course package import) locks the lesson and advances its version, so a later `PUT` from an older version gets `409`. The mobile editor keeps using `PATCH /editor` |
| `POST` | `/api/v1/lessons/:id/move` | Admin | Move to a day and place (`module_id`, `release_day`, `position` within that day's active lessons, `base_updated_at`) in any module of the same curriculum. The lesson and block ids don't change, so learner data stays attached. `dry_run: true` returns `impact` only (`learners_losing_access`, `learners_with_work_losing_access`, `learners_gaining_access`, `self_paced_learners`). `expected_impact` sends back the impact the person confirmed from a dry run of the same parameters; the move recomputes it under its locks and returns `422 impact_changed` with the new `impact` when it differs. `409 stale_editor`; `422` with `module_mismatch`, `release_day` (not a day the module meets), `archived`, `learner_access` (learners with work in the lesson couldn't open it at the new place today; access is decided with the lesson page's rule: module and lesson assignments, module schedules and overrides, paused learners' read cutoffs), `impact_changed` or `retry` |
| `POST` | `/api/v1/lessons/:id/duplicate` | Admin | Copy the lesson, its blocks, retrieval checks and objective alignments as new rows (201). The copy starts archived on the same day; no learner data is copied. Hosted videos are shared by key |
| `DELETE` | `/api/v1/lessons/:id` | Admin | Delete lesson |

### Lesson editing access

Lesson editing is admin-only unless an admin gives an instructor editing access for a cohort: `PATCH /api/v1/cohorts/:cohort_id/instructor_assignments/:user_id/lesson_editing` with `{ "can_edit_lessons": true | false }` (admins; records `lesson_editing_granted` or `lesson_editing_revoked`). The grant lives on the instructor's cohort assignment, so removing them from the cohort removes it (and records a revoke). `GET /api/v1/cohorts/:cohort_id/instructor_assignments` returns `can_edit_lessons`, `edit_granted_by` and `edit_granted_at` per instructor.

An instructor may change a curriculum's lessons only when every cohort that uses the curriculum (any status) is one they have editing access for. Otherwise they read it: `access.reason` is `shared` (with `shared_with` listing the other cohorts) or `no_grant`. This applies to `PUT /block_editor`, `PATCH /lessons/:id/editor` (installed mobile builds), `POST /lessons/:lesson_id/content_blocks`, `PATCH`/`DELETE /content_blocks/:id`, `POST /content_blocks/:id/video_presign`, `PATCH /lessons/:lesson_id/objective_alignments`, and `POST /learning_objectives` and `POST /rubrics` for that curriculum. Refusals are `403` with `code` `lesson_editing_not_granted` or `curriculum_shared` and a message clients show as is. `POST /video_presign` and content-video multipart uploads need editing access for at least one cohort. Writes re-check access inside their transaction, under `FOR SHARE` on the curriculum row and then the grant rows (lock order in `Curriculum.lock_for_content!`), so a revoke, or a cohort joining or leaving the curriculum, waits for a save already in flight and refuses every later one. `POST /learning_objectives` with `lesson_id` aligns the new objective under the lesson's authoring lock and advances the lesson's version. Reads stay open to all staff: an instructor without editing access still gets the full editor payload, solutions included, read-only, as they do when grading. Lesson structure (create, settings, archive, restore, move, duplicate, delete) stays admin-only. `GET /curricula/:id` includes the same `editing` object for the signed-in staff member.

### Make a copy for this cohort

When other cohorts share a curriculum, a cohort can get its own copy (README §12, decision 1). Admins can copy for any cohort on a shared curriculum; an instructor can copy for the cohorts their editing access covers while `access.reason` is `shared`. `access.copy_cohorts` lists the cohorts the viewer can copy for, and `access.copy_of` names the cohort and source when the curriculum is already a cohort's copy.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/v1/cohorts/:cohort_id/curriculum_copy?source_curriculum_id=` | Staff | Dry run: per-table counts of what the copy creates and moves, the cohorts keeping the shared version, and blockers (`can_copy` false while any remain). `403 not_allowed` for staff who can't copy for that cohort |
| `POST` | `/api/v1/cohorts/:cohort_id/curriculum_copy` | Staff | `{ "source_curriculum_id": n }`. Copies the curriculum and moves the cohort and its learner data to it in one transaction; `201`, or `200` with `already_copied` when an earlier request made it. Returns `lesson_ids` (old → new). `422` codes: `copy_not_needed`, `source_missing`, `source_archived`, `copied_before`, `unassigned_learner_work`, `media_missing`, `media_changed`, `verification_failed`, `invalid`. `409` `busy` when the copy waited more than 5 s on someone else's lock (an author's save, a learner write) or a statement ran past 30 s: nothing was copied, and the same request can be repeated. `409` `content_moved` when the cohort no longer uses `source_curriculum_id` (reload). A client that timed out can repeat the request: it gets the copy already made (`200`, `already_copied`) |

Learner rows are updated in place (progress, submissions and their criterion results, checkpoint answers, module and lesson assignments, schedules, submission windows, personal plans and their history, help requests, lesson messages in the cohort's conversations, stored notification links, activity events), so their ids don't change. The cohort's `content_defaults` and its per-module GitHub settings (`settings.module_github_config`) move to the copy's module ids; its other settings stay. Every learner's progress (statuses, counts, next step), each exercise's effective submission type and GitHub repository, watch credit totals and checkpoint answer counts are compared before and after; any difference rolls the copy back. Learners in other cohorts on the shared curriculum keep saving while a copy runs; the copied cohort's learners wait for it (the lock order is at the top of `CurriculumCopyForCohort`). Hosted videos and published course ZIPs are shared by reference. Old module, lesson, block and checkpoint ids keep resolving for the cohort's learners (and for requests naming the cohort): `GET /lessons/:id` returns the copy with `moved_from` (`lesson_id`, `block_ids`), and `GET /modules/:id`, `GET /progress`, `PATCH /progress`, `POST /submissions`, checkpoint attempts, video stream and progress, help requests, lesson message sources and lesson record peeks accept the old ids. A learning write that began before the copy committed gets `409` with `code` `content_moved`; reload and save again.

**Create body:**
```json
{
  "lesson": {
    "title": "Version Control",
    "lesson_type": "exercise",
    "position": 1,
    "release_day": 0,
    "required": true,
    "requires_submission": true
  }
}
```

---

## Content Blocks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/lessons/:lesson_id/content_blocks` | Staff | List blocks in lesson |
| `POST` | `/api/v1/lessons/:lesson_id/content_blocks` | Staff | Create content block |
| `GET` | `/api/v1/content_blocks/:id` | Authenticated | Show block |
| `PATCH` | `/api/v1/content_blocks/:id` | Admin | Update block. `block_type` can't change once the block has learner work (422). Replacing or removing a video (hosted upload or link) that students have progress on returns 422 unless `confirm_watch_reset=true`, which resets that progress; old watch credit never carries over to new media |
| `DELETE` | `/api/v1/content_blocks/:id` | Admin | Delete block; 422 when it has learner work |

**Create body:**
```json
{
  "content_block": {
    "block_type": "exercise",
    "position": 1,
    "title": "Create your first repo",
    "body": "<p>Instructions in HTML...</p>",
    "solution": "# Solution code here",
    "filename": "first_repo.rb",
    "video_url": null,
    "metadata": {}
  }
}
```

### Learning objectives, rubrics, and retrieval checks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/learning_objectives?curriculum_id=:id` | Staff | List ordered curriculum objectives and success criteria |
| `POST` | `/api/v1/learning_objectives` | Admin | Create a reusable curriculum objective and success criteria |
| `PATCH` / `DELETE` | `/api/v1/learning_objectives/:id` | Admin | Update or remove an unused objective |
| `PATCH` | `/api/v1/lessons/:lesson_id/objective_alignments` | Admin | Atomically replace the lesson's ordered objective alignments |
| `GET` | `/api/v1/rubrics?curriculum_id=:id` | Staff | List reusable curriculum rubrics and ordered criteria |
| `POST` | `/api/v1/rubrics` | Admin | Create a reusable curriculum rubric and ordered criteria |
| `PATCH` / `DELETE` | `/api/v1/rubrics/:id` | Admin | Update or remove a rubric while preserving submitted evidence |
| `POST` | `/api/v1/knowledge_checks/:knowledge_check_id/attempts` | Student | Record one answer and return immediate result/explanation evidence |

The atomic lesson editor accepts a `retrieval_check` object for its checkpoint. A check has 2–6 options, one server-held correct option, an explanation, and an optional objective from the same curriculum. Students do not receive the answer or explanation before an attempt. Correct attempts complete the checkpoint; the generic progress endpoint cannot bypass this evidence. Attempted checks are immutable, and enrollment restart snapshots and removes the student's attempts for that curriculum. Its optional `video` object accepts `s3_video_key`, `s3_video_content_type`, and `s3_video_size`; a new or replacement hosted key requires both exact metadata fields. MIME and size are revalidated before the managed object is attached. Replacing a video that students have progress on needs `confirm_watch_reset: true` and then resets that progress; without it the save returns 422.

---

## Communication

### Voice draft transcription

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/transcriptions` | Any signed-in user | Create a temporary, reviewable text draft from M4A voice input |

The multipart request includes `audio`, `surface` (`message`, `thread`, `help_request`, or `grading_feedback`), and `cleanup=conservative`. M4A input is limited to 6 MB and five minutes; content type, file signature, and movie duration are verified. The response contains `raw_text`, `suggested_text`, verified `duration_seconds`, and `warnings`. Disabled, unconfigured, and provider-failure responses include the stable codes `voice_disabled`, `voice_not_configured`, and `voice_provider_error` respectively.

The endpoint is rate-limited per user, fails closed until the production feature flag is enabled, never sends or saves the draft, creates no transcript record, and does not retain uploaded audio. The destination's normal authorization and explicit Send/Resolve/Grade action remain authoritative.

### Feedback snippets

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` / `POST` | `/api/v1/feedback_snippets` | Staff | List active shared snippets or create one |
| `PATCH` / `DELETE` | `/api/v1/feedback_snippets/:id` | Owner or admin | Edit or deactivate a snippet |
| `POST` | `/api/v1/feedback_snippets/:id/use` | Staff | Record use of an active snippet |

Snippet text is always inserted into an editable feedback draft; it never grades, sends, or saves feedback automatically.

### Announcements

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/announcements` | Any signed-in user | List posted updates visible to the current user |
| `GET` | `/api/v1/announcements?scope=manage` | Staff | List the updates this staff member can manage; drafts only for their author and admins |
| `GET` | `/api/v1/announcements/:id` | Visible user / Staff | Show an update and mark its notification read for the current user |
| `POST` | `/api/v1/announcements` | Staff | Post an update or save a draft |
| `PATCH` | `/api/v1/announcements/:id` | Author or admin | Edit a draft, post it, or edit a posted update's title and body |
| `DELETE` | `/api/v1/announcements/:id` | Staff (drafts: author or admin) | Archive a posted update; delete a draft |

**Create body:**
```json
{
  "title": "Class recording is ready",
  "body": "Week 3 recording is posted in the recordings tab.",
  "audience": "cohort",
  "cohort_id": 3,
  "status": "published",
  "pinned": true,
  "send_push": true
}
```

`audience` may be `cohort`, `global`, or `staff`. `send_push` fans out to configured browser Web Push subscriptions and active Expo mobile device tokens for eligible recipients.

**Drafts, posting and edits (U-3.6):**

- `status` on create is `published` (the default, posts now) or `draft`. A draft notifies nobody and may have an empty `body`; it needs a title. Drafts are visible only to their author and admins: never to students, other staff, search, Today, cohort pages or the related panel's update count. For anyone else, `GET`, `PATCH` and `DELETE` on a draft return the same `404` (`{ "error": "Update not found" }`) as an id that doesn't exist.
- `client_request_id` on create (optional; 8-64 letters, digits, `-` or `_`, else `422`) makes the create safe to retry. A second create by the same author with the same id returns the update the first one made (`201`) and posts or notifies nothing. The web composer sends one id per update it writes, and keeps it when a save fails so trying again can't post twice.
- `PATCH` with `status: "published"` posts a draft. The row is locked while the status changes, so a double click or a retry finds it already posted, and the audience is notified exactly once. Every permission check (author or admin, the audience the row has now, and the audience requested) runs again under that lock, so a change another request made in the meantime, such as an admin moving the draft to another cohort, is checked too. Posting checks that the author can still post to the audience (instructors: their cohorts; admins: anywhere). `published_at` is the time it was posted.
- The in-app notifications are written in the same transaction as the post, from the locked row: the update is posted with every recipient's notification or, if writing them fails, stays a draft with none, and posting again tells everyone. An edit waiting on the lock then updates their text. Push is requested through `PushNotificationJob` and runs after the commit (#258); a push failure is logged and leaves the post and its notifications in place. Push is requested only by the request that posts, so each recipient is pushed at most once.
- Only the author (while they can still post to its audience) or an admin may `PATCH` an update, draft or posted. Others get `403`.
- After posting, `audience` and `cohort_id` can't change (`422`, "Audience can't change after an update is posted…") and `status` can't go back to `draft`. Changing the title or body sets `edited_at` and `edited_by` and updates the text of notifications already sent, without marking them unread or sending anything new. Pinning is not an edit.
- `published_at` is not accepted: updates post when they are posted. Scheduling waits for a job runner (AS-6).
- `DELETE` on a draft removes it (the response is its last state, `status: "draft"`); on a posted update it archives it. Both re-check, under the row lock, that the viewer can still manage the update's audience.
- Each update in a response carries `edited_at`, `edited_by` (`{ id, full_name }` or null), `can_edit` (whether the viewer may edit, post or delete it) and `can_archive` (whether the viewer may archive it: a posted update, for admins and staff on its cohort, including instructors who can't edit it). Schemas: `Announcement`, `AnnouncementsResponse`, `AnnouncementResponse` in `docs/openapi.json`.

### Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/notifications` | Any signed-in user | List current user's notifications and unread count |
| `PATCH` | `/api/v1/notifications/:id/read` | Owner | Mark one notification read |
| `PATCH` | `/api/v1/notifications/mark_all_read` | Any signed-in user | Mark all current-user notifications read |

### Push Subscriptions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/push_subscriptions/config` | Any signed-in user | Return message-notification preference plus Web Push configuration and the public VAPID key |
| `PATCH` | `/api/v1/push_subscriptions/preferences` | Any signed-in user | Enable or disable DM email and browser-push notifications globally; works without browser push support |
| `POST` | `/api/v1/push_subscriptions` | Any signed-in user | Store the current browser/device push subscription |
| `DELETE` | `/api/v1/push_subscriptions` | Any signed-in user | Remove a subscription endpoint for this user |

**Create body:**
```json
{
  "endpoint": "https://push.example/subscription",
  "keys": {
    "p256dh": "browser-public-key",
    "auth": "browser-auth-secret"
  }
}
```

**Preference body:**
```json
{
  "notifications_enabled": false
}
```

DM email notifications are enabled by default and are queued independently of browser-push support. Disabling the preference suppresses DM and mention emails; browser subscriptions remain device-specific. Each DM email uses the notification ID as a provider idempotency key, verifies that the provider returned a delivery ID, and retries typed delivery failures. Operational logs use internal user and notification IDs without recording recipient addresses or message bodies.

### Mobile Push Tokens

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/mobile_push_tokens` | Any signed-in user | Register or refresh the current Expo device token |
| `DELETE` | `/api/v1/mobile_push_tokens` | Token owner | Remove the current Expo device token at sign-out |

**Register body:**
```json
{
  "token": "ExpoPushToken[device-token]",
  "platform": "ios",
  "device_id": "optional-installation-id",
  "app_version": "1.0.0"
}
```

`platform` must be `ios` or `android`. A token cannot be claimed by a different signed-in user. Tokens rejected by Expo as `DeviceNotRegistered` are marked inactive and can be reactivated by a later successful registration.

---

## Channels & Messages

### Channels

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/channels` | Any signed-in user | List channels visible to the current user with unread counts |
| `GET` | `/api/v1/channels/:id` | Channel member / Staff | Show a channel and a window of messages |
| `POST` | `/api/v1/channels` | Staff | Create a cohort or staff-only channel |
| `PATCH` | `/api/v1/channels/:id` | Staff | Update channel metadata |
| `DELETE` | `/api/v1/channels/:id` | Staff | Archive a channel |
| `PATCH` | `/api/v1/channels/:id/read` | Channel member / Staff | Mark a channel read for the current user |

**Create body:**
```json
{
  "cohort_id": 3,
  "name": "Class Chat",
  "description": "General class discussion.",
  "visibility": "cohort"
}
```

`visibility` may be `cohort` or `staff_only`. A default `Class Chat` channel is created automatically for every cohort.

Channel and direct-conversation show endpoints accept `message_limit`, `around_message_id`, `before_message_id`, and `after_message_id`. Responses include chronological `messages`, `pinned_messages`, and a `meta` object with `oldest_message_id`, `newest_message_id`, `has_older`, and `has_newer`. This lets web and native clients open a search result in context and page backward without overlaps. Blank or legacy `undefined`/`null` anchors are treated as absent. Before/after cursors retain the timestamp and ID of soft-deleted messages within the authorized conversation or thread, while returned windows exclude deleted messages.

### Messages

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/channels/:channel_id/messages` | Channel member / Staff | Post a message |
| `POST` | `/api/v1/direct_conversations/:direct_conversation_id/messages` | Conversation member | Post a direct or group message |
| `GET` | `/api/v1/messages/:id/destination` | Conversation member | Return only message, thread root, channel/DM, and workspace IDs |
| `GET` | `/api/v1/messages/:id/thread` | Conversation member | Bare requests preserve the installed-client contract: root plus all visible chronological replies. Opt into bounded windows with `window=1` or any `message_limit` (max 200), `around_message_id`, `before_message_id`, or `after_message_id` parameter. Windowed requests default to latest; a reply ID defaults to a window around that reply. Includes pagination `meta`. |
| `PATCH` | `/api/v1/messages/:id` | Author / Staff | Edit a message |
| `DELETE` | `/api/v1/messages/:id` | Author / Staff | Soft-delete a message |
| `PATCH` / `DELETE` | `/api/v1/messages/:id/pin` | Staff | Pin or unpin a message |
| `POST` / `DELETE` | `/api/v1/messages/:id/reactions` | Conversation member | Add or remove a reaction |

**Create body:**
```json
{
  "body": "Can someone share the Zoom link?",
  "parent_message_id": null,
  "client_message_id": "01990f7a-2068-7e9f-b884-6a8b4bb44dd0",
  "mention_user_ids": [42],
  "attachments": [],
  "send_push": true
}
```

`body` is limited to 5,000 characters. Clients must generate a distinct `client_message_id` for each send intent and reuse it for every retry of that message. The identifier is scoped to the author—not the conversation—and is limited to 100 characters; a longer value returns `422 Unprocessable Entity`. A first-time create returns `201 Created`. A matching replay returns `200 OK` with the original message, resumes any interrupted notification or realtime delivery, and does not repeat completed delivery work. The first accepted request's `send_push` value governs all replays.

`409 Conflict` is returned when an author reuses the identifier with a different body, parent message, mention set, attachment set, source, or conversation. Replaying an identifier whose message was subsequently deleted also returns `409 Conflict`; it does not recreate or expose the deleted message. Create, replay, message-list, and realtime ActionCable payloads include the value only for the authenticated author and omit it for other viewers. Older clients may omit it.

**Message source (direct messages only).** A top-level direct message can say what it's about with `"source_type"` (`lesson`, `submission` or `help_request`) and `"source_id"`. The author must be able to open the record, the record must belong to the conversation's cohort, and for a submission or help request every learner in the conversation must be the learner it belongs to. A learner can attach only a lesson that `GET /api/v1/lessons/:id?cohort_id=` would open for them in the conversation's cohort (assigned and released); staff can attach any live lesson in the cohort's curriculum. Anything else returns `422` (an unknown type, a malformed id, a channel message or a thread reply, or a record the author or recipients can't reach). Every message payload includes `source`: `null`, or `{ "type", "id", "title", "lesson_id", "cohort_id", "learner_path" }`, where `learner_path` is the learner's own view of the record (staff clients link to the staff record from `type` and `id`). A lesson the viewing learner can't open yet comes back as `{ "type": "lesson", "id": null, "title": "", "lesson_id": null, "cohort_id", "learner_path": null }`, shown as an unlinked "About a lesson"; it gains its title and link once the lesson opens for them. The source can't be changed after the message is sent.

Message deletion returns `503 Service Unavailable` with a retryable error when an in-flight delivery still owns the message after the bounded wait. The message is not deleted in that case, preventing a late create event from appearing after a successful deletion response.

An inline deployment also returns a retryable `503` after a committed create or replay with a `client_message_id` when notification or realtime delivery is incomplete. Clients must retry the same operation and reuse the original identifier; a Solid Queue deployment can acknowledge the committed write because its recurring recovery sweep owns the unfinished delivery.

If a create request omits `client_message_id`, an inline deployment cannot offer a duplicate-safe retry. It returns `202 Accepted` with `delivery_pending: true` and the committed `message`; clients must treat that message as sent and must not repeat the create request. A committed deletion whose final realtime delivery is incomplete also returns this success/pending response rather than create-specific retry guidance.

New API-created messages opt into delivery recovery. When Solid Queue is enabled, `MessageDeliveryRecoveryJob` sweeps up to 100 of the least-recently-attempted incomplete deliveries every minute. This bounded rotation prevents one failing message from blocking newer recovery work. Recovery does not expire incomplete delivery because there is not yet an operator-owned dead-letter queue; each failed attempt is logged and rotated behind untouched work. A recovered notification stage may enqueue another push job, while per-provider forwarding is checkpointed by notification ID so duplicate jobs do not duplicate provider attempts. Messages created before tracking shipped are excluded so deployment cannot replay historical notifications or broadcasts. Deployments using the low-volume inline adapter retain synchronous delivery and identical-request replay, but do not run recurring jobs.

Posting a message creates in-app `message` notifications for other visible channel recipients and can enqueue Web Push delivery when push is configured.

### Realtime Channel Messages

The API mounts ActionCable at `/cable`. The web client first exchanges its normal API auth for a short-lived cable token:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/cable_token` | Any signed-in user | Issue a short-lived, single-use ActionCable token |

Then it connects to `/cable?token=...` and subscribes to:

```json
{
  "channel": "ChannelMessagesChannel",
  "channel_id": 12
}
```

The server authorizes the subscription against the same channel visibility rules as the REST API. Broadcast payloads look like:

```json
{
  "event": "created",
  "channel_id": 12,
  "message": {
    "id": 44,
    "channel_id": 12,
    "body": "Can someone share the Zoom link?",
    "edited_at": null,
    "deleted_at": null,
    "created_at": "2026-04-20T10:00:00Z",
    "updated_at": "2026-04-20T10:00:00Z",
    "author": {
      "id": 2,
      "full_name": "Student One",
      "email": "student@example.com",
      "role": "student",
      "avatar_url": null
    }
  }
}
```

`event` may be `created`, `updated`, or `deleted`. The REST polling/refetch path remains as a fallback for reconnects and stale tabs.

---

## Cohorts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/cohorts` | Staff | List all cohorts |
| `GET` | `/api/v1/cohorts/:id` | Staff | Show cohort with enrollments |
| `GET` | `/api/v1/cohorts/:id/github_access` | Staff | Current GitHub organization membership and invitation status by enrolled user ID |
| `GET` | `/api/v1/cohorts/:id/student_view` | Staff | Read-only preview of the cohort's student experience |
| `POST` | `/api/v1/cohorts` | Admin | Create cohort |
| `PATCH` | `/api/v1/cohorts/:id` | Admin | Update cohort |
| `DELETE` | `/api/v1/cohorts/:id` | Admin | Delete cohort |
| `PATCH` | `/api/v1/cohorts/:id/module_access` | Admin | Update module access settings. `409` `content_moved` when the cohort moved to its own copy of the curriculum while this waited (reload) |
| `PATCH` | `/api/v1/cohorts/:id/announcements` | Admin | Legacy JSON cohort notices; use `/announcements` for Phase 4 communication |
| `PATCH` | `/api/v1/cohorts/:id/class_resources` | Admin | Update cohort resources |

### Weekly submission windows

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `PATCH` | `/api/v1/cohorts/:cohort_id/modules/:module_id/submission_windows` | Staff | Atomically set or clear weekly close times. `409` `content_moved` when the cohort moved to its own copy of the curriculum while this waited (reload) |

Close times use ISO 8601 instants and must include `Z` or a numeric UTC offset. A `null` close time clears that week's window. Week numbers must exist in the selected module.

```json
{
  "submission_windows": [
    { "week_number": 1, "submissions_close_at": "2026-07-18T08:00:00Z" },
    { "week_number": 2, "submissions_close_at": null }
  ]
}
```

Closed windows prevent student submissions, resubmissions, redo updates, manual work completion, and GitHub sync for that week. Staff actions, lesson reading, and video progress remain available.

### Live schedule

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/cohorts/:cohort_id/office_hours` | Enrolled student or Staff | List active live-class/office-hour definitions and upcoming occurrences |
| `POST` | `/api/v1/cohorts/:cohort_id/office_hours` | Staff | Create a one-time or weekly live class or office-hours session |
| `PATCH` | `/api/v1/cohorts/:cohort_id/office_hours/:id` | Staff | Update a session |
| `DELETE` | `/api/v1/cohorts/:cohort_id/office_hours/:id` | Staff | Delete a session |

Offset-bearing ISO 8601 values are treated as absolute instants. Values from `datetime-local` inputs are interpreted as wall-clock times in the supplied IANA timezone. Nonexistent or ambiguous daylight-saving wall times are rejected.

```json
{
  "title": "Instructor Office Hours",
  "description": "Bring questions from the week.",
  "starts_at": "2026-07-18T18:00",
  "ends_at": "2026-07-18T19:00",
  "meeting_url": "https://meet.example.com/csg",
  "timezone": "Pacific/Guam",
  "recurrence": "weekly",
  "event_kind": "office_hours",
  "active": true
}
```

`event_kind` is `live_class` or `office_hours`; existing records default to `office_hours`.

---

## Interventions and Recovery Plans

All endpoints in this section are staff-only. Intervention notes and recovery check-ins are never included in student payloads.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/interventions` | List cases; filters: `enrollment_id`, `owner_id`, `status`, or `due=true` |
| `POST` | `/api/v1/interventions` | Create one owned case for an enrollment and active trigger |
| `GET` | `/api/v1/interventions/:id` | Show case, private notes, connected enrollment, help request, and recovery-plan ID |
| `PATCH` | `/api/v1/interventions/:id` | Update state, owner, action, severity, follow-up, outcome, or resolution |
| `POST` | `/api/v1/interventions/:id/notes` | Append an immutable staff-only note |
| `GET` | `/api/v1/recovery_plans` | List plans; filters: `enrollment_id`, `status`, or `due=true` |
| `POST` | `/api/v1/recovery_plans` | Create an extended-absence or manual recovery plan |
| `GET` | `/api/v1/recovery_plans/:id` | Show plan and private check-in history |
| `PATCH` | `/api/v1/recovery_plans/:id` | Update pace, scope, cadence, next check-in, status, or outcome |
| `POST` | `/api/v1/recovery_plans/:id/check_ins` | Append a check-in and schedule the next one |

The server builds `evidence_snapshot`; client-provided evidence is ignored. Snapshots contain only source record IDs, categories, counts, and timestamps. Message bodies, code, submission text, and private feedback are prohibited. Active cases require an owner and follow-up date. Resolved cases require a categorical outcome and resolution summary.

The daily `InterventionFollowUpJob` creates one owner notification per due date. Changing the follow-up date resets that notification claim. Resolving or canceling the case closes its notifications.

---

## Enrollments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/cohorts/:cohort_id/enrollments` | Staff | List enrollments in cohort |
| `POST` | `/api/v1/cohorts/:cohort_id/enrollments` | Staff | Enroll user in cohort |
| `GET` | `/api/v1/enrollments/:id` | Staff | Show enrollment details |
| `PATCH` | `/api/v1/enrollments/:id` | Staff | Update enrollment status |
| `DELETE` | `/api/v1/enrollments/:id` | Staff | Remove enrollment |
| `POST` | `/api/v1/enrollments/:id/restart` | Admin | Audit and clear scoped learning state; requires exact email confirmation and atomically creates an owned intervention, weekly follow-up, and recovery plan |

---

## Module Assignments (Per-Student Overrides)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/enrollments/:enrollment_id/module_assignments` | Staff | List module assignments |
| `POST` | `/api/v1/enrollments/:enrollment_id/module_assignments` | Staff | Create assignment |
| `GET` | `/api/v1/module_assignments/:id` | Staff | Show assignment |
| `PATCH` | `/api/v1/module_assignments/:id` | Staff | Update (unlock, set date override) |
| `DELETE` | `/api/v1/module_assignments/:id` | Staff | Delete assignment |

---

## Lesson Assignments (Per-Student Overrides)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/enrollments/:enrollment_id/lesson_assignments` | Staff | List lesson assignments |
| `POST` | `/api/v1/enrollments/:enrollment_id/lesson_assignments` | Staff | Create assignment |
| `GET` | `/api/v1/lesson_assignments/:id` | Staff | Show assignment |
| `PATCH` | `/api/v1/lesson_assignments/:id` | Staff | Update (unlock, set date override) |
| `DELETE` | `/api/v1/lesson_assignments/:id` | Staff | Delete assignment |

---

## Progress

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/progress` | Authenticated | Current user's progress records |
| `PATCH` | `/api/v1/progress` | Authenticated | Mark a content block as completed |
| `GET` | `/api/v1/progress/student/:user_id` | Staff | View a student's active enrollment progress, or an exact current/historical enrollment with `cohort_id` |

The staff student response keeps operational fields scoped to the selected enrollment and includes `learning_evidence_scope`. It also carries the learner's `status` (label, `needs_attention`, reasons and the waiting-work, redo and open-help counts from the attention list), the server's `continue_lesson`, each lesson's `learner_status`, and `user.last_active_at` (see "One status source" under Dashboard). Progress and submissions are keyed to the selected enrollment and curriculum content. The scope reports `kind: "enrollment"` and `shared_across_enrollments: false`; another enrollment using the same curriculum keeps separate learning records.

**Update body:**
```json
{
  "content_block_id": 42,
  "status": "completed"
}
```

---

## Submissions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/submissions` | Staff | List submissions (filterable) |
| `GET` | `/api/v1/submissions/:id` | Authenticated | Show submission, including `lesson_id`, `module_id`, and `module_name` relationship fields |
| `POST` | `/api/v1/submissions` | Authenticated | Create submission |
| `PATCH` | `/api/v1/submissions/:id` | Staff | Update submission |
| `PATCH` | `/api/v1/submissions/:id/grade` | Staff | Grade a submission |
| `GET` | `/api/v1/submissions/:id/github_issue` | Staff | Get linked GitHub issue |
| `GET` | `/api/v1/submissions/:id/github_checks` | Staff or submission owner | Read persisted check-run metadata for the submission's current commit |
| `POST` | `/api/v1/submissions/:id/github_checks` | Staff | Refresh current-commit check metadata from GitHub |

**Grade body:**
```json
{
  "grade": "A",
  "feedback": "Great work!",
  "base_submission_updated_at": "2026-09-06T10:44:12.123456Z"
}
```

`base_submission_updated_at` is required and must be the exact `updated_at` value returned with the submission. The API returns `409 Conflict` with code `stale_submission` if the record changed before the grade was saved.

The shared web and native review panels send complete rubric evidence. When supplying `criterion_results`, include each current criterion exactly once:

```json
{
  "grade": "B",
  "feedback": "Check the empty input case.",
  "base_submission_updated_at": "2026-09-06T10:44:12.123456Z",
  "criterion_results": [
    { "rubric_criterion_id": 12, "rating": "meets", "feedback": "Required cases pass." },
    { "rubric_criterion_id": 13, "rating": "developing", "feedback": "Explain the names." }
  ]
}
```

Ratings are `exceeds`, `meets`, `developing`, or `redo`; criterion feedback is optional. Explicitly supplied null, empty (for a nonempty rubric), incomplete, duplicate or foreign criterion results return `422` with “Rate every rubric criterion before grading” and leave the grade, feedback, criterion evidence and progress unchanged. For compatibility with already-open legacy clients, omitting `criterion_results` saves the grade and overall feedback while leaving existing criterion evidence unchanged. A Redo (`grade: "R"`) needs written feedback, not ratings: it may omit `criterion_results`, send `[]`, or send any subset of the rubric's criteria (still no duplicates, foreign criteria or invalid ratings). A, B and C keep the rule above. The shared web panel and native quick review block A, B and C until every criterion has a rating, and show that message beside the grade buttons. For a submission without a rubric, omit `criterion_results` or send `[]`. Only the latest attempt can be graded; a superseded attempt returns `409` with `latest_submission_id`. Clients should retain the draft on conflicts, explicitly reload/review the saved record before retrying a stale write, and offer the latest-attempt destination for superseded work.

Grade values: `A` (0), `B` (1), `C` (2), `R` (3 — redo required)

Creating a submission enqueues background creation of an in-app `submission` notification for non-archived instructors and admins, whose access is currently platform-wide. Grading enqueues the corresponding student notification. Jobs carry the originating event timestamp so stale or duplicate execution neither re-enqueues push nor resets an already-read notification; a later regrade remains a distinct event. Expo delivery deep-links staff to `/staff/submission/:id` and students to `/lesson/:lesson_id`; Web Push opens the equivalent web destination. Web and Expo fanout are isolated from one another. The existing message/email preference is not reused as a global opt-out for announcements or learning alerts.

GitHub check refresh requires `GITHUB_ORGANIZATION_ADMIN_TOKEN` and a saved GitHub repository URL plus commit SHA. The platform persists check names, lifecycle state, conclusion, app/workflow labels, timestamps, and HTTPS detail links. It intentionally does not persist check output, annotations, or log bodies. Old-commit records remain available for audit but are excluded from the current submission projection.

---

## Learning Insights

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/cohorts/:cohort_id/learning_insights` | Staff | Explainable objective evidence and curriculum revision/retry patterns for a cohort |

An optional `user_id` filters the projection to one learner and must identify an enrollment in the selected cohort. Evidence comes only from rubric criterion results, graded objective-aligned submissions, and the latest attempt for objective-linked knowledge checks. Completion, watch time, messages, student work/code, and private feedback are excluded. Every returned signal includes the IDs needed to open its learner, content, or exact submission source. The response also states its evidence rule and the guarantee that it never changes grades, access, or progress automatically.

---

## Cohort Grading & GitHub Sync

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/cohorts/:id/modules/:module_id/submissions` | Staff | All submissions for a module in a cohort |
| `POST` | `/api/v1/cohorts/:id/modules/:module_id/sync_github` | Staff | Sync all students' GitHub repos |
| `POST` | `/api/v1/cohorts/:id/modules/:module_id/sync_github/:user_id` | Staff | Sync one student's GitHub repo |

---

## Error Responses

JSON API errors use the following existing envelopes. They are described by
`components.responses` in `openapi.json`; `x-shared-error-responses` is the
status-to-contract inventory used by Rails request validation across `/api/v1/`.
These are shared contracts, not a claim that every operation can return every status.

| Status | JSON body | Meaning |
| --- | --- | --- |
| 401 | `{ "error": "Unauthorized" }` | Missing or invalid authentication |
| 403 | `{ "error": "Forbidden" }` | Role, enrollment, visibility, or account access denied |
| 404 | `{ "error": "Missing record" }` or `{ "errors": ["Missing record"] }` | Resource unavailable |
| 422 | `{ "error": "Invalid input" }` or `{ "errors": ["Validation failed"] }` | Invalid request or model validation |
| 429 | `{ "error": "Too many requests", "retry_after": 60 }` | Shared limiter; positive integer seconds, also sent in `Retry-After`, with `Cache-Control: no-store` |

`error` is a string; `errors` is an array of strings. The optional `code` on
single-error envelopes identifies access/feature failures. `feature` accompanies
`feature_disabled`; `community_policy` accompanies `community_terms_required`.
Submission validation can add `field_errors`, a field-to-string-array map.
Guaranteed keys are required in the schema; conditional keys describe their context.

Two existing variants are preserved without changing runtime behavior: the legacy
voice-specific 429 sends only `{ "error": "Too many voice requests. Wait a few
minutes and try again." }`, without retry metadata; local/test Rails exception
middleware can return a 404 with `status`, `error`, `exception`, and environment-
dependent `traces`. Clients should display the human error and use status/code for
recovery, rather than depending on diagnostic traces. Bodyless responses and HTML
middleware responses are outside the shared JSON error validation.

## Course packages

Admin-only `POST /api/v1/course_packages/preview` and `POST /api/v1/course_packages` accept `{ "package": <schema-v1 object> }` for reusable recording curricula. Preview writes nothing; import creates an unassigned draft or safely revises an untouched, unassigned draft. Private keys stay in block solutions; recordings use the existing upload flow. See [Course packages](COURSE_PACKAGES.md) for the schema, limits and revision rules.

## Protected curriculum learner ZIPs

Staff prepare a course-specific ZIP in a draft curriculum through Content → Learner ZIP files. Use Download ZIP beside a ready file to inspect the actual stored bundle before any cohort assignment; Abandon pending upload retries cleanup for interrupted files. This does not activate a course, create enrollments or change access terms. Admins can manage any curriculum; instructors need a cohort assignment for that curriculum. Native/older clients continue receiving link resources only; web Resources explicitly requests protected file metadata.

- `GET /api/v1/curricula/:id/resources`: authorized staff see ready and pending ZIP metadata, so interrupted uploads remain discoverable for cleanup. Currently active, unexpired matching-curriculum learners see only ready files. No object keys or signed download URLs are returned.
- `POST /api/v1/curricula/:id/resources`: staff, draft only. JSON `title`, ZIP `filename`, integer `file_size` (1–50 MiB). Returns server-owned pending resource ID and a bounded `application/zip` S3 POST. Send the ZIP using the returned fields.
- `POST /api/v1/curricula/:id/resources/:resource_id/complete`: staff, draft only. Checks staging object type and exact declared size, copies its matching ETag to a separate published object, then marks the resource ready. Repeated completion does not recopy a ready file. Failed/pending files never appear to learners.
- `DELETE /api/v1/curricula/:id/resources/:resource_id`: staff may abandon an unfinished upload; removes its staging/published orphan objects and pending row. Published resources cannot be abandoned.
- `POST /api/v1/curricula/:id/resources/:resource_id/download`: fresh authorization against active, unexpired enrollment in the matching curriculum, or admin/assigned instructor. Returns an S3 URL expiring within five minutes and no later than the selected enrollment's access expiry. Response is `no-store`; POST avoids offline GET-cache fallback. A downloaded local file remains the learner's copy; a previously issued URL may work until its short expiry.

Use the existing private S3 bucket and authenticated frontend CORS configuration. Do not make course objects public. Staging is isolated under `course_resource_uploads/`; published files use `course_resources/`. Configure a short staging-only object expiration policy operationally to clean interrupted/expired uploads or late PUTs; never apply it to published course files. No storage policy or credentials are changed by this feature. Actual deployed upload and enrolled/unenrolled download checks remain a release rehearsal, using a course-specific bundle and approved test accounts.

## Enrollment access deadlines

Learner read access requires an active or completed enrollment whose snapshotted `access_expires_at` is unset or still in the future. An explicit `cohort_id` follows the same deadline as automatic cohort selection. Expired courses disappear from the learner cohort switcher, workspaces, recordings, and cohort announcements; selected-course dashboard, lesson, module, recording, workspace, and weekly-plan requests return `403`. Completed program enrollments without a deadline retain read-only history. Staff retain their existing role and cohort authorization.

New lesson-video and recording stream URLs expire no later than the enrollment's access deadline. Recording progress writes require an active, unexpired enrollment. These rules use the enrollment's agreed terms; changing cohort defaults does not rewrite existing deadlines.


## Self-paced course purchases

- `GET /api/v1/course_offerings` is public. Each listed offering supplies its ID and `checkout_available`; checkout remains subject to server readiness and school-wide sales controls.
- `POST /api/v1/course_checkouts` accepts `cohort_id` for a signed-in student. Return URLs retain the offering and purchase IDs. The server validates the selected offering before creating or resuming checkout.
- `GET /api/v1/course_checkouts` lists only the current student's pending purchases (`id`, `cohort_id`).
- `GET /api/v1/course_checkouts/:id/status` accepts a purchase ID or Checkout Session ID. Student ownership is required; another account's ID returns 404. It reads local fulfillment records, never Stripe, and disables caching. Response: `{ status, can_resume, purchase_id, cohort: { id, name }, enrollment_id }`. Status is `pending`, `starting`, `setup_failed`, `fulfilled`, `failed`, or `refunded`; only `fulfilled` supplies an enrollment with current read access. Expired, disputed, or paid-without-access records require recovery and report `failed`. A definitive failure before session creation reports `setup_failed` and is safe to retry. A session-less uncertain request reports `starting`: stop polling, offer explicit same-attempt resumption only when `can_resume`, otherwise contact support. Only a returned session reports payment-confirmation `pending`.
- Signed payment/expiry webhooks update local state even while new sales are disabled. Confirmation pages must never start another payment while status is pending or uncertain.
- Admin cohort responses include `offering_readiness` (active curriculum, price, assigned active support instructor, published lesson content within the selected modules, active cohort). Cohort updates accept display price, Stripe price ID, visibility, support instructor, access months and support weeks. Checkout visibility defaults off; readiness and global sales controls still gate actual checkout. Admins can create a self-paced cohort using New cohort → Delivery → Self-paced course; checkout visibility stays off while they configure the offering. Purchase terms are snapshotted per fresh checkout attempt, including a retry after failure or confirmed expiry; open and paid attempts preserve their agreed terms. Null legacy terms are filled from current cohort defaults on first touch/fulfillment, without changing existing absolute entitlement dates.

### Legacy recording compatibility

The former `PATCH /api/v1/cohorts/:id/recordings` settings-list writer is retired. Raw `settings` payloads on cohort create/update are rejected with `422`; supported announcement, link, and module configuration editors keep their dedicated endpoints. Web and native recording managers use the first-class recording endpoints. Existing cohort-settings recordings remain readable through the legacy adapter; promoted entries are deduplicated by `legacy_key`, and `legacy_item_key` keeps old links working. Do not reorder or edit the stored legacy array: its ordinal positions form link identities. New recordings and edits belong in the first-class library. Cohort links remain cohort-scoped settings; course ZIP files belong to the reusable curriculum.

## Home-base digest integration

`GET /api/v1/home_base/digest` accepts only a dedicated admin-owned digest token in
`Authorization: Bearer <token>`, separate from Clerk. It returns `generated_at` plus
capped lists of unread DMs/mentions, pending help, latest submissions awaiting grading,
upcoming owned meetings, and due owned follow-ups. It never marks messages read.
See [Home-base digest](HOME_BASE_DIGEST.md) for fields, token tasks, privacy, validation,
and the lead's post-merge activation steps.

## Assistant posting tokens

An admin can let their own assistant (for example a home-base agent) post Markdown
messages **as that admin** without a Clerk session. The credential is an
`AgentPostingToken`: prefix `csg_ap_`, SHA-256 digest at rest, plaintext shown once,
owned by an accepted, active admin, scope `messages:write` only. Clerk-authenticated
endpoints reject the `csg_ap_` prefix the same way they reject home-base `csg_hb_`
tokens, and a home-base token cannot post.

### `POST /api/v1/agent/messages`

| Header | Required | Notes |
|--------|----------|-------|
| `Authorization: Bearer csg_ap_...` | Yes | The only credential this endpoint accepts. |
| `Idempotency-Key` | Yes | 8–64 characters from `A-Z a-z 0-9 . _ : -`. Reuse it for every retry of one message. An `idempotency_key` query or body field also works. |

**Body** (send exactly one destination):

```json
{
  "direct_conversation_id": 12,
  "channel_id": null,
  "recipient_user_id": null,
  "workspace_id": null,
  "body": "**Reminder:** demo day is Friday.\n\n- bring your laptop",
  "thread_root_id": null,
  "mention_user_ids": [],
  "send_push": true
}
```

- `channel_id` and `direct_conversation_id` match the normal create endpoints.
  `recipient_user_id` resolves the owner's existing one-to-one conversation with that
  person (add `workspace_id` when there is more than one). The token never creates
  conversations.
- `body` uses the same Markdown pipeline and 5,000-character limit as messages sent
  from the app. `thread_root_id` posts a thread reply. Attachments are rejected.
- Authorization is the normal `can_post?` check for the owner, and the owner must
  have accepted the current Community Guidelines. Delivery runs through the shared
  create path, so realtime events, notifications, push and unread counts behave
  exactly like a message the owner typed.
- Responses: `201` created; `200` replay of the same key with the same content; `409`
  same key, different content; `401` missing, unknown, revoked or expired token,
  or an owner who is no longer an active admin; `403` destination not allowed or
  terms not accepted; `404` destination not found; `422` invalid input; `429` more
  than 30 posts per minute for this token. The response echoes only `id`, `channel_id`,
  `direct_conversation_id`, `thread_root_id`, `body`, `sent_via_label` and `created_at`.
- `503` means the message was saved but realtime or notification delivery is still
  pending (inline-job deployments only). Retry with the same `Idempotency-Key`: the
  retry finishes delivery and replays the message. A new key posts a second message.

```bash
curl -sS https://api.example.com/api/v1/agent/messages \
  -H "Authorization: Bearer csg_ap_REPLACE_WITH_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"recipient_user_id": 42, "body": "Your **demo** is scheduled for 3 PM."}'
```

Each message stores `agent_posting_token_id` and a `sent_via_label` snapshot of the
token name. Message JSON and realtime payloads include `sent_via_label` (otherwise
`null`). The web shows a small "Sent via <label>" marker; the mobile renderer does
not show it yet.

### Managing tokens (admin, Clerk session)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/agent_posting_tokens` | List your own tokens (name, status, created, last used, expiry, revoked). |
| `POST` | `/api/v1/agent_posting_tokens` | `{ "name": "Home base", "expires_in_days": 90 }` (1–365, or `null` for no expiry). Returns the plaintext `token` once. Maximum 10 active tokens. |
| `PATCH` | `/api/v1/agent_posting_tokens/:id/revoke` | Revoke one of your tokens. Effective immediately. |

The web UI is under **Profile and settings → Assistant posting tokens** (admins only).
Console fallback: `bin/rails "agent_posting:tokens:create[USER_ID,Home base,90]"` prints
the secret once; `bin/rails "agent_posting:tokens:revoke[TOKEN_ID]"` revokes it.

**Security notes.** A token can post as its owner anywhere the owner can post, and nothing
else: it cannot read conversations, edit or delete messages, react, upload files, open
realtime connections, or call any other endpoint. Anyone holding it can impersonate the
owner in messages, so keep it in the assistant's secret store, give it an expiry,
and revoke it from Settings if it might have leaked. Owners who stop being active admins
disable their tokens automatically. The rate limit is held per API process (memory
store), so with several processes the effective ceiling is a multiple of 30 per minute.


### School timezone in the session bootstrap

`POST /api/v1/sessions` includes the school configuration alongside `user` and
`enrollments`:

```json
{
  "school": {
    "time_zone": "Pacific/Guam",
    "time_zone_label": "ChST"
  }
}
```

`time_zone` is the configured IANA identifier. `time_zone_label` is the short
label at API boot (Guam always uses `ChST`). For DST zones, format an instant
using its own date-specific short label. No separate public configuration read
is required: signed-out course offerings include their own response-target copy.

Private-meeting cohort payloads include `timezone`, the saved PrivateMeetingConfig zone. Existing configs retain their saved timezone when SCHOOL_TIME_ZONE changes; clients use this zone for week membership and boundaries, falling back to the school zone for older payloads.

### Session school configuration

`POST /api/v1/sessions` returns the following public `school` configuration beside
`user` and `enrollments` (all fields are strings):

```json
{
  "school": {
    "name": "Code School of Guam",
    "product_name": "CSG Learn",
    "support_email": "codeschoolofguam@gmail.com",
    "site_url": "https://codeschoolofguam.com/",
    "time_zone": "Pacific/Guam",
    "time_zone_label": "ChST"
  }
}
```

The four brand fields are additive. Older cached clients may lack them. See
[BRANDING.md](BRANDING.md) for environment variables and build-time client defaults.

## Feature settings (C-7, C-3, A-5)

Admin-only `GET/PATCH /api/v1/feature_settings` manages school defaults.
Admin-only `GET/PATCH /api/v1/cohorts/:cohort_id/feature_settings` manages overrides.
Responses contain `features` (resolved booleans), `defaults` (school values),
`overrides` (known cohort values), `cohort` (`{ id, name }` or null), and `public_catalog_mode`.

PATCH accepts a complete `features` map. Values are `true` (On), `false` (Off),
or `null`/omitted (Inherit). Unknown keys are ignored; nonboolean values for known keys return 422.
Every switch defaults On; cohort overrides take precedence. Other cohort
settings are preserved. Keys: `private_meetings`, `office_hours`, `recordings`,
`class_channels`, `knowledge_checks`, `help_requests`,
`github_sync`, `announcements`, `interventions`, `learning_plans`.
On retains existing role, delivery-mode, enrollment and publication restrictions.

School PATCH also accepts `public_catalog_mode`: `automatic` (default, show when
checkout-ready offerings exist), `always`, or `hidden`. Unauthenticated
`GET /api/v1/course_offerings` includes this mode; it controls link visibility,
not catalog access or checkout eligibility.

Session `school.features` supplies defaults. Session enrollment cohorts,
accessible cohorts, cohort details/home and dashboard cohorts supply resolved
features. Learner `capabilities.features` supplies the same resolution on
lesson/dashboard/weekly-plan payloads. `capabilities.live_support` identifies
whether the delivery mode supports live support.

Disabled learner office hours, recording reads/playback/progress, individual
help reads/writes, meeting booking/rescheduling, knowledge-check attempts and
GitHub-check reads return 403 with `code: "feature_disabled"` and `feature`.
Aggregate lists omit disabled cohort entries. Staff management remains available;
existing meeting cancellation is allowed. GitHub background imports honor Off.
Clients refresh session/cohort data to receive changes. No data is deleted.

Every successful settings save atomically creates `FeatureSwitchChange` with
actor, optional cohort, before/after values and timestamps. Snapshots retain the
cohort id and name after deletion; a null association with a cohort snapshot
means a deleted cohort, not school scope. No audit UI is currently exposed.
The singleton is cached per request and created lazily in a savepoint. Reads
fall back to in-memory defaults if creation fails; the next request retries.
The additive migration uses transaction-local lock timeout.

Knowledge checks Off keeps lesson content visible and allows ordinary progress completion without answering the check. GitHub sync Off converts synced exercise submissions to text submissions: learners can paste code or a repository URL for review. Existing grading remains available. The Interventions switch hides the staff support queue case/follow-up UI only; it does not disable intervention APIs or delete records. Course community is deferred to AS-9 and has no switch here. Unknown stored keys are ignored.

## Generated transport types

`docs/openapi.json` is the hand-maintained OpenAPI 3.1 source for the migrated
notification, activity, help, recording, lesson, submission, progress, messaging,
workspace, session/profile, safety, push preference and feature settings responses.
It describes wire JSON, including role-dependent omissions and null values; client
view models and endpoints outside `paths` remain handwritten. Keeping a reviewed
schema avoids making Rails serializer implementation details the public contract.

To migrate an endpoint:

1. Inspect every successful response variant in its controller/serializer (student,
   staff, empty, populated, legacy and nullable cases). Add reusable schemas under
   `components.schemas`, then its method, path and success statuses under `paths`.
   Use required fields for guaranteed wire keys and optional fields for conditional
   keys. Keep objects closed except intentional arbitrary metadata/maps.
2. Add real request tests for each documented success status. All covered successful
   integration responses are checked automatically by `test/support/openapi_contract.rb`.
   `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1 bin/rails test` also fails if a documented
   response or component schema has no validated non-null instance. Request-only
   schemas have an explicit commented allowlist in the helper. Empty arrays and
   null branches do not exercise their referenced component. Shared JSON errors are
   validated across API requests, and all five statuses must be exercised too.
3. In `web/`, run `npm ci` and `npm run api:generate`. Commit both generated copies:
   `web/src/types/api.generated.ts` and `mobile/src/lib/api.generated.ts`. Replace
   handwritten transport definitions with aliases to `components['schemas'][...]`;
   keep package-local imports so Metro and Vite never import the other client.
4. Run `npm run api:check` in `web/` (also in CI). It generates fresh output in memory
   and compares **both** files byte-for-byte, catching stale or unequal twins.
   Run both clients' checks and exports after changing the contract.

Playback PATCH request schemas include the additive `watch_credit_version` marker
from #249; older clients may omit it. No payload changes are needed to regenerate.
