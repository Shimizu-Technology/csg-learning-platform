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

Syncs or creates a user record from the Clerk JWT. Called on first login to establish the backend user.

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

**Student response:** Current cohort, modules with progress, upcoming lessons.

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
| `DELETE` | `/api/v1/users/:id` | Admin | Delete user |
| `POST` | `/api/v1/users/:id/resend_invite` | Admin | Resend Clerk invitation email |

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

## Cohorts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/cohorts` | Staff | List all cohorts |
| `GET` | `/api/v1/cohorts/:id` | Staff | Show cohort with enrollments |
| `POST` | `/api/v1/cohorts` | Staff | Create cohort |
| `PATCH` | `/api/v1/cohorts/:id` | Staff | Update cohort |
| `DELETE` | `/api/v1/cohorts/:id` | Staff | Delete cohort |
| `PATCH` | `/api/v1/cohorts/:id/module_access` | Staff | Update module access settings |
| `PATCH` | `/api/v1/cohorts/:id/announcements` | Staff | Update cohort announcements |
| `PATCH` | `/api/v1/cohorts/:id/recordings` | Staff | Update cohort recordings list |
| `PATCH` | `/api/v1/cohorts/:id/class_resources` | Staff | Update cohort resources |

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
