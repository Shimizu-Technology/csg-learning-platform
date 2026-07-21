# CSG Learning Platform — API Reference

**Base URL:** `/api/v1/`
**Auth:** All endpoints require a valid Clerk JWT in the `Authorization: Bearer <token>` header unless noted otherwise.
**Content-Type:** `application/json`

---

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/up` | None | Rails health check (200 if app is running) |
| `GET` | `/health` | None | JSON health check: `{"status":"ok"}` |

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

**Student response:** Current cohort, latest announcements, unread notification count, modules with progress, upcoming lessons.

**Admin response:** All active cohorts with student progress, at-risk indicators, ungraded counts.

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
        "enrollment_status": "active"
      }
    ],
    "ungraded_count": 5,
    "cohorts": [ "..." ]
  }
}
```

---

## Hub Endpoints

### `GET /api/v1/recordings`

Returns recordings for the current user's active cohort.

### `GET /api/v1/resources`

Returns resources/links for the current user's active cohort.

---

## Users (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/users` | Admin | List all users |
| `GET` | `/api/v1/users/:id` | Admin | Show user details |
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

---

## Communication

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

DM email notifications are enabled by default and are queued independently of browser-push support. Disabling the preference suppresses DM and mention emails; browser subscriptions remain device-specific.

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
| `GET` | `/api/v1/channels/:id` | Channel member / Staff | Show a channel and recent messages |
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

### Messages

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/channels/:channel_id/messages` | Channel member / Staff | Post a message |
| `PATCH` | `/api/v1/messages/:id` | Author / Staff | Edit a message |
| `DELETE` | `/api/v1/messages/:id` | Author / Staff | Soft-delete a message |

**Create body:**
```json
{
  "body": "Can someone share the Zoom link?",
  "send_push": true
}
```

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

### Office hours

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/cohorts/:cohort_id/office_hours` | Enrolled student or Staff | List active definitions and upcoming occurrences |
| `POST` | `/api/v1/cohorts/:cohort_id/office_hours` | Staff | Create a one-time or weekly session |
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
  "active": true
}
```

---

## Enrollments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/cohorts/:cohort_id/enrollments` | Staff | List enrollments in cohort |
| `POST` | `/api/v1/cohorts/:cohort_id/enrollments` | Staff | Enroll user in cohort |
| `GET` | `/api/v1/enrollments/:id` | Staff | Show enrollment details |
| `PATCH` | `/api/v1/enrollments/:id` | Staff | Update enrollment status |
| `DELETE` | `/api/v1/enrollments/:id` | Staff | Remove enrollment |

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
| `GET` | `/api/v1/progress/student/:user_id` | Staff | View specific student's progress |

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
| `GET` | `/api/v1/submissions/:id` | Authenticated | Show submission |
| `POST` | `/api/v1/submissions` | Authenticated | Create submission |
| `PATCH` | `/api/v1/submissions/:id` | Staff | Update submission |
| `PATCH` | `/api/v1/submissions/:id/grade` | Staff | Grade a submission |
| `GET` | `/api/v1/submissions/:id/github_issue` | Staff | Get linked GitHub issue |

**Grade body:**
```json
{
  "grade": "A",
  "feedback": "Great work!"
}
```

Grade values: `A` (0), `B` (1), `C` (2), `R` (3 — redo required)

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
