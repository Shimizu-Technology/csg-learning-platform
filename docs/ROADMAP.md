# CSG Learning Platform — Roadmap

**Last updated:** 2026-04-22
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
- ✅ Video completion tracking (S3 preferred, with legacy YouTube/Vimeo support)
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

- ⚠️ Announcements and messaging are functional, but the UX still needs polish and operational hardening
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

> **Goal:** Make S3-hosted recordings the preferred path while preserving legacy YouTube links during migration.

### 2.1 Backend ✅
- ✅ `aws-sdk-s3` gem with `S3Service` (presigned POST for upload, presigned GET for streaming, delete)
- ✅ `Recording` model (cohort-scoped, s3_key, file_size, duration, position ordering)
- ✅ `WatchProgress` model (per-user per-recording: last_position, total_watched, auto-completion at 90%)
- ✅ `RecordingsController` — full CRUD + presign endpoint + stream_url + reorder
- ✅ `WatchProgressController` — update from player + staff views (per-student, per-cohort matrix)
- ✅ `StudentRecordingsController` — unified endpoint returning both legacy YouTube and S3 recordings
- ✅ Request/model coverage for recording CRUD guards, stream authorization, watch progress, and staff matrices

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

## Execution Note

Phase 3 was intentionally skipped for now. The team pulled Phase 4 forward and built communication first because it matters to every active cohort every class day, while Stripe is a less frequent operational workflow.

---

## Phase 3: Stripe Payment Integration (Deferred)

> **Goal:** Replace manual email → Stripe link flow with in-app payments.

**Why this is deferred:** The operational benefit is real, but communication was a higher day-to-day need for active cohorts, so that work shipped first.

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

## Phase 4: Communication Hub + PWA Notifications (Pulled Forward)

> **Goal:** Make the platform the daily communication home for CSG, with Slack-like class updates, unread state, and installable PWA push notifications.

**Why this shipped before Stripe:** Communication is used every class day. Payments matter, but the current cohort has only a few active payment workflows, while announcements, reminders, recordings, redos, and class messages affect every student and staff member all the time.

### 4.1 Phase 4a — Notification Foundation + First-Class Announcements ✅
- `Announcement` model instead of storing notices inside `cohort.settings`
  - Cohort-scoped announcements
  - Global announcements for all active students/staff
  - Pinned announcements
  - Publish/draft/archive lifecycle
- `Notification` model for reusable in-app notification records
  - Per-user read/unread state
  - Source polymorphism for announcements now and messages/DMs later
  - Notification types for announcements, messages, redos, recordings, and system notices
- Web Push subscription storage
  - Per-user browser/device subscriptions
  - Endpoint/key expiration handling
  - Opt-in/opt-out controls
- Staff announcement composer
  - Create, edit, archive, and pin announcements
  - Choose audience: global, staff, or a specific cohort
  - Optional push notification send
- Student/staff announcement feed
  - Dedicated "Announcements" / "Inbox" surface
  - Dashboard summary of latest unread/pinned notices
  - Mark one or all notifications as read
- PWA push notification support
  - Service worker push and click handlers
  - Permission prompt that appears in context, not on first page load
  - Push notifications for new announcements
  - Safe lock-screen copy without sensitive details by default

**Definition of done**
> Staff can publish a cohort or global announcement, enrolled students see it in-app with unread state, and installed PWA users who opted in receive a push notification.

### 4.2 Phase 4b — Cohort Channels ✅
- `Channel` model ✅
  - Per-cohort default class channel
  - Cohort-as-workspace navigation
  - Staff-only channels
  - Alumni/general channels later
- `Message` model ✅
  - Author, body, edited/deleted timestamps
  - Thread parent support for replies
  - Read receipts or per-channel read cursor
- Channel UI ✅
  - Message list
  - Composer
  - Unread counts
  - Workspace switcher for staff moving between cohorts
  - Mobile-first layout that feels like a messaging app inside the PWA
- Delivery strategy ✅
  - ActionCable/WebSockets for live message create/edit/delete events
  - API polling/refetch-on-focus remains as a fallback
- Push notifications for new channel messages ⚠️
  - ✅ Create in-app notifications for new messages
  - ✅ Enqueue Web Push delivery for opted-in recipients
  - Respect muted channels and notification preferences
  - Collapse noisy bursts where possible

**Definition of done**
> Each cohort has a class channel where staff and students can post messages, unread counts work, and opted-in users receive push notifications for new activity.

### 4.3 Phase 4c — Direct Messages ✅
- Staff-to-student and student-to-staff direct conversations
- Student-to-student DMs can be enabled per cohort if CSG wants peer messaging
- Conversation list with unread counts
- Real-time message updates through the same ActionCable pattern as channels
- Push notifications for DMs
- Mute/notification preferences per conversation
- Staff-visible context links back to student profile/progress

**Definition of done**
> Staff and students can communicate one-on-one inside the platform without leaving for Slack or email.

### 4.4 Phase 4d — Rich Messaging + Files (Ongoing Polish)
- S3-backed image/file attachments for messages and DMs
- Attachment presign endpoints with channel/conversation authorization
- Image previews and downloadable file cards
- Typing indicators
- Read receipts
- @mentions
- Emoji reactions
- Message search
- Pinned messages and important links
- Channel management (create, archive, rename, permissions)

**Definition of done**
> The installed PWA feels like a lightweight class communication app, with enough Slack-like behavior for day-to-day class operations.

### 4.5 PWA Quality Gates
- Install flow works on desktop, Android, and iOS home-screen PWA
- Offline route fallback remains reliable
- Push opt-in state is visible and reversible
- Notification clicks deep-link to the relevant announcement, channel, or DM
- No sensitive student data appears in lock-screen notifications unless explicitly allowed later
- Browser support is documented, especially iOS installed-PWA requirements

### Overall Definition of Done
> CSG can run class communication from the platform: announcements, unread notification state, cohort messages, DMs, and PWA push notifications replace the daily Slack loop for active cohorts.

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
Zoom integration is no longer the preferred long-term direction. If needed as a temporary bridge, Zoom links can still live in class resources, but the target state is a built-in classroom platform with a specialist realtime media provider underneath.

### 5.6 Classroom Platform (Planned)

> **Goal:** Replace Zoom for CSG's core class workflow without trying to build a full Zoom clone.

Current status:

- documented direction
- intentionally deferred for now
- Zoom remains the operational tool until this is revisited

Product scope:

- live video classes
- screen sharing
- session recording and replay
- attendance
- teacher controls
- join links
- breakout rooms
- office hours and lightweight meetings later

Recommended technical direction:

- keep Rails + React as the product shell
- add first-class session and attendance models
- use LiveKit for realtime media, participant permissions, screen sharing, and recording infrastructure

MVP target:

- staff-created class and workshop sessions
- student join flow from the platform
- live room experience
- recording and replay
- basic host controls

This should ship before any attempt to broaden into open-ended student-created meetings or a large feature surface.

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
- Slack bookmarks and resource sharing are no longer necessary
- In-app communication replaces Slack for class-related messages
- Students pay through the app once Stripe work is resumed

### Long-term (Phase 5+)
- The app is the complete CSG operating system
- Adding a new cohort, workshop, or module is straightforward
- Student engagement is fully visible without external tools
