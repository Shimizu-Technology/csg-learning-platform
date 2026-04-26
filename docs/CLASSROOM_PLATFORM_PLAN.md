# CSG Learning Platform - Classroom Platform Plan

**Last updated:** 2026-04-27
**Status:** Deferred near-term; continue using Zoom while this remains a future platform initiative
**Companion docs:** `docs/PRODUCT_VISION.md`, `docs/ROADMAP.md`

---

## Summary

Code School of Guam wants to replace Zoom for its core classroom workflow, but not by building a full Zoom clone.

This initiative is currently **documented and intentionally deferred**. The near-term operating plan is to keep using Zoom while the core learning platform and admin UX continue to improve.

The target is a **simplified, education-focused meeting and classroom system** built into `csg-learning-platform`.

The goal is to support:

- live video classes
- screen sharing
- session recording for replay
- simple host / teacher controls
- student join links
- breakout rooms
- workshops and office hours
- lightweight meetings between instructors and students
- optional later student-to-student meetings

The goal is **not** to build:

- phone dial-in
- enterprise administration
- a giant generic meeting SaaS
- support for every rare browser/device edge case
- a 100-feature Zoom competitor

---

## Why This Makes Sense

The product is already becoming the operating system for Code School of Guam:

- curriculum
- progress
- grading
- announcements
- messaging
- recordings
- cohort management

Live classes are still a major part of the student experience, so leaving them in a separate tool weakens the product.

Bringing class sessions into the platform would let CSG:

- keep sessions tied to cohorts and curriculum
- attach recordings directly to class sessions
- track attendance in the same system
- create a more branded student experience
- support office hours and collaboration later without leaving the app

This product should beat Zoom at being **a CSG classroom**, not at being **a universal meeting tool**.

---

## Product Framing

This should be treated as a **school-specific classroom platform** with three session modes:

### 1. Class session

Used for normal live classes.

Typical characteristics:

- scheduled
- instructor-led
- recording on by default
- screen sharing expected
- attendance required

### 2. Workshop / event session

Used for one-off workshops or special sessions.

Typical characteristics:

- scheduled
- lighter cohort coupling
- recording usually useful
- simpler join rules possible

### 3. Ad hoc meeting

Used for:

- instructor ↔ student meetings
- office hours
- student collaboration

Typical characteristics:

- lightweight
- shorter-lived
- recording optional
- fewer controls required

All three should share the same technical foundation, even if they are shipped in phases.

---

## What We Are Not Building

To keep this realistic, the first real version should not try to include everything.

Out of scope for the classroom MVP:

- dial-in phones
- webinar-scale production features
- complex enterprise moderation
- deep analytics dashboards
- advanced whiteboards
- heavy chat dependencies
- broad consumer meeting features
- giant-browser-matrix polish before real classroom usage exists

Chat is specifically **not a blocker** because the platform already has announcements, channels, and direct messages.

---

## Recommended Technical Strategy

### Do not build the video layer from scratch

The hard part of this product is not Rails models or React screens.

The hard part is:

- WebRTC reliability
- TURN / STUN / NAT traversal
- screen sharing
- recording infrastructure
- track management
- browser networking quirks

That should be delegated to a purpose-built media platform.

### Recommended approach

Build the CSG classroom product on top of **LiveKit**.

The platform should own:

- scheduling
- join permissions
- session metadata
- attendance
- recording metadata
- replay authorization
- session lists and history
- teacher/admin rules
- branded classroom UI

LiveKit should own:

- media transport
- room connectivity
- audio/video tracks
- screen sharing
- participant-level permissions
- recording / egress

---

## Why LiveKit Is the Best Fit

LiveKit is the strongest fit because it supports:

- custom React UI instead of forcing a generic meeting shell
- token-based room access and permissions
- native screen sharing
- webhook-driven room and participant lifecycle events
- recording / egress workflows
- room and participant management APIs

This makes it a better fit for a custom school product than a tool that is primarily centered on an embedded generic meeting experience.

### Important nuance

LiveKit gives us the media primitives, but **breakout rooms and classroom workflows are still application-level product design**.

That means breakout rooms are feasible, but they still need:

- backend state
- teacher controls
- assignment rules
- session UX decisions

This is still the right tradeoff.

---

## Alternatives Considered

