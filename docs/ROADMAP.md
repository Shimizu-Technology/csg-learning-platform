# CSG Learning Platform — Roadmap

**Last updated:** 2026-04-07
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

### What's partially built

- ⚠️ Test coverage — authorization guards are tested, but model/controller coverage is minimal
- ⚠️ Recordings and resources — pages exist but content is managed via cohort settings JSON, not a dedicated model
- ⚠️ Announcements — backend endpoint exists, frontend display is basic

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

### 1.3 Prework Grader Retirement (In Progress)
- ✅ GitHub issue lifecycle on grading (create on R, comment on re-R, close on pass)
- ✅ Daily unlock email notifications (rake task + Resend integration)
- ✅ Redo notification email when graded R
- 🔲 Migrate any remaining data
- 🔲 Redirect old app to new platform
- 🔲 Archive `csg-prework-grader` repo

---

## Phase 2: Self-Hosted Recordings (AWS S3)

> **Goal:** Replace YouTube dependency with direct video uploads and granular tracking.

**Why this is highest-value next:** YouTube hosting is free but gives us no real control over video organization, watch progress tracking, or student engagement data. Self-hosting on S3 + CloudFront makes recordings a first-class feature.

### 2.1 Backend
- Active Storage configuration with S3 backend
- `VideoUpload` model (linked to content blocks)
- Upload endpoint with multipart support and progress tracking
- HLS transcoding pipeline (AWS MediaConvert or similar)
- Watch progress API (percentage watched, last position, resume)

### 2.2 Frontend
- Staff video upload UI within content management
- Custom video player with progress tracking
- Resume playback from last position
- Recording library page with search and filtering
- Student-visible completion status per recording

### 2.3 Infrastructure
- AWS S3 bucket configuration
- CloudFront CDN distribution
- IAM roles and policies
- Cost monitoring (storage + bandwidth)

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
