# CSG Learning Platform — Roadmap

**Last updated:** 2026-04-15
**Status:** Active execution roadmap
**Companion docs:** `docs/PRODUCT_VISION.md`, `docs/DEPLOYMENT.md`, `docs/API_REFERENCE.md`

---

## Current State

The platform is **production-ready for its core use case** — managing cohorts, delivering curriculum content, tracking progress, and grading submissions.

### What's built and working

- ✅ Curriculum CMS (curricula → modules → lessons → content blocks)
- ✅ Cohort management with enrollments and access control
- ✅ Unlock engine (day-based scheduling, MWF/TTh/daily/weekday patterns)
- ✅ Per-student overrides (module and lesson level)
- ✅ Student dashboard with progress tracking
- ✅ Video completion tracking (YouTube iframe API + Vimeo player API)
- ✅ Grading workflow (submission queue, A/B/C/R grades, feedback, redo flow)
- ✅ GitHub integration (repo sync, issue creation for redos)
- ✅ Rich content editing (WYSIWYG + Monaco code editor + student preview)
- ✅ Role-based access (student / instructor / admin) with Clerk JWT auth
- ✅ Multi-cohort admin dashboard with student health indicators
- ✅ Student management page (grouped by cohort, search, filter)
- ✅ Mobile-first responsive UI with collapsible sidebar and PWA support
- ✅ PostHog analytics integration
- ✅ CI pipeline (RuboCop, Brakeman, bundler-audit, Rails tests)
- ✅ Deployment (Render Singapore + Netlify + Neon PostgreSQL)
- ✅ Self-hosted class recordings (AWS S3 + presigned URLs)
- ✅ Watch progress tracking with auto-resume and completion detection
- ✅ GitHub issue lifecycle on grading (create, comment, close)
- ✅ Email notifications (daily unlock, redo notification)

### What's partially built

- ⚠️ Announcements — backend endpoint exists, frontend display is basic
- ⚠️ Legacy YouTube recordings — still served from cohort settings JSON alongside new S3 recordings

---

## Phase 1: Documentation & Hardening (Current)

> **Goal:** Ensure the platform is well-documented, maintainable, and safe to iterate on.

### 1.1 Documentation (COMPLETE)
- ✅ Root README with full project overview and setup
- ✅ Backend README with models, controllers, env vars
- ✅ Frontend README with routes, components, design system
- ✅ API Reference with all endpoints documented
- ✅ Deployment runbook for Render + Netlify
- ✅ Updated product vision with expanded scope
- ✅ Updated roadmap (this document)
- ✅ Cleaned up AGENTS.md

### 1.2 Test Coverage ✅
- ✅ Lesson unlock logic (available?, unlock_date, all override combos)
- ✅ ModuleAssignment accessibility logic
- ✅ Submission grading + auto-completion + R grade handling
- ✅ Enrollment creation auto-generates module assignments
- ✅ Cohort module_access bulk assign/unassign
- ✅ Role matrix (student vs instructor vs admin access)
- ✅ GithubIssueService unit tests
- ✅ Authorization guard tests (submissions, progress, content)

### 1.3 Prework Grader Retirement (Code Complete — Operational Steps Remain)
- ✅ GitHub issue lifecycle on grading (create on R, comment on re-R, close on pass)
- ✅ Daily unlock email notifications (rake task + Resend integration)
- ✅ Redo notification email when graded R
- 🔲 **Migrate any remaining data** — Run `rails import_cohort_data` for any cohorts still only in the old app. Verify all student submissions and grades are present in `csg-learning-platform`.
- 🔲 **Redirect old app to new platform** — Update DNS or hosting config to point the old prework grader URL to `csg-learning-platform`. If hosted on Render/Heroku, add a redirect rule or shut down the old service.
- 🔲 **Archive `csg-prework-grader` repo** — On GitHub: Settings → General → Danger Zone → Archive this repository. Do this last, after confirming the new platform is fully operational.

---

## Phase 2: Self-Hosted Recordings (AWS S3) ✅

> **Goal:** Replace YouTube dependency with direct video uploads and granular tracking.

### 2.1 Backend ✅
- ✅ `aws-sdk-s3` gem with `S3Service` (presigned POST for upload, presigned GET for streaming, delete)
- ✅ `Recording` model (cohort-scoped, s3_key, file_size, duration, position ordering)
- ✅ `WatchProgress` model (per-user per-recording: last_position, total_watched, auto-completion at 90%)
- ✅ `RecordingsController` — full CRUD + presign endpoint + stream_url + reorder
- ✅ `WatchProgressController` — update from player + staff views (per-student, per-cohort matrix)
- ✅ `StudentRecordingsController` — unified endpoint returning both legacy YouTube and S3 recordings

### 2.2 Frontend ✅
- ✅ Custom HTML5 `VideoPlayer` component with presigned URL streaming
  - Play/pause, seek, volume, fullscreen, restart
  - Auto-resume from last position
  - Progress sent to API every 10 seconds + on pause/unmount
  - Auto-hides controls during playback
