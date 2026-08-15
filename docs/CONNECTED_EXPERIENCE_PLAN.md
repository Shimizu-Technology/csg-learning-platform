# CSG Learning Platform — Connected Experience Plan

- **Last reviewed:** 2026-08-15
- **Status:** Approved implementation direction
- **Scope:** Rails API, React web app, Expo mobile app, staff operations, student navigation, privacy, and delivery sequencing

## 1. Executive decision

CSG Learning Platform already stores a connected learning graph, but the product exposes most of that graph as separate destinations. Students, cohorts, submissions, support requests, lessons, recordings, and conversations are related in the data model; the interface often drops that context when a user moves between them.

The next product chapter is therefore a **connected experience**, not a visual redesign and not a generic CRM conversion.

The governing interaction principle is:

> Wherever a user encounters a student, cohort, submission, lesson, support request, recording, or conversation, they can follow that relationship in either direction without losing their place.

The first center of gravity is a cohort-specific **Student Workspace** for staff. It will connect learning progress, submitted work, feedback, support, communication, engagement, and access controls while keeping each cohort enrollment distinct.

This work extends the active learning-feedback and intervention strategy in `PRODUCT_STRATEGY_AND_LEARNING_EXPERIENCE_PLAN.md`. It does not replace that strategy or move deferred enterprise LMS features forward.

## 2. Evidence reviewed

The decision is based on a fresh review of:

- Rails routes, models, controllers, serializers, schema, request tests, and development data;
- React routes, API types, shared layout, staff/student pages, and component boundaries;
- Expo Router routes, native staff/student screens, API client, notification routing, and demo fixtures;
- the running authenticated web app as an administrator;
- a rebuilt Expo SDK 57 development client in the iOS simulator;
- automated Rails, web, mobile, accessibility, and build contracts;
- the current product vision, roadmap, mobile parity plan, support workflow, and learning-experience strategy;
- official Salesforce record-page and related-list guidance;
- official Canvas Teacher context-card guidance;
- official Microsoft Education Insights privacy and activity guidance.

External references:

- Salesforce record pages: https://trailhead.salesforce.com/content/learn/modules/lex_customization/lex_customization_page_layouts
- Salesforce dynamic related lists: https://trailhead.salesforce.com/content/learn/projects/upgrade-to-dynamic-related-lists/get-started-with-dynamic-related-lists
- Canvas Teacher student context cards: https://community.instructure.com/en/kb/articles/661853-how-do-i-view-context-cards-in-the-teacher-app-on-my-ios-device
- Microsoft Education Insights: https://learn.microsoft.com/en-us/microsoft-365/education/guide/1-reference/baseline-reference-learning-accelerators

## 3. What the Salesforce analogy means for CSG

The useful Salesforce pattern is not visual density or a literal circular diagram. It is the combination of:

1. a stable page for each important record;
2. a concise highlights area with status and actions;
3. details and related-record views;
4. reciprocal links between records;
5. related lists filtered to the user and task;
6. role-specific actions and layouts;
7. preserved navigation context when moving through the graph.

CSG should implement those principles in a lighter, education-specific form. A relationship graph is not an initial requirement. For cohorts of roughly 4–30 learners, a clear record header, tabs, related lists, context drawers, breadcrumbs, and next/previous navigation will be faster and easier to use than a node visualization.

## 4. Re-audit findings

### 4.1 The data model is already connected

The existing domain supports most of the target experience:

- `User` connects to enrollments, progress, submissions, messages, direct conversations, and help requests.
- `Enrollment` connects a user to a cohort and carries cohort-specific module and lesson access.
- `Cohort` connects students, curriculum, workspace communication, office hours, recordings, resources, and announcements.
- `Submission` connects a user to a content block, lesson, rubric results, grader, and GitHub artifacts.
- `HelpRequest` connects a student and cohort to a lesson, exercise, or recording plus an owner and resolution.
- `DirectConversation` connects authorized users inside a cohort/community workspace.

Phase 1 can be implemented mostly through existing endpoints. Later phases need composed record payloads and intervention state, but not a wholesale schema redesign.

### 4.2 Person identity and learning context are currently conflated

The staff directory groups rows by cohort but links every enrollment to `/admin/students/:userId`. Development data demonstrates the problem: the same user can appear in two cohorts, and both rows open the same route even though access, progress, submissions, and support state are enrollment-specific.

Canonical staff navigation must preserve both identifiers:

