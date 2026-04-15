# CSG Learning Platform — Product Vision & Direction

**Last updated:** 2026-04-07
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

Recordings should be hosted on AWS S3 with CloudFront CDN, not on YouTube. This gives CSG full control over video organization, granular watch-time tracking, resume position, and student progress visibility — without relying on YouTube's iframe API limitations.

### 5.5 Communication belongs in the platform

Slack is useful but should not remain the source of truth for class links, resources, recordings lists, announcements, or context about what students should do next. The app should absorb these responsibilities progressively.

### 5.6 Payments should be integrated

The manual email → Stripe link flow should be replaced with in-app payment processing via Stripe Checkout or embedded payment forms, enabling auto-enrollment on payment completion and payment status visibility in the admin dashboard.

### 5.7 Use external tools where they still make sense

The goal is not to rebuild everything. Examples of tools that stay external:

- **Zoom** for live video calls (link stored in class resources)
- **GitHub** for code hosting and some submission workflows
- **Clerk** for authentication and identity

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

### 6.2 Next — Self-hosted recordings (AWS S3)

Replace YouTube dependency with direct video uploads to S3:

- Active Storage + S3 for upload and storage
- HLS streaming via CloudFront for playback
- Granular watch-time tracking (percentage watched, resume position)
- Staff upload interface within content management
- Recording library organized by cohort/module/lesson

### 6.3 Next — Stripe payment integration

Replace manual email → Stripe link flow:

- Embedded Stripe Checkout or payment form
- Payment plans and installment support
- Auto-enrollment on payment completion
- Payment status visible in admin dashboard
- Invoice and receipt generation

### 6.4 Later — In-app messaging

Replace Slack as the primary communication channel:

**Recommended progression:**

1. **Announcements** — Staff posts visible to cohort
2. **Per-cohort channels** — Threaded discussions per class
3. **Alumni channel** — Not tied to a specific cohort
4. **Direct messages** — Staff ↔ student communication
5. **General channels** — Cross-cohort or topic-based

This requires ActionCable/WebSockets for real-time messaging, message persistence, and notification delivery.

### 6.5 Later — Extended platform features

- Workshop support (already works via module system)
- Alumni resource access
- Advanced/AI/remediation modules
- Notification and reminder system
- Zoom meeting management via API (if justified)

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
- Message / Channel (cohort-scoped and global)
- VideoUpload (S3 asset linked to content block)

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
