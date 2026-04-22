# CSG Learning Platform — Build Plan (v2)

**Date:** Feb 27, 2026
**Goal:** The CSG Hub — prework, live class, workshops, recordings, capstone, reusable across cohorts and groups
**Deadline:** Monday March 2 (MVP for student login + exercises)
**Repo:** `csg-learning-platform` (new repo, Rails API + React)

> Historical note: this document captures the original MVP plan. Several assumptions here are now superseded by the live product: Clerk auth is required in all environments, self-hosted S3 recordings are the preferred media path, in-app messaging shipped ahead of Stripe, and Slack is no longer the intended day-to-day class hub. Use `docs/PRODUCT_VISION.md` and `docs/ROADMAP.md` as the current source of truth.

---

## Architecture

| Layer | Tech | Notes |
|-------|------|-------|
| **Auth** | Clerk | Whitelist-based. Admin adds students by email. |
| **Frontend** | React + TypeScript + Tailwind v4 | Vite, mobile-first |
| **API** | Rails 8 API-only | Fork from starter-app patterns |
| **DB** | Neon PostgreSQL | Free tier |
| **Frontend hosting** | Netlify | `learn.codeschoolofguam.com` |
| **API hosting** | Render (Singapore) | `learn-api.codeschoolofguam.com` |

---

## Core Design Principles

1. **Content is separate from cohorts.** Lessons exist in a reusable library. Cohorts reference content via curriculum templates. Cohort 4 doesn't recreate 128 exercises — it reuses Cohort 3's curriculum.

2. **Mobile-first.** Students will use phones. Design for small screens, then scale up.

3. **Build for the long run.** Data model supports prework, live class, capstone, advanced modules, per-student assignments, multiple instructors, future cohorts — from day one.

4. **Iterate in public.** MVP launches Monday with core student experience. We improve weekly during prework with real feedback.

5. **One platform for everything CSG.** Not just a prework grader — this is the CSG Hub.

| What | Where |
|------|-------|
| Prework content + exercises | CSG Learning Platform |
| Live class content + exercises | CSG Learning Platform |
| Class recordings (legacy YouTube at MVP, S3 preferred now) | CSG Learning Platform |
| Workshop recordings + materials | CSG Learning Platform |
| Student progress + grading | CSG Learning Platform |
| Capstone tracking | CSG Learning Platform |
| Alumni resources | CSG Learning Platform |
| Real-time chat / questions | In-app messaging (Slack was the original MVP assumption) |

---

## Data Model

### Users (synced from Clerk)
```
users
├── clerk_id (string, unique, not null)
├── email (string, unique, not null)
├── first_name (string)
├── last_name (string)
├── role (enum: admin | instructor | student)
├── github_username (string, nullable — added by student later)
├── avatar_url (string, nullable)
├── last_sign_in_at (datetime)
└── timestamps
```

### Curricula (reusable course templates)
```
curricula
├── name (string) — e.g., "CSG Full-Stack Bootcamp 2026"
├── description (text)
├── total_weeks (integer)
├── status (enum: draft | active | archived)
└── timestamps
```
A curriculum is the master blueprint. It contains modules and lessons that can be reused across any cohort.

### Modules (sections within a curriculum)
```
modules
├── curriculum_id (FK)
├── name (string) — e.g., "Prework", "Live Class", "AI Engineering", "Capstone"
├── module_type (enum: prework | live_class | capstone | advanced | workshop | recording)
├── description (text)
├── position (integer — sort order)
├── total_days (integer — how many days this module spans)
├── day_offset (integer — starts on day X of the curriculum, e.g., prework=0, live_class=35)
└── timestamps
```

### Lessons (individual content pieces within a module)
```
lessons
├── module_id (FK)
├── title (string)
├── lesson_type (enum: video | exercise | reading | project | checkpoint)
├── position (integer — sort order within module)
├── release_day (integer — day relative to module start, e.g., day 0, 1, 2...)
├── required (boolean, default true)
└── timestamps
```

### ContentBlocks (the actual content within a lesson — ordered)
```
content_blocks
├── lesson_id (FK)
├── block_type (enum: video | text | exercise | code_challenge | checkpoint | recording)
├── position (integer — sort order within lesson)
├── title (string, nullable — for display)
├── body (text, nullable — markdown for text/exercise instructions)
├── video_url (string, nullable — legacy YouTube/Vimeo embed URL)
├── solution (text, nullable — hidden from students, visible to admins)
├── filename (string, nullable — for GitHub submission matching)
├── metadata (jsonb, default {}) — flexible storage for extras
└── timestamps
```