```text
/admin/cohorts/:cohortId/students/:userId
```

The existing `/admin/students/:userId` route remains a compatibility route. It should redirect to the active/most relevant enrollment when there is one enrollment and present an enrollment chooser when there are multiple.

Learning history has one deliberate nuance: progress, submissions, knowledge-check attempts, and lesson-video progress are stored by user and curriculum content so evidence can follow a learner between cohort enrollments using the same curriculum. Cohort context still governs schedule, access overrides, help, recordings, workspace communication, and intervention operations. The existing restart service refuses a one-enrollment restart when another enrollment uses the same curriculum, which protects this shared history. The connected experience preserves that contract rather than adding misleading `enrollment_id` columns to learning evidence.

### 4.3 Student Detail is a progress matrix, not a complete workspace

The current web page provides identity, enrollments, overall progress, lesson access, watch progress, and destructive restart controls. Its primary content is a long curriculum tree. It does not provide a unified view of:

- ungraded, redo, and graded submissions;
- direct submission links;
- open and historical help requests;
- the student’s authorized direct conversation;
- recent cross-domain activity;
- enrollment-aware previous/next student navigation;
- a true read-only view of this student’s experience.

The mobile Student Health screen is a better summary model, but its “Full profile” handoff uses the same ambiguous web route.

### 4.4 Grading is queue-centric but submissions are not first-class records on web

The global queue and cohort-module matrix are operationally useful. However:

- a student name is usually plain text rather than a relationship link;
- a submission is normally opened inside local component state rather than a stable record route;
- there is no durable `Student → Cohort → Lesson → Submission` path;
- browser back, bookmarked review links, queue position, and filtered return state are weak;
- the review surface lacks a reusable student context action and direct DM action.

The native app does have `/staff/submission/:id`, but the submission header is not connected to the student workspace or cohort and does not provide direct messaging.

### 4.5 Messaging is polished but isolated from learning records

Channels and DMs are mature. The missing layer is relationship navigation:

- Message from Student Health opens the general inbox instead of the exact DM.
- Student names and avatars in messages do not open student context.
- A conversation launched from a lesson, submission, or help request cannot carry a visible source-record reference.
- Starting a DM is supported by the API but repeated independently in each client workflow.

Phase 1 should centralize an “open or create direct conversation” action.

### 4.6 Support signals do not yet become durable interventions

The support queue correctly uses explainable signals and the contextual help workflow has ownership and resolution. It does not yet record the broader intervention lifecycle already specified by product strategy:

- trigger and evidence snapshot;
- owner;
- outreach/action;
- next follow-up;
- private staff notes with explicit permissions;
- recovery plan;
- outcome and resolution.

Connected navigation should precede the intervention model so a case naturally links to the student, cohort, supporting submissions/help requests, and conversation.

### 4.7 Cohort Detail is connected but over-consolidated

The cohort page contains the correct domains—students, curriculum, communication, recordings, schedule, and lifecycle controls—but places them in one very long page with anchor links. It should become a stable cohort record with task-oriented tabs and related counts.

### 4.8 Generic cohort preview and per-student preview are different products

The existing `/admin/cohorts/:id/student-view` is a useful generic template preview. It intentionally does not impersonate a learner or expose private records. Calling it “Cohort student view” from an individual student page implies a stronger guarantee than it provides.

Required split:

- **Preview cohort template:** the current generic, zero-progress view.
- **View as this student:** a dedicated, server-authorized, read-only projection for one enrollment.

Every internal link in either preview must remain under its preview namespace. Mutations must be rejected server-side, not merely hidden in the client.

### 4.9 Mobile is a focused companion, not a smaller web app

The native product should continue to own quick, time-sensitive work:

- identify a learner needing attention;
- understand current state;
- open the learner’s DM;
- review one submission;
- acknowledge/respond to support;
- move to the next urgent record.

Dense matrices, bulk administration, curriculum authoring, and advanced access controls remain responsive-web handoffs.

Native gaps to close:

- cohort-aware full-profile handoff;
- exact DM handoff;
- student link and message action from a submission;
- student/cohort links from support records;
- previous/next urgent student or submission navigation where a queue context exists.

### 4.10 Privacy is a product boundary

Connected does not mean universally visible.