There are other real options, but each one changes the tradeoffs.

### LiveKit

Best fit if the goal is to build a **branded classroom product** inside the platform.

Strengths:

- strong developer-focused APIs and SDKs
- custom UI instead of a fixed meeting shell
- token-based permissions
- webhook support for attendance and room lifecycle
- recording / egress support
- good fit for app-owned classroom workflows

Tradeoff:

- classroom logic still has to be built by CSG
- breakout rooms are an application workflow, not a turnkey school product

### Daily

Daily is a credible option, especially if speed of integration matters more than deeper product ownership.

Strengths:

- mature video API product
- very fast path if using Daily Prebuilt
- clear usage-based pricing
- custom app path exists with the call object and React helpers

Tradeoff:

- breakout rooms are tied to Daily Prebuilt and documented as beta
- stronger fit for "embed a meeting product" than for a deeply CSG-shaped classroom system

### 100ms

100ms is also a real contender and has strong classroom-oriented primitives.

Strengths:

- roles and room templates are useful for classroom scenarios
- strong feature surface for video products
- breakout room support exists
- recording assets can be pushed to external storage

Tradeoff:

- recording and breakout room behavior has important constraints
- public pricing is less transparent than Daily or LiveKit for lightweight planning
- still requires significant product-side classroom orchestration

### Agora

Agora is a long-standing infrastructure option and can absolutely power a classroom product.

Strengths:

- battle-tested realtime media infrastructure
- flexible pricing model
- broad feature surface

Tradeoff:

- feels more infrastructure-heavy for this exact use case
- likely more implementation surface area than needed for a focused CSG classroom MVP

### Self-hosted / open source options

Possible examples:

- Jitsi
- BigBlueButton
- OpenVidu
- self-hosted LiveKit

These can look attractive because they reduce vendor lock-in and can lower direct SaaS spend.

Tradeoffs:

- CSG becomes responsible for more infrastructure and reliability work
- recording, scaling, observability, and uptime become our problem
- custom product integration is still required
- the operating burden rises immediately

For a small team, this is usually harder operationally than using a managed media platform.

### Zoom / external meeting tools

Zoom remains the lowest-risk operational option in the short term.

Strengths:

- already works
- likely cheaper in the short term for a small number of hosts
- no engineering effort required to run classes tomorrow

Tradeoff:

- weak integration with the rest of the learning platform
- sessions, attendance, and recordings stay fragmented
- the classroom experience never becomes a real product strength of CSG itself

---

## Why Not Build It From Scratch

Building the full realtime stack from scratch is technically possible, but it is not the realistic path for this product.

### What "from scratch" really means

It does **not** just mean:

- making a session page
- adding a "Join class" button
- storing recordings in the database

It means owning:

- WebRTC session setup
- TURN / STUN infrastructure
- NAT traversal
- reconnection logic
- adaptive media quality behavior
- screen share behavior across browsers
- server-side recording pipelines
- room state synchronization
- browser/device debugging
- production reliability under poor network conditions

That is a very different project from "build a classroom feature into the app."

### Why it is a poor fit for CSG right now

For Code School of Guam, the real need is:

- small classes
- reliable live delivery
- replays
- instructor controls
- simple meeting workflows

None of those goals require CSG to invent its own media infrastructure.

If we build from scratch:

- delivery time gets much longer
- reliability risk goes way up
- maintenance burden becomes permanent
- engineering time gets pulled away from school-specific product work

### Bottom line on scratch-building

Building the **classroom product** is realistic.

Building the **underlying video infrastructure** ourselves is not the recommended path and would be unnecessary risk for the actual size and needs of the school.

---

## MVP Recommendation

The first classroom release should stay narrow and high value.

### Must-have MVP features

- create and schedule a class session
- join from the platform or a join link
- live video/audio
- screen sharing
- participant list
- host can start/end the room
- host can mute or remove a participant
- room lock option
- recording
- replay page for the recording
- attendance tracking

### Nice-to-have if scope allows

- co-host / TA role
- basic breakout-room flow

### Features to defer

- student-created meetings
- advanced breakout persistence
- transcript / AI summary
- calendar sync
- extra moderation layers

---

## Recommended Delivery Phases

### Phase 1 - Classroom MVP

Goal: run real classes on the platform.

Build:

