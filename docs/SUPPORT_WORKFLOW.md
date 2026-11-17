# Contextual Help and Staff Support Workflow

**Status:** Phase 4 connected workflow implemented

**Last updated:** 2026-08-15

## Purpose

Contextual help gives a student one clear way to say where they are blocked without creating another chat system. A request stays attached to the exact lesson, exercise, or recording, appears in one staff queue, and remains visible to the student through response and resolution.

Contextual requests remain the student-visible support record. Staff can now promote an explainable signal into a separate staff-only intervention with explicit ownership, action, follow-up, private notes, recovery planning, and a required outcome.

## Student workflow

1. Open **I'm stuck** from a lesson, exercise, or recording.
2. Choose the closest category: concept, technical issue, instructions, feedback, or other.
3. Describe the step reached, the expected result, and what happened instead.
4. Mark the request urgent only when fully blocked and needing attention before the next class.
5. Send explicitly. A failed write keeps the on-screen draft and never claims success.
6. See `open`, `acknowledged`, or `resolved` state in the same context. Every instructor reply shows there, oldest first, including replies sent while the request stays open, and stays visible after resolution.
7. Cancel an active request if help is no longer needed. A new request can be made after resolution or cancellation.

Only one active request is allowed for the same student and context. Repeated sends return the existing request rather than creating duplicates.

## Instructor workflow

Open **Student support** on web (`/admin/support`) or native (`/staff/support`). Work in this order:

1. Urgent direct requests.
2. Other open direct requests, oldest first.
3. Acknowledged requests that still need a response.
4. Explainable learning signals: current redos, ungraded work, and seven or more days without activity.

Each request card in Support has two reply actions plus the request and its lesson (U-4.7):

- **Reply** sends a reply and keeps the request open, for a hint or a question back. The replier becomes the owner and the student is notified.
- **Reply & resolve** sends the reply and closes the request. Use it once the student has a useful next step or explanation; resolving without a written reply is rejected by the API.

**Acknowledge** stays on the request page (web and native) for taking ownership before writing anything; it tells the student who is looking. Both reply actions notify the student once per reply, after the reply is saved.

Create an intervention when support extends beyond answering one request or when redo, ungraded-work, inactivity, restart, extended-absence, or human judgment requires follow-through. Every active intervention has an owner and next follow-up. Staff move it through `open`, `contacted`, `waiting_on_student`, or `monitoring`; resolution requires an outcome and concise summary. Private notes stay on the case and never enter student or session payloads.

A restart atomically creates a recovery plan and monitoring intervention. The default weekly check-in is visible in the Student Workspace and intervention history. Staff can record check-ins, adjust pace and required/optional scope on web, and make focused status/follow-up/outcome updates on native.

**One definition of "behind" (T-3).** The attention list is the only place a learner is called out as needing attention. Today, Support, cohort home, the Students list ("Needs attention" filter and status column), the student page and peek cards all read it; no page computes its own "at risk" rule. Its inactivity reason runs on the same "last active" every page shows (`LearnerActivity`), and its progress counts come from `LearnerProgress`, so they match what the learner sees. Staff can message one learner from any row, or select several on the Students list and send each their own direct message (at most 25 at a time, through the normal direct-message checks and rate limit).

The queue's student signals are prompts for human judgment, not predictions or disciplinary labels. A student can appear for more than one transparent reason. The numeric priority is only a deterministic sort order and is never shown as a risk score.

## State contract

| State | Meaning | Allowed next action |
| --- | --- | --- |
| `open` | Staff can see the request; no owner yet | Staff acknowledge, reply (becomes `acknowledged`) or reply and resolve; student cancel |
| `acknowledged` | A staff owner is taking a look, and may have replied | Staff reply or reply and resolve; student cancel |
| `resolved` | Written staff response is visible | Terminal; student may create a new request |
| `canceled` | Student no longer needs this request | Terminal; student may create a new request |

Resolved and canceled requests cannot be reopened. Timestamps and ownership form the durable audit trail.

## Operating expectations

- Review urgent requests during the teaching day and never leave one without a human check.
- Acknowledge normal requests by the next class day.
- Keep answers specific and actionable. If a conversation is needed, say how and when it will happen.
- Do not copy student-authored request text into analytics, logs, notification bodies, or external tools.
- Notifications identify the student and context for staff, but omit the request message. Student notifications link back to the learning context.
- Use direct messages for conversation after the initial response when useful; the help request remains the durable status record.

The daily follow-up job notifies the current owner once for each due date. Moving the due date creates a new notification claim; resolving or canceling closes existing case notifications. This is an operational reminder, not an automated student-risk decision.

## Measurement and privacy

The clients emit `help_requested` only after a successful new server record and `help_request_resolved` only after a successful resolution. `intervention_opened` and `intervention_resolved` contain only IDs, trigger/severity/outcome categories, platform, and age bucket. Request text, actions, notes, outcomes summaries, and evidence values are never captured. Reconcile events against authoritative records using Guam teaching-week boundaries per `ANALYTICS_EVENT_CONTRACT.md`.

## Release checks

- Student can create, view, cancel, and recreate help for every supported context.
- Duplicate taps cannot create duplicate active requests.
- Inaccessible cohorts, lessons, exercises, and recordings are rejected server-side.
- Staff can acknowledge, reply and keep the request open, and resolve only with a reply.
- Student sees owner, state, and response on web and native.
- Staff push opens the native/web support queue; student push opens the lesson or recordings surface.
- Help-request and staff-queue payloads contain authored support text and are deliberately excluded from web local-storage and native persisted-query caches. A still-mounted failed composer keeps its draft in memory and never implies that an unsent write succeeded.
- No authored content appears in notification bodies or PostHog events.
- Evidence snapshots are server-generated and contain only IDs, categories, counts, and dates.
- Students cannot list, open, update, or infer intervention notes or recovery-plan check-ins.
- Restarts create a visible recovery plan and weekly follow-up in the same transaction as the audit snapshot.