- Private DM bodies must not be copied into student-health summaries, analytics, intervention evidence, or generalized activity feeds.
- Staff may open a DM only through existing authorization.
- Summary surfaces may show safe metadata such as “conversation available,” unread state for the current staff member, or last authorized contact time if explicitly supported.
- Private staff notes require a dedicated model, explicit role policy, audit timestamps, and exclusion from student payloads.
- Student-authored help text, submission text/code, private feedback, and signed asset URLs remain excluded from product analytics.

## 5. Connected record model

### 5.1 Primary records

| Record | Identity | Important relationships |
| --- | --- | --- |
| Student enrollment workspace | `cohort_id + user_id` | cohort operations plus curriculum-scoped progress, submissions, and objectives; cohort-scoped recordings, help, interventions, DM, and access |
| Cohort | `cohort_id` | enrollments, curriculum, workspace, channels, announcements, schedule, recordings, resources |
| Submission | `submission_id` | student and curriculum content, selected enrollment-workspace context, lesson, module, rubric, grader, GitHub artifacts |
| Help request | `help_request_id` | student enrollment, source context, owner, response, conversation |
| Intervention | `intervention_id` | student enrollment, trigger/evidence, owner, notes, follow-up, outcome |
| Lesson/content | `lesson_id` / `content_block_id` | module, curriculum, assignments, progress, submissions, help |
| Conversation | `direct_conversation_id` / `channel_id` | workspace, cohort, members, optionally referenced source record |

### 5.2 Record-page contract

Every first-class record page should provide, as applicable:

1. a stable, shareable URL;
2. identity, status, and scope in the header;
3. a breadcrumb/relationship path;
4. role-aware quick actions;
5. Overview, Related, and/or Activity views appropriate to the record;
6. related-list counts and focused “view all” destinations;
7. reciprocal links back to the parent and related records;
8. return context for filtered queues;
9. keyboard focus and mobile touch targets of at least 44 px;
10. loading, empty, error, permission, and stale-data states.

### 5.3 Canonical route map

```text
/admin/cohorts/:cohortId
/admin/cohorts/:cohortId/students/:userId
/admin/cohorts/:cohortId/students/:userId/overview
/admin/cohorts/:cohortId/students/:userId/work
/admin/cohorts/:cohortId/students/:userId/learning
/admin/cohorts/:cohortId/students/:userId/support
/admin/cohorts/:cohortId/students/:userId/communication
/admin/cohorts/:cohortId/students/:userId/access
/admin/submissions/:submissionId
/admin/help-requests/:helpRequestId
/admin/interventions/:interventionId
/admin/cohorts/:cohortId/preview/*
/admin/cohorts/:cohortId/students/:userId/preview/*
```

Tabs may be represented by nested routes or a validated `tab` query parameter. The URL must remain stable and browser navigation must restore the selected view.

## 6. Student Workspace specification

### 6.1 Header

The desktop header remains visible while switching views and contains:

- breadcrumb: `Cohorts / Cohort name / Students / Student name`;
- avatar, name, email, GitHub identity, enrollment state, and presence/last activity;
- clickable cohort relationship;
- progress plus small, explicit signals: awaiting review, redo, active help/intervention;
- actions: Message, Grade next, View as student, More;
- previous/next student in the current cohort and a cohort student picker.

### 6.2 Overview

- recommended next staff action based on explicit records, not an opaque score;
- progress and current-week summary;
- open work/support/intervention highlights;
- recent cross-domain activity with links to source records;
- recording engagement summary;
- related cohort and enrollment information.

### 6.3 Work

- separate related lists for Awaiting review, Redo requested, and Reviewed;
- stable submission links;
- lesson/module context;
- submitted/graded relative times and attempt count;
- filters that survive navigation;
- empty states that explain what counts as work.

### 6.4 Learning

- module and lesson progress;
- objective/rubric evidence where available;
- content-block completion and linked submissions;
- recording and lesson-video engagement;
- access state without mixing in destructive controls.

### 6.5 Support

- open and acknowledged help first;
- resolved/canceled help history;
- linked source lesson/exercise/recording;
- owner and response state;
- interventions and recovery plans when those models ship;
- direct conversation action without duplicating private messages into the case.

### 6.6 Communication

- open/create the authorized cohort DM;
- safe conversation metadata only;
- related announcements or public channel references only when they are already visible to the current staff user;
- no generalized view of private message bodies.

### 6.7 Access

- enrollment status;
- module/lesson overrides;
- restart workflow;
- other audited administration controls;
- destructive actions visually and structurally separated from routine work.

## 7. Reusable student context

