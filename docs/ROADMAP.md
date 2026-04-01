# CSG Learning Platform — Roadmap

**Last updated:** 2026-04-01  
**Status:** Active execution roadmap  
**Companion docs:** `docs/PRODUCT_VISION.md`, `docs/BUILD_PLAN.md`

---

## 1. Purpose of this roadmap

This document turns the product vision into an execution plan.

It answers:

- what we should build **now**
- what we should build **next**
- what can wait until **later**
- what needs to be good enough for **next week's real usage**

This roadmap is intentionally practical.

The goal is not to build every future feature immediately.
The goal is to make `csg-learning-platform` useful for real CSG operations as soon as possible, then expand it in the right order.

---

## 2. Current state

The platform already has a strong base:

### Already in place
- Rails API + React frontend foundation
- Clerk-based auth flow
- curriculum / module / lesson / content block structure
- student dashboard and module/lesson views
- admin content management
- lesson editor
- grading workflow foundation
- student progress tracking
- student admin detail views
- module and lesson creation flows

### What this means
We are **past pure scaffolding**.

The product is no longer just an idea or starter app.
It already has the beginnings of the real learning platform.

Now the priority is to make it operational for actual CSG use.

---

## 3. Guiding principle for prioritization

When deciding what to build next, use this rule:

> **If it helps CSG run prework and live class from this app next week, it goes first.**

That means we prioritize:

1. learning flow
2. unlocks and access
3. progress and grading
4. staff controls
5. operational polish

We do **not** prioritize nice-to-have platform expansions ahead of the learning core.

---

## 4. Phase 1 — Next-week readiness

This is the highest-priority phase.

## Goal

> Use `csg-learning-platform` for real cohort operations next week without needing to fall back to scattered workflows for the critical path.

## Definition of done for Phase 1

A student should be able to:
- log in
- see the correct modules/lessons
- access unlocked content
- watch/read/complete content
- submit work where needed
- see progress clearly

A staff member should be able to:
- manage curriculum content
- see student progress
- grade work
- understand who is behind
- control what is unlocked

---

### 4.1 Unlock engine (top priority)

This is the single most important missing/critical system.

#### Must support
- unlock by cohort start date
- unlock by module day offset + lesson release day
- locked vs available states in student UI
- cohort-wide unlock behavior
- per-student override support
- manual unlock capability for staff

#### Deliverables
- lesson availability calculation on backend
- student-facing locked/unlocked display that is reliable
- admin controls for manual unlock override
- audit-friendly override model (even if minimal at first)

#### Why it matters
This is the backbone of prework and live class pacing.
Without this, the platform is content storage, not a learning system.

---

### 4.2 Cohort/module assignment model

We need a clear way to decide what content a cohort or student can see.

#### Must support
- assign modules to a cohort
- optionally assign extra modules to a student
- hide/unhide or unlock for specific students when needed

#### Deliverables
- cohort-to-module assignment rules
- student-specific module/lesson override support
- admin UI for assignment / unlock management (simple first pass is fine)

#### Why it matters
This is what lets prework, live class, advanced modules, and AI modules coexist cleanly.

---

### 4.3 Student dashboard clarity

The student experience needs to make the path obvious.

#### Must support
- “what should I do now?”
- “what unlocks next?”
- “what is complete?”
- “what needs redo or attention?”

#### Deliverables
- stronger current/next lesson emphasis
- clear locked state messaging
- completion state clarity
- clearer progress rollups per module

#### Why it matters
Even if staff tools are great, the platform fails if students are confused.

---

### 4.4 Grading and redo parity

The platform must handle the real review loop, not just display content.

#### Must support
- view submissions
- grade submissions
- leave feedback
- clearly show redo state
- show history / most recent submission context

#### Deliverables
- grading polish where needed
- student-visible feedback state
- redo state reflected in dashboard/lesson UX

#### Why it matters
The learning loop is not complete until students can receive and act on feedback.

---

### 4.5 Staff intervention tools

Staff need fast visibility into student health.

#### Must support
- who is behind
- who is inactive
- who needs follow-up
- who has incomplete/redo work

#### Deliverables
- at-risk / quiet / active status remains usable
- drill-down from student list into student detail
- easy access to progress context and submissions

#### Why it matters
This is one of the biggest operational wins vs fragmented tooling.

---

## 5. Phase 2 — Prework grader replacement

## Goal

> Reach true parity for any important workflow that still forces staff back into `csg-prework-grader`.

This phase starts as soon as the platform is usable next week.

### 5.1 Audit parity gaps

Create a short checklist of anything the old app still does better or exclusively.

Likely items:
- GitHub submission fetching nuance
- redo flow edge cases
- favorite/reusable comments
- notification behavior
- schedule-related admin controls
- cohort setup ergonomics

### 5.2 Port only what matters

We should not blindly copy every prework grader feature.
We should only port the parts that are:
- operationally important
- still missing
- still aligned with the new architecture