This is the key design: a lesson like "Version Control" can have:
1. 📹 Video block: "What is Git?" 
2. 📝 Text block: Key concepts recap
3. 💻 Exercise block: Install GitHub Desktop
4. 💻 Exercise block: Create your first repo
5. ✅ Checkpoint block: Push about.txt to GitHub

Each block is independently trackable.

### Cohorts (groups of learners — bootcamp, workshop, alumni, custom)
```
cohorts
├── name (string) — e.g., "Cohort 3", "AI Workshop Feb 2026", "Alumni"
├── cohort_type (enum: bootcamp | workshop | alumni | custom)
├── curriculum_id (FK)
├── start_date (date, not null)
├── end_date (date, nullable)
├── github_organization_name (string, nullable)
├── repository_name (string, default "prework-exercises")
├── requires_github (boolean, default false) — bootcamp=true eventually, workshop=false
├── status (enum: upcoming | active | completed | archived)
├── settings (jsonb, default {}) — per-cohort overrides
└── timestamps
```

**Cohort types:**
| Type | Use Case | GitHub? | Example |
|------|----------|---------|---------|
| bootcamp | Full program students | Optional (for code submissions) | "Cohort 3" |
| workshop | One-off events, meetups | No | "Intro to AI Workshop" |
| alumni | Past graduates | No | "CSG Alumni" |
| custom | Anything else | Optional | "Advanced Rails Study Group" |

**Key insight:** Anyone just needs an email to join. No GitHub friction. Workshop attendees who later join the bootcamp already have an account — just add them to the new cohort.

### Enrollments (students ↔ cohorts)
```
enrollments
├── user_id (FK)
├── cohort_id (FK)
├── status (enum: active | paused | dropped | completed)
├── enrolled_at (datetime)
├── completed_at (datetime, nullable)
└── timestamps
```

### ModuleAssignments (which modules a student can see — for per-student flexibility)
```
module_assignments
├── enrollment_id (FK)
├── module_id (FK)
├── unlocked (boolean, default true)
├── unlock_date_override (date, nullable — custom unlock for this student)
└── timestamps
```

By default, all modules in the curriculum are assigned to all students. But you can:
- Unlock an advanced module for just Kevin
- Delay a module for a student who joined late
- Skip a module for someone with prior experience

### Progress (per content block tracking)
```
progress
├── user_id (FK)
├── content_block_id (FK)
├── status (enum: not_started | in_progress | completed)
├── completed_at (datetime, nullable)
└── timestamps
```

Lightweight. Student watches video → mark complete. Student reads text → mark complete. Auto-calculated up to lesson level and module level.

### Submissions (for graded exercises — ported from current app)
```
submissions
├── content_block_id (FK — the exercise block)
├── user_id (FK — the student)
├── text (text — submitted code)
├── grade (enum: A | B | C | R — redo)
├── feedback (text, nullable — instructor notes)
├── graded_by_id (FK → users, nullable)
├── graded_at (datetime, nullable)
├── github_issue_url (string, nullable)
├── github_code_url (string, nullable)
├── num_submissions (integer, default 1)
└── timestamps
```

---

## Pages

### Student Views

**1. Dashboard** (`/`) — Mobile-first
- Welcome card: name, cohort, overall progress %
- Current module highlighted with progress ring
- Today's lessons (based on unlock schedule)
- Action items: ungraded redos, incomplete exercises
- Quick "continue where I left off" button

**2. Module View** (`/modules/:id`)
- Module header: name, description, progress bar
- Lessons listed by day
- Each lesson: title, type icons, completion badges
- Locked lessons: lock icon + "Unlocks March 9"
- Expandable accordion OR click-through to lesson

**3. Lesson View** (`/lessons/:id`)
- Content blocks rendered top-to-bottom:
  - Video: YouTube embed (responsive)
  - Text: Markdown rendered
  - Exercise: Instructions + code area or GitHub link
  - Checkpoint: Checklist-style confirmation
- Each block has "Mark complete" control
- Submission area for exercises (grade shown if graded)
- Previous/Next lesson navigation

**4. Profile** (`/profile`)
- Edit GitHub username
- View enrollment info
- Progress summary across all modules

### Admin/Instructor Views

**5. Admin Dashboard** (`/admin`)
- Cohort overview: enrolled count, active count, overall progress
- Student progress heat map (who's on track, who's behind)
- Quick actions: add student, manage content, go to grading

**6. Student Management** (`/admin/students`)
- Table: name, email, GitHub, progress %, last active, status
- Click student → detailed progress view (every lesson/block)
- Add student → Clerk invitation by email
- Module assignment controls per student