- ✅ Student recordings page — merged view of S3 + YouTube recordings
  - Playlist sidebar with search, tabs (All/Uploaded/YouTube)
  - Progress bars and completion badges per recording
  - Mobile-responsive layout (collapsible playlist)
- ✅ Staff recording upload UI (in cohort detail page)
  - Drag-and-drop or click-to-select upload
  - Presigned POST to S3 (up to 5 GB)
  - Edit title/description/date, delete recordings
- ✅ Admin watch progress matrix (cohort → per-student × per-recording grid)

### 2.3 Infrastructure ✅
- ✅ AWS S3 bucket (`csg-learning-platform`, ap-southeast-2)
- ✅ IAM credentials configured via env vars
- ✅ Private bucket with presigned URLs (no public access)
- 🔲 CloudFront CDN (future optimization — not needed for Guam-scale traffic)
- 🔲 HLS transcoding (future optimization — direct MP4 streaming works well for now)

### Definition of done
> Staff can upload a class recording, students can watch it with tracked progress, and the app shows exactly how much of each recording a student has watched.

---

## Phase 3: Stripe Payment Integration

> **Goal:** Replace manual email → Stripe link flow with in-app payments.

**Why this is next:** It's a relatively low-complexity, high-impact change that eliminates a manual process and improves the enrollment experience.

### 3.1 Backend
- `Payment` model (user, cohort, amount, status, Stripe session ID)
- Stripe Checkout session creation endpoint
- Webhook handler for payment confirmation
- Auto-enrollment on successful payment
- Payment history and receipt endpoints

### 3.2 Frontend
- Payment page with Stripe Checkout embed
- Payment status in student profile
- Admin payment dashboard (who paid, outstanding, payment plans)
- Invoice/receipt download

### 3.3 Configuration
- Stripe API keys (test + live)
- Webhook secret
- Product/price configuration in Stripe dashboard

### Definition of done
> A prospective student can pay for the bootcamp through the app and be automatically enrolled in the correct cohort.

---

## Phase 4: In-App Messaging (Slack Alternative)

> **Goal:** Bring communication into the platform without building a full Slack clone.

**Why this is later:** Slack works fine for now. Messaging is the biggest engineering lift and should only happen after the core platform is stable and the previous phases have shipped.

### 4.1 Phase 4a — Announcements
- Announcement model (cohort-scoped + global)
- Staff announcement creation UI
- Student-visible announcement feed
- Push notification support (via service worker)

### 4.2 Phase 4b — Cohort Channels
- Channel model (per-cohort, alumni, custom)
- Message model with threading support
- ActionCable WebSocket integration for real-time
- Typing indicators and read receipts
- File/image attachment support

### 4.3 Phase 4c — Direct Messages
- Staff ↔ student direct messaging
- Message notifications
- Conversation list UI

### 4.4 Phase 4d — Rich Features
- @mentions and notifications
- Emoji reactions
- Search across messages
- Channel management (create, archive, pin messages)

### Definition of done
> CSG can run day-to-day class communication through the platform instead of Slack, with per-cohort channels and an alumni channel.

---

## Phase 5: Extended Features

These features are valuable but should not block the phases above:

### 5.1 Workshop Support
Already works via the module system — a workshop is just a cohort with a workshop-type module. May need UI polish for shorter-format events.

### 5.2 Notification & Reminder System
- Email reminders for upcoming deadlines
- Push notifications for graded work, announcements
- Configurable notification preferences

### 5.3 Advanced Analytics
- Cohort-level progress analytics
- Time-on-task tracking
- Engagement metrics dashboard
- Export to CSV/PDF

### 5.4 GitHub Organization Onboarding
Dedicated workflow for GitHub org invites (see `docs/FUTURE_IMPROVEMENTS.md` for detailed plan).

### 5.5 Zoom Integration
Zoom's API supports creating and managing meetings programmatically. If this becomes valuable, the platform could auto-create Zoom meetings for scheduled classes and embed join links. For now, Zoom links live in class resources.

---

## Prioritization Principles

When deciding what to build next:

1. **Does it help CSG run operations more smoothly?** → Do it sooner
2. **Does it eliminate a manual process?** → Do it sooner
3. **Does it replace a scattered external tool?** → Do it after the core is stable
4. **Does it only make the code cleverer without making the platform more useful?** → It's probably not the priority

---

## Success Criteria

### Near-term (Phases 1-2)
- CSG runs prework and live class entirely from this platform
- `csg-prework-grader` is no longer needed for operations
- Class recordings are self-hosted with real progress tracking
- Documentation is comprehensive and up-to-date

### Medium-term (Phases 3-4)
- Students pay through the app
- Slack bookmarks and resource sharing are no longer necessary
- Basic in-app communication replaces Slack for class-related messages

### Long-term (Phase 5+)
- The app is the complete CSG operating system
- Adding a new cohort, workshop, or module is straightforward
- Student engagement is fully visible without external tools
