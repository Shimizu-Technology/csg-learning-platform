# CSG Learning Platform — Product Vision & Direction

**Last updated:** 2026-04-22
**Status:** Active north-star document
**Repo:** `csg-learning-platform`

---

## 1. What this product is

`csg-learning-platform` is the **all-in-one operating system for Code School of Guam**.

It is the successor to `csg-prework-grader`, but it is not just a prework app rewrite.

It should become the single place where CSG runs every aspect of the learning experience:

- Prework
- Live class
- Workshops
- Recordings (self-hosted via AWS S3)
- Exercises and coding challenges
- Grading and redo feedback
- Progress tracking
- Cohort management
- Student-specific unlocks and overrides
- Advanced / AI / extra modules
- Class resources and bookmarks
- In-app messaging and announcements (Slack alternative)
- Payments and enrollment via Stripe

The goal is simple:

> **Students and staff should not need to piece together the learning experience across multiple tools.**

---

## 2. Why this exists

### The problem we solved

Historically, CSG used a mix of tools:

- `csg-prework-grader` for prework content and grading
- Slack for communication, bookmarks, and resource sharing
- YouTube for hosting and sharing class recordings
- Manual email → Stripe links for payment collection
- Separate admin flows for tracking who is behind

That works at small scale, but it becomes fragmented when the program includes prework, live class, recordings, additional modules, per-student exceptions, and multiple cohorts.

### The product decision

Instead of patching together multiple systems, CSG needs one platform that owns access, curriculum, unlocks, progress, submissions, grading, feedback, visibility, resources, communication, media, and payments.

---

## 3. What we learned from `csg-prework-grader`

### Keep and improve

- Daily unlocks by schedule
- Force unlock / staff override
- Staff grading workflow
- Redo / feedback loop
- Student progress tracking
- Student dashboard of what is unlocked / complete / next
- Staff visibility into who is behind
- Cohort-based pacing

### Do not carry over blindly

- GitHub as the primary identity system
- A product model centered only on "exercises"
- Slack as the source of truth for resources or communication
- Tightly coupled full-stack Rails UI patterns

---

## 4. Product north star

This platform should be the **CSG learning operating system**.

### For students

A student should be able to:

- Log in once and see everything they need
- See their assigned cohorts and modules
- See what is unlocked now and what is next
- Watch recordings (hosted in-app, not on YouTube)
- Read lesson content
- Complete exercises and checkpoints
- Submit work and receive grades and feedback
- Track their progress over time
- Access resources, links, and messages in the same place
- Make payments and manage their enrollment
- Communicate with staff and classmates

### For staff

A staff member should be able to:

- Manage curricula, modules, lessons, and content blocks
- Assign content to cohorts
- Assign or unlock content for specific students
- Monitor student progress and identify who needs intervention
- Grade submissions and leave redo feedback
- Upload and manage class recordings directly
- Send announcements and messages
- Manage payments and enrollment status
- Run the full class workflow without jumping across multiple systems

---

## 5. Core product philosophy

### 5.1 Curriculum first, not prework first

The app is modeled around reusable curriculum structure — not just prework exercises. This lets the same system support prework, live class, advanced modules, AI modules, capstone, recordings library, workshops, and alumni resources.

### 5.2 Content is reusable; access is flexible

The same content should be reusable across cohorts. A cohort gets assigned a curriculum. Individual students can receive overrides (early access, skipped modules, extra content).

### 5.3 Unlocking is a core system

Unlock logic is foundational: scheduled unlocks by day/date, module-level pacing, lesson-level release timing, cohort-wide schedules, student-specific overrides, and manual unlocks by staff.

### 5.4 Own the media pipeline

Recordings should be hosted on AWS S3 with CloudFront CDN, not on YouTube, whenever CSG is uploading and managing the media directly. This gives CSG full control over video organization, granular watch-time tracking, resume position, and student progress visibility — without relying on YouTube's iframe API limitations.

Legacy YouTube and Vimeo content can still coexist during migration, but self-hosted S3 recordings are the preferred path going forward.

### 5.5 Communication belongs in the platform

Slack is useful but should not remain the source of truth for class links, resources, recordings lists, announcements, or context about what students should do next. The app should absorb these responsibilities progressively.

### 5.6 Payments should be integrated

The manual email → Stripe link flow should be replaced with in-app payment processing via Stripe Checkout or embedded payment forms, enabling auto-enrollment on payment completion and payment status visibility in the admin dashboard.

### 5.7 Use external tools where they still make sense

The goal is not to rebuild everything. The decision should be based on whether a capability is core to the CSG student experience, or just infrastructure that should be delegated to a specialist provider.

Examples of tools that stay external:

- **GitHub** for code hosting and some submission workflows
- **Clerk** for authentication and identity

### 5.8 Own the classroom experience, not the raw media infrastructure

Live class is core to the student experience, so the long-term product direction is to bring classroom sessions into the platform itself instead of relying on Zoom links in class resources.

However, the platform should still avoid rebuilding low-level media infrastructure. The right strategy is:

- own scheduling, permissions, attendance, replay access, and classroom UI
- use a specialist realtime media provider underneath for audio/video transport, screen sharing, and recording

That means the product goal is a **CSG-specific classroom platform**, not a full generic meeting SaaS.

