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

---

## Dashboard

### `GET /api/v1/dashboard`

Returns role-appropriate dashboard data.

**Student response:** Current cohort, pinned/unread announcements, unread notification count, modules with progress and unlock state, next lesson, current redo items, latest passing grades, resources, and upcoming office hours.

**Staff response:** All active cohorts with student progress and activity signals. Each student summary includes `ungraded_count` and `redo_count`; each cohort and the backward-compatible top-level summary include the total ungraded count.

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
        "last_activity_at": "2026-04-06T15:30:00Z",
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

Returns one normalized `items` list. Students receive recordings across their active cohort enrollments; staff receive recordings across all active and upcoming cohorts. Each item includes `item_key`, `cohort_id`, `cohort_name`, `source` (`uploaded`, `youtube`, or `external`), recording date, media metadata, and the current student's watch progress when available.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/cohorts/:cohort_id/recordings/:id/stream_url` | Staff or active cohort member | Returns a two-hour `stream_url` and ISO 8601 `expires_at` |
| `PATCH` | `/api/v1/watch_progress` | Staff or active cohort member | Saves monotonic watch time and resume position; completes at 90% |
| `GET` | `/api/v1/content_blocks/:id/video_stream` | Authorized lesson viewer | Returns a two-hour lesson-video `stream_url`, `expires_at`, and current progress |
| `PATCH` | `/api/v1/content_blocks/:id/video_progress` | Authorized lesson viewer | Saves authoritative lesson-video progress |
| `GET` | `/api/v1/watch_progress/student/:user_id` | Staff | Returns recording progress for the student's active enrollments, or the exact enrolled cohort when `cohort_id` is provided |
| `GET` | `/api/v1/watch_progress/student/:user_id/lesson_videos` | Staff | Returns curriculum lesson-video progress for active enrollments, or the exact enrolled cohort when `cohort_id` is provided |

Signed URLs are temporary secrets. Clients should renew before `expires_at`, avoid logging or persisting them, and retain playback position across source replacement.

### `GET /api/v1/resources`

Students receive resources/links for their active cohort. Staff receive resources across all active and upcoming cohorts; each item includes `cohort_id` and `cohort_name` and uses a cross-cohort-safe synthetic ID.

---

## Users (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/users` | Staff | List users; supports `role`, admin-only `include_archived`, and `include_enrollments` |
| `GET` | `/api/v1/users/:id` | Staff | Show user details |
| `POST` | `/api/v1/users` | Admin | Create user (sends Clerk invite) |
| `PATCH` | `/api/v1/users/:id` | Admin | Update user |
| `DELETE` | `/api/v1/users/:id` | Admin | Archive user; hard-delete only unused pending invites |
| `POST` | `/api/v1/users/:id/resend_invite` | Admin | Resend Clerk invitation email |
| `PATCH` | `/api/v1/users/:id/unarchive` | Admin | Restore archived user; re-sends invite when still pending |

Archived users are hidden from default user lists, team management, active cohort/member lists, messaging pickers, and notification recipients. Their historical messages, announcements, and records remain attached for audit/history. Admins can pass `include_archived=true` to `GET /api/v1/users` when they need to inspect archived accounts.

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
| `POST` | `/api/v1/curricula/:curriculum_id/modules` | Staff | Create module |
| `GET` | `/api/v1/modules/:id` | Authenticated | Show module with lessons |
| `PATCH` | `/api/v1/modules/:id` | Staff | Update module |
| `DELETE` | `/api/v1/modules/:id` | Staff | Delete module |

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
| `DELETE` | `/api/v1/lessons/:id` | Staff | Delete lesson |

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
| `PATCH` | `/api/v1/content_blocks/:id` | Staff | Update block |
| `DELETE` | `/api/v1/content_blocks/:id` | Staff | Delete block |

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
| `GET` / `POST` | `/api/v1/learning_objectives?curriculum_id=:id` | Admin | List or create ordered curriculum objectives and success criteria |
| `PATCH` / `DELETE` | `/api/v1/learning_objectives/:id` | Admin | Update or remove an unused objective |
| `PATCH` | `/api/v1/lessons/:lesson_id/objective_alignments` | Admin | Atomically replace the lesson's ordered objective alignments |
| `GET` / `POST` | `/api/v1/rubrics?curriculum_id=:id` | Admin | List or create reusable curriculum rubrics and ordered criteria |
| `PATCH` / `DELETE` | `/api/v1/rubrics/:id` | Admin | Update or remove a rubric while preserving submitted evidence |
| `POST` | `/api/v1/knowledge_checks/:knowledge_check_id/attempts` | Student | Record one answer and return immediate result/explanation evidence |