Create one compact `StudentContextCard`/drawer for use from:

- student directory;
- grading queue and submission page;
- support queue and help-request page;
- message author/avatar and DM header;
- cohort student list;
- intervention records;
- staff dashboard signals.

It should show only immediately useful context:

- name, cohort, last activity;
- progress;
- awaiting review/redo/open-help counts;
- actions: Open workspace, Message, Grade next.

It is a navigation accelerator, not a replacement for the Student Workspace.

## 8. Submission record specification

Web submission review moves to a stable `/admin/submissions/:id` route with:

- breadcrumb to cohort, student, module/lesson, and content block;
- clickable student identity and context drawer;
- grading content, rubric, feedback snippets, GitHub artifacts, and attempt metadata;
- direct Message action;
- previous/next submission in the originating queue;
- a return link that preserves queue filters and scroll position;
- related student work and open support signals without overwhelming the grading task.

Native `/staff/submission/:id` remains focused but adds student workspace and exact-DM actions plus cohort/lesson context.

## 9. Cohort record specification

Replace the long anchor-based workspace with URL-addressable views:

- Overview
- Students
- Learning
- Communication
- Schedule
- Recordings
- Settings

The cohort header contains status, dates, curriculum, counts, and role-aware actions. Selecting a student from the cohort retains cohort context.

## 10. Activity and intervention architecture

### 10.1 Activity timeline

Begin with a read-only projection of existing authoritative events:

- progress completions;
- submissions and grades;
- help-request state changes;
- recording completions/meaningful engagement;
- enrollment/access changes where audited.

Do not initially create a generic event table solely to power UI. Add a durable event model only when product requirements need immutable cross-domain history that source records cannot provide reliably.

### 10.2 Intervention model

After connected navigation is established, implement the strategy’s durable intervention state:

```text
Intervention
  enrollment_id
  trigger_type
  severity
  evidence_snapshot (structured, privacy-safe)
  status
  owner_id
  next_follow_up_at
  outcome
  resolved_at
  created_by_id
  timestamps

InterventionNote
  intervention_id
  author_id
  body
  timestamps
```

Notes are staff-only. Evidence snapshots use record IDs, categorical reasons, dates, and counts—not message bodies, code, free-form submissions, or private feedback.

## 11. Search and navigation

Once canonical record routes exist, add a keyboard-accessible command/search palette for:

- students/enrollments;
- cohorts;
- submissions;
- lessons/content;
- channels and authorized DMs;
- staff actions such as “open grading queue.”

Search results display the record type and relationship context. A student result must include cohort scope or offer an enrollment choice.

## 12. Delivery phases

### Phase 1 — Relationship foundations and Student Workspace

Goal: eliminate the highest-frequency context drops using existing models.

Delivery status: shipped in PR #97 with a Greptile 5/5 review and the full API, web, and native validation suites passing.

- add cohort-aware student routes and compatibility behavior;
- build the Student Workspace shell, header, tabs, related counts, and existing-data views;
- link submissions from student learning progress;
- add open/create exact-DM actions on web and native;
- add cohort-aware full-profile handoff on native;
- make student identities navigable in staff directories, grading, support, cohort, and message headers where authorization is clear;
- introduce stable web submission routes without removing existing queue workflows;
- rename generic preview to “Preview cohort template” and keep its links inside preview;
- add route/unit/request tests and end-to-end connected-navigation coverage.

### Phase 2 — Reusable context and operational records

Goal: make grading, support, and messaging feel like views of the same records.

Delivery status: shipped in PR #98 with a final Greptile 5/5 review and all API, web, and native checks passing. The implementation adds stable support records, source-aware messaging, queue-preserving grading navigation, URL-backed operational filters, and simulator walkthrough parity in addition to the items below.

- reusable web student context drawer;
- submission record workflow with return/previous/next queue context;
- help-request record view;
- student context in Messages and Support;
- contextual source-record chips for supported message launches;
- URL-state filters for grading/support;
- native submission and support relationship parity.

### Phase 3 — Cohort workspace and discovery

Goal: make cohort navigation and cross-record discovery predictable.

Delivery status: implemented across web and native and in final validation. Cohorts now open as URL-backed operational workspaces; staff can switch learners without leaving cohort context, preview a specific enrollment's real progress without exposing private communication, search commands/connected records/messages globally, review a privacy-safe composed activity feed, and follow normalized support/submission/message deep links.