---

## 6. Product scope: now, next, and later

### 6.1 Now — Learning core (COMPLETE)

The platform fully supports day-to-day learning workflows:

- ✅ Reusable curriculum structure (curriculum → module → lesson → content block)
- ✅ Student dashboards with progress tracking
- ✅ Grading and submission flow with GitHub integration
- ✅ Cohort management with enrollments
- ✅ Admin content management with rich editing
- ✅ Unlock engine with day-based scheduling
- ✅ Per-student override support (module and lesson level)
- ✅ Role-based access control (student / instructor / admin)
- ✅ Video completion tracking (YouTube + Vimeo)
- ✅ Mobile-first responsive UI with PWA support
- ✅ PostHog analytics integration
- ✅ CI pipeline (RuboCop, Brakeman, bundler-audit, tests)

### 6.2 Now — Self-hosted recordings (AWS S3) (COMPLETE)

The platform now supports direct video uploads to a private S3 bucket:

- Presigned S3 uploads and presigned streaming URLs
- Granular watch-time tracking (percentage watched, resume position)
- Staff upload interface in cohort management
- Student recording library with S3 uploads and legacy YouTube links side by side
- Admin watch-progress matrix by cohort and recording
- Direct MP4 playback for Guam-scale traffic

Future media optimizations, if needed:

- CloudFront CDN in front of the private S3 bucket
- HLS transcoding for adaptive bitrate playback
- Automated thumbnail generation and media processing

### 6.3 Now — Communication hub and PWA notifications (Pulled forward ahead of payments)

Replace Slack as the daily class communication loop while keeping the scope intentionally lighter than a full Slack clone.

The first milestone is not chat. It is the notification foundation that all later communication features need:

1. **First-class announcements** — Staff can publish global or cohort-scoped announcements instead of storing notices inside cohort settings.
2. **In-app notification center** — Students and staff have durable read/unread state for announcements, messages, redos, recordings, and system notices.
3. **PWA push notifications** — Installed app users can opt into browser push notifications for important class activity.
4. **Cohort workspaces and channels** — Each cohort behaves like its own class workspace with shared channels for class discussion, announcements, staff coordination, and topic-specific conversations.
5. **Direct messages** — Staff and students can have one-on-one conversations tied to the learning context, with optional student-to-student messaging if CSG wants that for a cohort.
6. **Rich messaging** — Real-time delivery, mentions, reactions, S3-backed image/file attachments, search, pins, and notification preferences make the experience feel like a lightweight Slack built into the platform.

The product should feel like a class communication app inside the learning platform: useful every day, mobile-first, installable, and respectful about notification noise.

PWA push requirements:

- Ask for notification permission only after the user is signed in and shown the value.
- Support iOS installed-PWA behavior, while documenting that Safari requires adding the app to the home screen.
- Avoid sensitive content in lock-screen notifications by default.
- Deep-link notification clicks to the relevant announcement, channel, direct message, recording, or redo.

The real-time layer should use ActionCable/WebSockets for live channel and direct-message updates, while durable REST endpoints remain the source of truth for page loads, reconnects, and stale tabs.

The communication phase was intentionally executed before Stripe because it affects every active cohort every class day, while payments are a more occasional operational workflow.

### 6.4 Next — Stripe payment integration (Deferred until after communication)

Replace manual email → Stripe link flow:

- Embedded Stripe Checkout or payment form
- Payment plans and installment support
- Auto-enrollment on payment completion
- Payment status visible in admin dashboard
- Invoice and receipt generation

### 6.5 Later — Extended platform features

- Workshop support (already works via module system)
- Alumni resource access
- Advanced/AI/remediation modules
- Notification and reminder system
- Education-focused live classroom sessions built into the platform

---

## 7. Core domain model

### Learning structure
- Curriculum → Module → Lesson → ContentBlock

### People and access
- User → Enrollment → Cohort
- ModuleAssignment / LessonAssignment for overrides

### Learning activity
- Progress (per content block)
- Submission → Grade → Feedback

### Future additions
- Payment (user ↔ cohort enrollment)
- Richer media pipeline for uploads linked directly into lesson content
- Expanded communication controls and notification preferences
- Live classroom session models, attendance, and replay access

---

## 8. What this repo should optimize for

When making product or engineering decisions:

1. **One platform for the full learning experience**
2. **Reusable curriculum structure, not one-off cohort hacks**
3. **Flexible access control at cohort and student level**
4. **A clear student path through content**
5. **Strong instructor visibility and intervention tools**
6. **Operational simplicity for CSG staff**
7. **Replacing fragmented workflows over time**
8. **Own the critical data (videos, payments, communication)**

If a feature helps CSG stop depending on multiple scattered tools, it is probably in scope.

---

## 9. Related docs

- `README.md` — Repo overview and setup
- `docs/ROADMAP.md` — Execution plan with phases and priorities
- `docs/DEPLOYMENT.md` — Deployment runbook for Render + Netlify
- `docs/API_REFERENCE.md` — Complete API endpoint documentation
- `docs/BUILD_PLAN.md` — Original architecture and data model design
- `docs/FUTURE_IMPROVEMENTS.md` — Planned enhancements (GitHub onboarding, etc.)