**7. Content Management** (`/admin/content`)
- Curriculum → Modules → Lessons → Content Blocks (nested CRUD)
- Drag-and-drop reordering at every level
- Inline editing for content blocks
- Preview mode (see it as a student would)
- Import from CSV (for migrating existing exercises)
- Bulk unlock/lock controls per cohort

**8. Grading** (`/admin/grading`)
- Filter: by student, by module, by ungraded only
- Fetch GitHub submissions (same logic as current app)
- Side-by-side: student code vs solution
- Grade buttons: A / B / C / R
- Feedback text box
- "Request redo" → creates GitHub issue
- Batch grading mode

---

## Auth Flow

1. **Admin (Leon)** creates Clerk organization for "CSG Cohort 3"
2. **Admin** invites students by email (Kevin: factorkevin24@gmail.com, Lance: his email)
3. **Students** get email → click invite → create account (email + password)
4. **On first login:** Backend syncs user from Clerk JWT → creates User record → auto-enrolls in active cohort
5. **Student** sees their dashboard with assigned modules and lessons
6. **GitHub username** — student adds it in their profile whenever they're ready. Not required for login.

**Roles:**
| Role | Who | Access |
|------|-----|--------|
| admin | Leon | Everything — CRUD all content, manage students, grade, settings |
| instructor | Alanna | View students, grade submissions, view content (no edit) |
| student | Kevin, Lance | View assigned content, submit work, track progress |

---

## Exercise Data Migration

**Current state:** 128 exercises across 5 weeks in `db/exercises.csv`
- 63 have Vimeo video URLs
- 65 have no video (exercise-only)

**Migration plan:**
1. Create curriculum: "CSG Full-Stack Bootcamp 2026"
2. Create module: "Prework" (type: prework, position: 1, day_offset: 0)
3. Map CSV rows to lessons + content blocks:
   - Each CSV row → 1 lesson
   - If has video_url → video content block + exercise content block
   - If no video → exercise content block only
   - Instructions → exercise block body
   - Solution → exercise block solution
   - Filename → exercise block filename
   - Release_day stays as-is for unlock logic
4. Vimeo URLs imported as-is (they work, just need privacy settings fixed OR replaced with YouTube)
5. Rake task: `rails curriculum:import_csv[path]`

---

## Unlock Logic

Same as current app but cleaner:

```
lesson.release_day = 0  (available on cohort start_date)
lesson.release_day = 1  (available start_date + 1 day)
...

unlock_date = cohort.start_date + module.day_offset + lesson.release_day

lesson_available? = Date.current >= unlock_date || admin_override
```

Module-level: a module is "available" if at least one of its lessons is unlocked.

Per-student override: `module_assignments.unlock_date_override` can override the calculated date.

---

## Build Order

### Phase 1: Scaffold (Friday night)
- [ ] Create `csg-learning-platform` repo
- [ ] Rails 8 API: models, migrations, routes
- [ ] React frontend: Vite + Tailwind v4 + React Router
- [ ] Clerk integration: backend JWT verification + frontend provider
- [ ] Seed script: import exercises from CSV → curriculum + modules + lessons + content blocks

### Phase 2: Student Experience (Saturday)
- [ ] Student dashboard with progress
- [ ] Module view with lesson list
- [ ] Lesson view with content blocks (video embed + text + exercise)
- [ ] Mark complete / progress tracking
- [ ] Unlock logic (day-based)
- [ ] Mobile responsive

### Phase 3: Admin (Saturday night / Sunday)
- [ ] Admin dashboard with student overview
- [ ] Student management (list, add via Clerk, view progress)
- [ ] Content management (CRUD modules, lessons, content blocks)
- [ ] Basic grading view

### Phase 4: Deploy + Test (Sunday)
- [ ] Deploy API to Render (Singapore)
- [ ] Deploy frontend to Netlify
- [ ] Neon DB provisioned
- [ ] DNS: learn.codeschoolofguam.com
- [ ] Add Leon, Alanna, Kevin, Lance to Clerk
- [ ] End-to-end test as each role
- [ ] Verify exercise data, video embeds, unlock dates

### Phase 5: Ongoing (during prework weeks 1-5)
- [ ] GitHub submission fetching + grading UI
- [ ] GitHub issue creation for redos
- [ ] Live class modules added
- [ ] Content block drag-and-drop reordering
- [ ] Progress analytics + student insights
- [ ] Jerry CLI integration (JRY-189)
- [ ] Replace Vimeo URLs with YouTube as Alanna records

---

## Fallback Plan

Old prework grader stays running at `csg-prework-grader.onrender.com`. If anything breaks Monday morning:
1. Students log in to old app via GitHub OAuth
2. Leon fixes new platform
3. Students switch over when ready

No downtime risk for students.
