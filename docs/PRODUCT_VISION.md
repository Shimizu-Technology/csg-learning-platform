# CSG Learning Platform — Product Vision & Direction

**Last updated:** 2026-04-01  
**Status:** Active north-star document  
**Repo:** `csg-learning-platform`

---

## 1. What this product is

`csg-learning-platform` is the long-term **all-in-one learning platform for Code School of Guam**.

It is the successor to `csg-prework-grader`, but it is **not** just a prework app rewrite.

It should become the single place where CSG runs the learning experience for:

- prework
- live class
- recordings
- exercises
- grading and redo feedback
- progress tracking
- cohort management
- student-specific unlocks / overrides
- advanced / AI / extra modules
- class resources / bookmarks
- eventually messaging and announcements

The goal is simple:

> **Students and staff should not need to piece together the learning experience across multiple tools.**

The app should become the canonical CSG learning hub, with external tools used only where it still makes sense (for example Zoom, GitHub, and possibly video hosting).

---

## 2. Why this exists

### The current problem

Historically, CSG has used a mix of tools:

- `csg-prework-grader` for prework content + grading
- Slack for communication
- Slack bookmarks for resources and important links
- YouTube links / lists for recordings
- manual or semi-manual unlock workflows
- separate admin flows for tracking who is behind

That works at a small scale, but it becomes fragmented when the program includes:

- prework
- live class
- recordings
- additional modules (advanced, AI, etc.)
- per-student exceptions
- multiple cohorts moving at different speeds

### The product decision

Instead of continuing to patch together multiple systems, CSG needs one platform that owns:

- access
- curriculum structure
- unlock timing
- progress
- submissions
- grading
- feedback
- student/admin visibility
- class resources
- eventually communications

---

## 3. What we learned from `csg-prework-grader`

The prework grader proved that these workflows matter and should carry forward:

### Keep and improve

- daily unlocks by schedule
- force unlock / staff override
- staff grading workflow
- redo / feedback loop
- student progress tracking
- student dashboard of what is unlocked / complete / next
- staff visibility into who is behind
- cohort-based pacing
- notifications / reminders

### Do not carry over blindly

- GitHub as the primary identity system
- a product model centered only on "exercises"
- Slack as the long-term source of truth for resources or communication context
- tightly coupled full-stack Rails UI patterns that are hard to extend

`csg-prework-grader` was a successful product for a single phase of the school.

`csg-learning-platform` should generalize that into a broader learning system.

---

## 4. Product north star

This platform should be the **CSG learning operating system**.

That means:

### For students

A student should be able to:

- log in once
- see their assigned cohorts/modules
- see what is unlocked now
- see what is next
- watch recordings
- read lesson content
- complete exercises/checkpoints
- submit work
- receive grades and feedback
- track their progress over time
- eventually access important links/resources/messages in the same place

### For staff

A staff member should be able to:

- manage curricula, modules, lessons, and content blocks
- assign content to cohorts
- assign or unlock content for specific students
- monitor student progress
- see who is at risk / behind / inactive
- grade submissions
- leave redo feedback
- eventually send announcements or messages
- manage the full class workflow without jumping across multiple systems

---

## 5. Core product philosophy

### 5.1 Curriculum first, not prework first

This app is **not** modeled around prework only.

It is modeled around reusable curriculum structure:

- curriculum
- module
- lesson
- content block
- cohort enrollment
- progress
- submission

That lets the same system support:

- Prework
- Live Class
- Advanced Module
- AI Module
- Capstone
- Recordings library
- Workshops
- Alumni resources

### 5.2 Content is reusable; access is flexible

The same content should be reusable across cohorts.

A cohort should be assigned a curriculum or a set of modules.
A student should also be able to receive overrides.

Examples:

- all students in a cohort get prework + live class
- one student gets an AI module early
- one student gets an advanced module later
- one student gets a manual unlock override for a blocked day or lesson

### 5.3 Unlocking is a core system, not a side feature

Unlock logic is foundational.

The platform must support:

- scheduled unlocks by day/date
- module-level pacing
- lesson-level release timing
- cohort-wide schedules
- student-specific overrides
- manual unlocks by staff
- exceptions and special cases

This is one of the main value props of the entire app.

### 5.4 Communication belongs in the platform eventually

Slack is useful, but it should not remain the long-term source of truth for:

- important class links
- class resources
- recordings lists
- announcements
- context around where students should go next

The app should gradually absorb these responsibilities, starting with the simplest and highest-value ones.

### 5.5 Use external tools where they still make sense

The goal is not to rebuild everything.

Examples of tools that may stay external:

