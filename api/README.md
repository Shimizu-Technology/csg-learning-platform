# CSG Learning Platform — API

Rails 8.1 API-only backend powering the CSG Learning Platform.

## Setup

```bash
cd ..
rbenv local 3.3.7          # or let your Ruby manager pick up .ruby-version
cd api
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

If `bundle` resolves to system Ruby, confirm the repo is running on Ruby `3.3.7` first:

```bash
ruby -v
bundle _4.0.5_ -v
```

Test coverage is currently focused on authorization guards (`test/integration/api_authz_guards_test.rb`), covering submissions, module access, lesson locking, progress updates, and permission checks.

Clerk authentication is required in local development too. The current app does not support a frontend auth-bypass mode.

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `PUBLIC_FRONTEND_URL` | Prod recommended | — | Canonical frontend URL used in invite emails and Clerk redirects (for example `https://learn.codeschoolofguam.com`) |
| `FRONTEND_URL` | Yes | `http://localhost:5173` | Comma-separated frontend origins used for local dev/CORS; production email links fall back to the first non-localhost HTTPS URL when `PUBLIC_FRONTEND_URL` is unset |
| `ALLOWED_ORIGINS` | No | `FRONTEND_URL` | Explicit comma-separated CORS / ActionCable origins |
| `CLERK_ISSUER` | Yes | — | Clerk issuer URL for JWT verification |
| `CLERK_SECRET_KEY` | No | — | Clerk backend key for enriching user data |
| `CLERK_JWKS_URL` | No | Auto from issuer | Explicit JWKS endpoint override |
| `CLERK_AUDIENCE` | No | — | JWT audience verification |
| `DATABASE_URL` | Prod only | — | Neon PostgreSQL connection string |
| `RESEND_API_KEY` | No | — | Transactional email (invite emails) |
| `MAILER_FROM_EMAIL` | No | `noreply@codeschoolofguam.com` | From address for emails |
| `GITHUB_ORGANIZATION_ADMIN_TOKEN` | No | — | GitHub API token for repo sync and org invites |
| `AWS_ACCESS_KEY_ID` | No | — | AWS IAM access key for S3 recording uploads |
| `AWS_SECRET_ACCESS_KEY` | No | — | AWS IAM secret key for S3 recording uploads |
| `AWS_REGION` | No | `us-east-1` | AWS region for S3 bucket |
| `AWS_S3_BUCKET` | No | — | S3 bucket name for recording storage |
| `WEB_PUSH_PUBLIC_KEY` | No | — | VAPID public key for browser push subscriptions |
| `WEB_PUSH_PRIVATE_KEY` | No | — | VAPID private key for push delivery |
| `WEB_PUSH_SUBJECT` | No | — | Contact URI for Web Push (for example `mailto:team@codeschoolofguam.com`) |

For direct browser uploads to S3, `AWS_REGION` must match the bucket’s real region exactly, and the bucket’s CORS rules must allow both local development (`http://localhost:5173`) and production (`https://learn.codeschoolofguam.com`) origins. In production, this setting refers to the S3 bucket region, not the Render app region, so it is valid for uploads to use `ap-southeast-2` even while the API runs in Singapore. If presign succeeds but the browser upload fails before the recording create request reaches Rails, that is usually an S3 CORS or bucket-region mismatch issue rather than an API error.

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
                    ├── video_url: legacy YouTube/Vimeo embed URL
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

Recording
  ├── cohort_id: scoped to cohort
  ├── uploaded_by_id: FK to users
  ├── s3_key: unique key in S3 bucket
  ├── title, description, content_type, file_size
  ├── duration_seconds, position (ordering)
  └── recorded_date

WatchProgress
  ├── user_id + recording_id (unique pair)
  ├── last_position_seconds: resume position
  ├── total_watched_seconds: cumulative watch time
  ├── duration_seconds: total video length
  └── completed: auto-set at 90% watched
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
| `sessions` | `create` — sync/create user from Clerk JWT | Authenticated |
| `profile` | `show`, `update` — current user | Authenticated |
| `dashboard` | `show` — student or admin dashboard data | Authenticated |
| `recordings` | `index` — cohort recordings | Authenticated |
| `resources` | `index` — cohort resources | Authenticated |
| `announcements` | `index`, `show`, `create`, `update`, `destroy` | Signed-in users / Staff for management |
| `notifications` | `index`, `read`, `mark_all_read` | Authenticated |
| `channels` + `messages` | Channel listing, read state, posting, reactions, pins | Authenticated |
| `direct_conversations` | DM listing, creation, read state | Authenticated |
| `push_subscriptions` | Push notification opt-in/out and config | Authenticated |
| `users` | CRUD-style management + archive/delete unused invite + `resend_invite` | Admin |
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
| `aws-sdk-s3` | Self-hosted recording uploads and streaming |
| `web-push` | Browser push notifications |
| `kamal` + `thruster` | Deployment tooling |
| `rubocop-rails-omakase` | Linting |
| `brakeman` | Security scanning |
| `bundler-audit` | Dependency vulnerability checking |