### 5.3 Keep identity modern

Even if GitHub remains part of the workflow, Clerk stays the identity layer.
GitHub should be a linked integration, not the root user model.

---

## 6. Phase 3 — Resource hub / recordings / class context

## Goal

> Start replacing Slack bookmarks and ad hoc resource sharing with structured in-app content.

This is high value, but lower priority than the learning core.

### 6.1 Resource hub / bookmarks

#### First version
- cohort resources
- module resources
- lesson resources
- important links section

#### Why this goes early in Phase 3
It is useful immediately and simpler than messaging.

---

### 6.2 Recordings library

#### First version
- recordings linked by module / lesson / cohort
- student-visible recordings list
- metadata stored in app
- external hosting still acceptable

#### Recommended approach
Short term:
- YouTube / Vimeo / hosted links are fine

Long term:
- consider Mux or another managed approach before raw self-hosting

#### Why not build self-hosting first
Video infra is a distraction if the learning workflow is still evolving.

---

### 6.3 Announcements / notices

Start with:
- staff announcements
- cohort-level notices
- lesson-level notes/reminders

This gives most of the value without building a general-purpose chat system.

---

## 7. Phase 4 — Messaging and communication workflows

## Goal

> Bring communication context into the platform without trying to replace Slack all at once.

### Recommended progression

#### Step 1
- announcements
- scheduled reminders
- simple staff-to-student notes/messages

#### Step 2
- cohort messaging thread or inbox
- student/staff direct communication inside the platform

#### Step 3
- only if it proves necessary, richer threaded or channel-like messaging

### What not to do too early
Do **not** start by building “Slack clone in app.”
That’s the expensive path with the worst short-term ROI.

---

## 8. Phase 5 — Flexible learning paths

## Goal

> Support more than one bootcamp path cleanly.

Once the core is stable, the platform should expand into:
- advanced module access
- AI module access
- remediation modules
- optional/elective content
- alumni content access
- workshop-specific pathways

This is where the curriculum/module model really pays off.

---

## 9. Concrete workstreams

These are the practical workstreams to organize around.

### Workstream A — Access & Unlocks
- unlock rules
- cohort schedule logic
- student override support
- manual unlock UI
- locked-state UX

### Workstream B — Student Journey
- dashboard clarity
- next lesson / next action guidance
- feedback and redo visibility
- progress accuracy

### Workstream C — Staff Operations
- grading queue
- progress monitoring
- at-risk tracking
- student detail drill-down
- unlock/admin controls

### Workstream D — Curriculum Management
- module assignment
- lesson sequencing
- content editing
- preview flows
- recording/resource association

### Workstream E — Platform Consolidation
- resources / bookmarks
- announcements
- recording library
- messaging later

---

## 10. Recommended immediate build order

If we are optimizing for next week, this is the order I would push:

### 1. Unlock engine + overrides
Without this, the app is not really pacing the curriculum.

### 2. Cohort/module/student assignment controls
Without this, we cannot flexibly deliver prework/live-class/advanced content.

### 3. Student dashboard polish
Students need a crystal-clear “do this next” flow.

### 4. Grading / redo polish
Feedback loop must be dependable.

### 5. Staff unlock/intervention controls
Staff need operational confidence.

### 6. Resource hub / recordings list
Useful next, but not ahead of the learning engine.

### 7. Messaging / announcements
After the platform is stable enough to be the source of truth.

---

## 11. What can wait

These are good ideas, but should not block next-week readiness:

- self-hosted video infrastructure
- rich in-app messaging / chat
- advanced analytics dashboards beyond actionable basics
- deep Slack replacement
- overbuilt permissions/admin systems
- broad automation before core workflows are dependable

---

## 12. Near-term success criteria

We should consider the platform successful in the near term if:

### Students can
- log in without confusion
- see the right module/lesson content
- understand what is unlocked now
- understand what is next
- submit and track their work
- see feedback and redo state clearly

### Staff can
- manage content
- manage unlocks
- view student progress
- identify who needs intervention
- grade and give feedback
- avoid relying on the old prework grader for critical workflows

---

## 13. Medium-term success criteria

We should consider the next stage successful if:

- Slack bookmarks are no longer essential
- recordings are organized in-platform
- the old prework grader is no longer operationally necessary
- adding a new module to a cohort is straightforward
- giving one student an extra or early module is straightforward
- the app feels like the central CSG learning hub

---

## 14. Summary

The order is:

### Now
- finish the learning core
- especially unlocks, assignment, progress, grading, and staff controls

### Next
- replace any meaningful dependency on `csg-prework-grader`

### Later
- absorb bookmarks/resources/recordings
- add announcements and eventually messaging
- expand into richer multi-module learning paths

The big rule:

> **Build the learning engine first. Build the surrounding platform second.**

That is the fastest path to making `csg-learning-platform` genuinely useful for CSG next week while still building toward the bigger all-in-one vision.
