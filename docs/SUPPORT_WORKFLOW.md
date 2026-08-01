# Contextual Help and Staff Support Workflow

**Status:** Phase 1 implemented

**Last updated:** 2026-08-01

## Purpose

Contextual help gives a student one clear way to say where they are blocked without creating another chat system. A request stays attached to the exact lesson, exercise, or recording, appears in one staff queue, and remains visible to the student through response and resolution.

This is the first support workflow, not the full Phase 3 intervention-case system. It intentionally does not add private case notes, follow-up dates, recovery plans, or outcome tracking yet.

## Student workflow

1. Open **I'm stuck** from a lesson, exercise, or recording.
2. Choose the closest category: concept, technical issue, instructions, feedback, or other.
3. Describe the step reached, the expected result, and what happened instead.
4. Mark the request urgent only when fully blocked and needing attention before the next class.
5. Send explicitly. A failed write keeps the on-screen draft and never claims success.
6. See `open`, `acknowledged`, or `resolved` state in the same context. An instructor's written response remains visible after resolution.
7. Cancel an active request if help is no longer needed. A new request can be made after resolution or cancellation.

Only one active request is allowed for the same student and context. Repeated sends return the existing request rather than creating duplicates.

## Instructor workflow

Open **Student support** on web (`/admin/support`) or native (`/staff/support`). Work in this order:

1. Urgent direct requests.
2. Other open direct requests, oldest first.
3. Acknowledged requests that still need a response.
4. Explainable learning signals: current redos, ungraded work, and seven or more days without activity.

Use **Acknowledge** when taking ownership. This immediately tells the student who is looking. Use **Respond and resolve** only after adding a useful next step or explanation; resolution without a written response is rejected by the API.

The queue's student signals are prompts for human judgment, not predictions or disciplinary labels. A student can appear for more than one transparent reason. The numeric priority is only a deterministic sort order and is never shown as a risk score.

## State contract

| State | Meaning | Allowed next action |
| --- | --- | --- |
| `open` | Staff can see the request; no owner yet | Staff acknowledge or resolve; student cancel |
| `acknowledged` | A staff owner is taking a look | Staff resolve; student cancel |
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

These are operating expectations, not automated service-level guarantees. Phase 3 will add explicit ownership, follow-up dates, notes, recovery plans, and outcomes only after this simpler workflow has real usage data.

## Measurement and privacy

The clients emit `help_requested` only after a successful new server record and `help_request_resolved` only after a successful resolution. Allowed properties are numeric IDs, category, urgency, platform, and a time bucket. Request text and instructor responses are never captured. Reconcile client events against `help_requests` records using Guam teaching-week boundaries per `ANALYTICS_EVENT_CONTRACT.md`.

## Release checks

- Student can create, view, cancel, and recreate help for every supported context.
- Duplicate taps cannot create duplicate active requests.
- Inaccessible cohorts, lessons, exercises, and recordings are rejected server-side.
- Staff can acknowledge and can resolve only with a response.
- Student sees owner, state, and response on web and native.
- Staff push opens the native/web support queue; student push opens the lesson or recordings surface.
- Help-request and staff-queue payloads contain authored support text and are deliberately excluded from web local-storage and native persisted-query caches. A still-mounted failed composer keeps its draft in memory and never implies that an unsent write succeeded.
- No authored content appears in notification bodies or PostHog events.