- **Zoom** for live calls
- **GitHub** for code hosting / some submission workflows
- **video hosting** providers like YouTube/Vimeo/Mux/S3

The platform should own the learning workflow, even if some media or communication delivery is powered externally.

---

## 6. Product scope: now, next, later

## 6.1 Now — Learning core

This is the highest priority.

The platform must fully support the day-to-day learning workflow for bootcamp operations:

- reusable curriculum structure
- modules + lessons + content blocks
- student dashboards
- progress tracking
- grading / submission flow
- cohort management
- admin content management
- unlock engine
- per-student override support

### Definition of success for this phase

> CSG can run prework and live class content from this platform without needing to fall back to `csg-prework-grader` for essential workflows.

---

## 6.2 Next — Feature parity and operational replacement

Once the learning core is solid, the next goal is to fully replace anything still uniquely handled by the prework grader.

This includes:

- any remaining grading workflow gaps
- redo flow parity
- GitHub-linked submission support where still needed
- reliable notifications/reminders
- unlock/admin override polish
- student/staff analytics and at-risk visibility

### Definition of success for this phase

> Staff no longer need to use `csg-prework-grader` for real operational work.

---

## 6.3 Later — Slack/bookmarks/recordings consolidation

After the learning core is stable, the platform should absorb the adjacent class workflows that currently live elsewhere.

### High-value later additions

#### A. Resources / bookmarks
A structured place for:
- cohort resources
- module resources
- lesson resources
- important links
- student-facing reference material

This should be one of the earliest "later" features because it is high value and relatively low complexity.

#### B. Recordings library
A proper recordings experience:
- recording list by cohort/module/lesson
- student-visible recordings hub
- eventually staff upload / organization tooling

Short term, external video hosting is fine.  
Long term, consider a more owned experience if it becomes a major product advantage.

#### C. Messaging / announcements
This should start simple.

The first version does **not** need to be Slack-in-the-app.

Recommended progression:

1. announcements
2. cohort messages / notices
3. direct staff-to-student messages
4. maybe richer conversation features later if actually needed

The app should first solve educational workflow communication, not generic chat.

---

## 7. Core domain model we are building toward

The product should continue to center around these concepts:

### Learning structure
- Curriculum
- Module
- Lesson
- ContentBlock

### People and access
- User
- Cohort
- Enrollment
- ModuleAssignment / access controls
- student-level overrides

### Learning activity
- Progress
- Submission
- Grade
- Feedback / redo

### Operational workflow
- unlock rules
- scheduled release
- announcements/resources (later)
- recording references (later)

This is the right direction because it supports both today's bootcamp flow and future CSG expansions.

---

## 8. Immediate product recommendations

These are the recommended priorities from here.

### Priority 1 — Unlock engine
Build / harden:

- day-based release rules
- cohort-level scheduling
- per-student override unlocks
- manual unlock controls for staff
- clear student visibility into what is locked vs available

### Priority 2 — Module and assignment model
Make it easy to:

- assign modules to cohorts
- assign extra modules to specific students
- unlock specific modules/lessons early
- support advanced / AI / remediation content cleanly

### Priority 3 — Student dashboard polish
Students should clearly understand:

- what to do now
- what comes next
- what is locked
- what needs redo
- what they have completed

### Priority 4 — Replace remaining prework-grader-only workflows
Anything essential still only living in the old app should be ported or rebuilt here.

### Priority 5 — Resources and recordings
Once the core learning flow is dependable, start collapsing Slack/bookmark/video-list workflows into the platform.

---

## 9. What this repo should optimize for

When making product or engineering decisions in this repo, optimize for:

1. **One platform for the full learning experience**
2. **Reusable curriculum structure, not one-off cohort hacks**
3. **Flexible access control at cohort and student level**
4. **A clear student path through content**
5. **Strong instructor visibility and intervention tools**
6. **Operational simplicity for CSG staff**
7. **Replacing fragmented workflows over time**

If a feature helps CSG stop depending on multiple scattered tools, it is probably in scope.
If a feature only makes the code cleverer without making the platform more useful, it is probably not the priority.

---

## 10. Short summary

`csg-learning-platform` should become the canonical CSG hub for:

- prework
- live class
- recordings
- exercises
- grading
- progress
- unlocks
- cohort operations
- student-specific learning paths
- eventually class resources and messaging

It should preserve the best ideas from `csg-prework-grader`, but move them into a cleaner, more modern, more flexible system built around reusable curricula and module-based learning.

---

## 11. Related docs

- `README.md` — repo overview / setup
- `docs/BUILD_PLAN.md` — original implementation plan / architecture notes
- `csg-prework-grader` — previous generation product and workflow reference