The atomic lesson editor accepts a `retrieval_check` object for its checkpoint. A check has 2–6 options, one server-held correct option, an explanation, and an optional objective from the same curriculum. Students do not receive the answer or explanation before an attempt. Correct attempts complete the checkpoint; the generic progress endpoint cannot bypass this evidence. Attempted checks are immutable, and enrollment restart snapshots and removes the student's attempts for that curriculum.

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
| `GET` | `/api/v1/announcements` | Any signed-in user | List announcements visible to the current user |
| `GET` | `/api/v1/announcements?scope=manage` | Staff | List all announcements for staff management |
| `GET` | `/api/v1/announcements/:id` | Visible user / Staff | Show announcement and mark its notification read for the current user |
| `POST` | `/api/v1/announcements` | Staff | Publish or draft an announcement |
| `PATCH` | `/api/v1/announcements/:id` | Staff | Update an announcement |
| `DELETE` | `/api/v1/announcements/:id` | Staff | Archive an announcement |

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

Channel and direct-conversation show endpoints accept `message_limit`, `around_message_id`, and `before_message_id`. Responses include chronological `messages`, `pinned_messages`, and a `meta` object with `oldest_message_id`, `newest_message_id`, `has_older`, and `has_newer`. This lets web and native clients open a search result in context and page backward without overlaps.

### Messages

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/channels/:channel_id/messages` | Channel member / Staff | Post a message |
| `POST` | `/api/v1/direct_conversations/:direct_conversation_id/messages` | Conversation member | Post a direct or group message |
| `GET` | `/api/v1/messages/:id/thread` | Conversation member | Return the root message and its chronological replies |
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

`409 Conflict` is returned when an author reuses the identifier with a different body, parent message, mention set, attachment set, or conversation. Replaying an identifier whose message was subsequently deleted also returns `409 Conflict`; it does not recreate or expose the deleted message. Create, replay, message-list, and realtime ActionCable payloads include the value only for the authenticated author and omit it for other viewers. Older clients may omit it.

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
| `GET` | `/api/v1/cohorts/:id/student_view` | Staff | Read-only preview of the cohort's student experience |
| `POST` | `/api/v1/cohorts` | Admin | Create cohort |
| `PATCH` | `/api/v1/cohorts/:id` | Admin | Update cohort |
| `DELETE` | `/api/v1/cohorts/:id` | Admin | Delete cohort |
| `PATCH` | `/api/v1/cohorts/:id/module_access` | Admin | Update module access settings |
| `PATCH` | `/api/v1/cohorts/:id/announcements` | Admin | Legacy JSON cohort notices; use `/announcements` for Phase 4 communication |
| `PATCH` | `/api/v1/cohorts/:id/recordings` | Admin | Update legacy cohort recordings list |
| `PATCH` | `/api/v1/cohorts/:id/class_resources` | Admin | Update cohort resources |

### Weekly submission windows

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `PATCH` | `/api/v1/cohorts/:cohort_id/modules/:module_id/submission_windows` | Staff | Atomically set or clear weekly close times |

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

The staff student response keeps operational fields scoped to the selected enrollment and includes `learning_evidence_scope`. Progress and submissions are intentionally keyed to the learner and curriculum content, so the scope reports the curriculum and whether evidence is shared across multiple same-curriculum enrollments.

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
  "feedback": "Great work!"
}
```

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

All errors follow a consistent format:

```json
{
  "error": "Not authorized"
}
```

Common HTTP status codes:
- `401` — Missing or invalid JWT
- `403` — Insufficient role permissions
- `404` — Resource not found
- `422` — Validation errors