- session scheduling
- join flow
- LiveKit integration
- live video/audio
- screen share
- recording
- replay pages
- attendance tracking
- host controls

Outcome:

- CSG can run normal classes without Zoom

### Phase 2 - Collaboration workflows

Goal: expand beyond lecture delivery.

Build:

- breakout rooms
- office hours
- instructor ↔ student meetings
- limited student collaboration meetings

Outcome:

- the platform becomes useful for day-to-day live interaction, not just class broadcast

### Phase 3 - Polish and expansion

Possible additions:

- smarter notifications
- calendar integration
- session templates
- richer moderation
- transcripts / summaries
- reporting and usage analytics

Outcome:

- the classroom system becomes a mature part of the CSG operating platform

---

## Product Rules That Should Be Decided Early

These decisions should be explicit before implementation:

1. Who can create which session types?
2. Which session types are recorded by default?
3. Whether student-created meetings are allowed at all
4. Whether peer meetings are cohort-scoped, invite-based, or both
5. How long recordings remain available
6. Whether breakout rooms are part of MVP or Phase 2

### Current recommendation

- admins and instructors can create class/workshop sessions
- students do not create meetings in MVP
- class sessions record by default
- office hours / ad hoc meetings can be optional recording later
- peer meetings should be authenticated and scoped, not open

---

## Suggested Domain Model Additions

The current app does not yet have a real live-session domain.

Conceptually, expect additions such as:

- `ClassSession` or `Session`
- `SessionParticipant`
- `AttendanceRecord`
- `SessionRecording`
- `SessionJoinLink`
- `BreakoutAssignment`

Potential future support models:

- `SessionReplayAccess`
- `MeetingInvite`
- `SessionTemplate`

Important implementation note:

Current recordings are cohort-scoped. For the classroom platform, recordings should become **session-scoped first**, while still being visible in cohort context.

---

## Implementation Guidance for This Repo

This feature should be treated as a **new domain subsystem**, not as a small extension of `class_resources`.

Recommended approach:

1. Add first-class backend models and APIs for sessions and attendance.
2. Add LiveKit token issuance and webhook ingestion on the Rails side.
3. Build React routes and session UI on top of the existing role system.
4. Reuse existing strengths:
   - Clerk auth
   - cohort permissions
   - recordings library
   - messaging
   - admin/staff dashboards

The system should remain tightly integrated with:

- cohorts
- staff roles
- student dashboards
- recordings/replay
- existing notifications/messaging

---

## Rough Economics for CSG's Current Usage

Based on the current rough operating pattern:

- around 2 classes per week
- around 3 hours per class
- around 5 to 10 participants per class
- another 1 to 2 hours of 1:1 meetings per week

The likely conclusion is:

- this can be affordable on a managed media platform
- it is probably **not** cheaper than Zoom in the short term
- the real value is product integration, not immediate cost savings

The current LiveKit Cloud pricing structure suggests the free plan is too small for this usage, mainly because recording/transcoding minutes would be exceeded quickly.

For CSG's current size, the managed-platform cost likely stays in a range that is operationally reasonable, but the bigger cost is still engineering time and support burden.

This means the project should be justified as:

- owning the classroom experience
- improving student workflow
- tying sessions, attendance, and recordings directly into the platform

It should **not** be justified mainly as:

- "this will definitely be cheaper than Zoom"

---

## Success Criteria

This initiative is successful when:

- CSG can run live classes in the platform without relying on Zoom
- students can easily find and rewatch past sessions
- attendance is tied to actual class sessions
- staff controls remain simple
- the experience feels like a classroom, not a bloated generic meeting app

---

## Recommendation

The recommended decision is:

- keep Zoom or the current external workflow as the short-term safety net
- build a focused proof of concept on top of LiveKit
- validate the real class flow first
- only replace Zoom once the platform version is clearly good enough for actual classes

The proof of concept should answer a practical question:

- can CSG reliably create, join, run, record, and replay a real class inside the platform?

If the answer is yes, the project is worth continuing.

If the answer is no, CSG still has a working external fallback and can revisit the scope without overcommitting.

---

## Bottom Line

This is a strong product direction as long as scope stays disciplined.

The right goal is:

> Build a simplified classroom platform for Code School of Guam on top of LiveKit.

The wrong goal is:

> Build a full Zoom replacement from scratch.