- tabbed cohort record views;
- cohort-contained student picker and next/previous navigation;
- real per-enrollment read-only preview;
- universal command/search palette;
- initial composed activity timeline;
- deep-link and notification-path normalization across web/native.

### Phase 4 — Durable interventions and recovery

Goal: turn explainable attention signals into owned, auditable human workflows.

- intervention and staff-only note models;
- owner, follow-up, action, outcome, and resolution workflows;
- student-workspace and support-queue integration;
- recovery plans following restart/extended absence;
- due-follow-up views and notifications;
- native acknowledge/message/update actions with web history handoff;
- privacy, authorization, analytics, and audit tests.

### Phase 5 — Learning intelligence built on connected records

Goal: expose trustworthy mastery and curriculum insights only after the source workflows are operating.

- objective evidence/mastery views;
- GitHub test feedback relationships;
- curriculum struggle/redo patterns;
- cohort analytics that always drill down to source records;
- optional relationship visualization only if observed navigation needs justify it.

## 13. Acceptance criteria

### Cross-platform navigation

- From every staff-facing student name in a core workflow, staff can open cohort-specific student context.
- From a Student Workspace, staff can open the exact DM, an exact submission, the cohort, and the relevant lesson.
- From a submission, staff can return to the exact queue or student-workspace state that launched it.
- Browser back/forward restore route and tab state without surprise resets.
- Native Student Health Message opens or creates the correct cohort DM.
- Native submission review links back to the student and can open the exact DM.

### Enrollment correctness

- A user enrolled in two cohorts has two distinct Student Workspace URLs.
- Cohort operations, help, interventions, recordings, access, and preview data are scoped to the selected enrollment; curriculum learning evidence follows the existing user-plus-content continuity contract.
- Person-only compatibility routes do not silently choose the wrong cohort when multiple active enrollments exist.

### Preview safety

- Generic cohort preview remains clearly generic.
- Per-student preview is read-only and cohort/enrollment-specific.
- Preview navigation never escapes to normal student routes.
- Write endpoints reject preview attempts even if called outside the UI.

### Privacy and authorization

- Students cannot access staff record routes or another learner’s records.
- Instructors see only cohorts/workspaces authorized by existing role rules.
- Private DM bodies never appear in aggregated student activity or analytics.
- Staff-only notes never appear in student/session payloads.
- Every new API endpoint has request-level authorization coverage.

### Quality

- Web lint, TypeScript, unit tests, production build, Rails tests, and accessibility checks pass.
- Mobile typecheck, lint, Jest, Expo Doctor, iOS export/build, and targeted Maestro/device flows pass.
- Interactive controls are keyboard accessible on web and at least 44 px on touch surfaces.
- Connected routes have loading, empty, error, stale-data, and permission states.
- Core route chunks remain lazy-loaded and bundle growth is reviewed.

## 14. Non-goals and guardrails

- Do not copy Salesforce visual density.
- Do not add a relationship graph before simple navigation is proven insufficient.
- Do not replace the student’s clear Today experience with staff-style record chrome.
- Do not merge every existing page into one giant Student Workspace component.
- Do not create an opaque risk score.
- Do not treat completion, watch time, or message frequency as mastery.
- Do not expose private communication through convenience summaries.
- Do not duplicate source records into a generic activity store without a durable product requirement.

## 15. Implementation architecture

- Prefer composed API projections for record headers and related counts to many sequential client requests.
- Keep detailed lists independently pageable/filterable.
- Introduce small route-aware domain components rather than extending existing thousand-line page files.
- Centralize route builders for student, cohort, submission, help, and conversation records.
- Centralize open/create-DM behavior in web and native client helpers.
- Use explicit enrollment/cohort IDs in cache/query keys.
- Preserve compatibility routes and notification links during rollout.
- Instrument connected navigation with IDs and categorical source surfaces only.

## 16. Completion definition

The connected-experience initiative is complete when:

1. cohort-specific Student Workspace is the canonical staff view;
2. student identity is navigable from grading, support, messages, cohorts, and dashboards;
3. submissions and help/intervention cases are stable records with reciprocal links;
4. exact DMs open from student and related-record actions on web and native;
5. cohort navigation is tabbed and preserves context;
6. generic and student-specific previews are distinct and server-safe;
7. search can find the primary connected records;
8. intervention ownership/follow-up/outcomes operate on the connected model;
9. privacy and authorization contracts are verified;
10. the web and native acceptance suites prove the primary relationship journeys.
