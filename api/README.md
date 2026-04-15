# CSG Learning Platform — API

Rails 8.1 API-only backend powering the CSG Learning Platform.

## Setup

```bash
cp .env.example .env       # Configure Clerk, DB, and optional services
bundle install
rails db:create db:migrate db:seed
rails server -p 3000
```

### Seeding

`db:seed` creates:
- Default admin and instructor user records (Clerk IDs must be filled in `.env` or updated manually)
- Imports prework curriculum from `../scripts/prework_exercises.json` via `curriculum:import_prework`
- Creates "Cohort 3" linked to the "CSG Full-Stack Bootcamp 2026" curriculum

### Running Tests

```bash
bundle exec rails test
```

Test coverage is currently focused on authorization guards (`test/integration/api_authz_guards_test.rb`), covering submissions, module access, lesson locking, progress updates, and permission checks.

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `FRONTEND_URL` | Yes | `http://localhost:5173` | CORS allowed origin |
| `CLERK_ISSUER` | Yes | — | Clerk issuer URL for JWT verification |
| `CLERK_SECRET_KEY` | No | — | Clerk backend key for enriching user data |
| `CLERK_JWKS_URL` | No | Auto from issuer | Explicit JWKS endpoint override |
| `CLERK_AUDIENCE` | No | — | JWT audience verification |
| `DATABASE_URL` | Prod only | — | Neon PostgreSQL connection string |
| `RESEND_API_KEY` | No | — | Transactional email (invite emails) |
| `MAILER_FROM_EMAIL` | No | `noreply@yourdomain.com` | From address for emails |
| `GITHUB_ORGANIZATION_ADMIN_TOKEN` | No | — | GitHub API token for repo sync and org invites |

## Data Model

### Learning Structure

```
Curriculum (e.g., "CSG Full-Stack Bootcamp 2026")
  └── CurriculumModule (table: modules)
        ├── module_type: prework | live_class | capstone | advanced | workshop | recording
        ├── schedule_days: weekdays | mwf | tth | daily | weekdays_sat
        ├── day_offset: start day relative to curriculum
        └── Lesson
              ├── release_day: day relative to module start
              ├── requires_submission: boolean
              └── ContentBlock
                    ├── block_type: video | text | exercise | code_challenge | checkpoint | recording
                    ├── body: HTML/Markdown instructions
                    ├── video_url: YouTube/Vimeo embed URL
                    ├── solution: hidden from students
                    └── filename: for GitHub submission matching
```

### People & Access

```
User
  ├── role: student (0) | instructor (1) | admin (2)
  ├── clerk_id: unique Clerk identifier
  └── github_username: optional, for code submissions

Cohort
  ├── cohort_type: bootcamp | workshop | alumni | custom
  ├── curriculum_id: links to reusable curriculum
  ├── start_date: drives unlock calculations
  └── Enrollment (User ↔ Cohort)
        ├── status: active | paused | dropped | completed
        ├── ModuleAssignment (per-student module access overrides)
        └── LessonAssignment (per-student lesson unlock overrides)
```

### Learning Activity

```
Progress
  ├── user_id + content_block_id (unique pair)
  ├── status: not_started (0) | in_progress (1) | completed (2)
  └── completed_at: timestamp

Submission
  ├── content_block_id + user_id
  ├── text: student's submitted code
  ├── grade: A (0) | B (1) | C (2) | R/redo (3)
  ├── feedback: instructor notes
  ├── graded_by_id: FK to users
  └── github_issue_url / github_code_url
```

## Unlock Logic

Lessons unlock based on a calculated date:

```
unlock_date = cohort.start_date + module.day_offset + lesson.release_day
```

Adjusted for the module's `schedule_days` — e.g., an MWF module only counts Monday/Wednesday/Friday as "days."

Override priority:
1. `LessonAssignment.unlock_date_override` (per-student, per-lesson)
2. `LessonAssignment.unlocked` (force unlock)
3. `ModuleAssignment.unlocked` (module-level access)
4. Calculated date from schedule

## Controllers

All controllers are namespaced under `Api::V1` and return JSON.

| Controller | Key Actions | Auth |
|------------|-------------|------|
| `sessions` | `create` — sync/create user from Clerk JWT | Public |
| `profile` | `show`, `update` — current user | Authenticated |
| `dashboard` | `show` — student or admin dashboard data | Authenticated |
| `recordings` | `index` — cohort recordings | Authenticated |
| `resources` | `index` — cohort resources | Authenticated |
| `users` | CRUD + `resend_invite` | Admin |
| `curricula` | CRUD | Staff (index/show), Admin (create/update/destroy) |
| `modules` | CRUD | Staff |
| `lessons` | CRUD + `create_exercise` | Staff |
| `content_blocks` | CRUD | Staff |
| `cohorts` | CRUD + `module_access`, `announcements`, `recordings`, `class_resources` | Staff |
| `enrollments` | CRUD | Staff |
| `module_assignments` | CRUD — per-student module overrides | Staff |
| `lesson_assignments` | CRUD — per-student lesson overrides | Staff |
| `progress` | `index`, `update`, `student` | Authenticated (own), Staff (any student) |
| `submissions` | CRUD + `grade`, `github_issue` | Authenticated (own), Staff (grade) |
| `cohort_grading` | `index`, `sync_all`, `sync_student` — GitHub sync per module | Staff |

## Key Dependencies

| Gem | Purpose |
|-----|---------|
| `rails ~> 8.1` | Web framework |
| `pg` | PostgreSQL adapter |
| `puma` | Application server |
| `jwt` | JWT token verification |
| `rack-cors` | CORS configuration |
| `httparty` | HTTP client (Clerk JWKS fetching) |
| `roo` | Spreadsheet parsing for CSV import |
| `resend` | Transactional email |
| `kamal` + `thruster` | Deployment tooling |
| `rubocop-rails-omakase` | Linting |
| `brakeman` | Security scanning |
| `bundler-audit` | Dependency vulnerability checking |
