# Product Analytics Event Contract

**Status:** Phase 1 foundation implemented; production EAS configuration complete; build 9 available in TestFlight; baseline begins after the first verified production event

**Last updated:** 2026-08-02

**Canonical project:** PostHog `csg-learning-platform`

**Reporting timezone:** `Pacific/Guam`, even though the PostHog project currently stores its default timezone as UTC

## 1. Decision

CSG uses explicit, decision-oriented product events. Web and native autocapture are disabled, native lifecycle capture is disabled, and session replay is disabled in both clients. Product events may contain numeric record IDs, booleans, counts, and short categorical slugs. They may never contain student- or instructor-authored content.

The typed runtime allowlists live in:

- `web/src/lib/analytics.ts`
- `mobile/src/lib/analytics.ts`

Both clients reject non-finite or negative numbers and strings that are not short lowercase categories. Unknown property names are removed before capture. Tests must fail if the contract begins accepting content-like values.

## 2. Never capture

Do not send any of the following to product analytics, person properties, exception metadata, session replay, or console capture:

- message, thread, announcement, help-request, feedback, or submission text;
- code, terminal output, commands, error-message contents, or search queries;
- raw or cleaned transcripts, audio, prompts, or provider responses;
- URLs, signed URLs, repository names, branches, commit SHAs, or filenames;
- names, email addresses, Clerk IDs, or notification bodies;
- free-form instructor notes or intervention notes.

PostHog identity uses the internal numeric user ID, role, and active cohort ID when available. Email and name are intentionally omitted.

## 3. Event taxonomy

The full Phase 1 allowlist is created up front so new features cannot invent incompatible properties during implementation.

| Event | Allowed properties | Source-of-truth comparison |
| --- | --- | --- |
| `weekly_plan_viewed` | cohort_id, week_number, role, required_count, platform | weekly-plan API responses and active enrollments |
| `learning_step_started` | cohort_id when known, module_id, lesson_id, content_block_id when applicable, block_type, platform | lesson access logs are directional only; do not treat a view as completion |
| `learning_step_completed` | cohort_id when known, module_id, lesson_id, content_block_id, block_type, source, platform | completed `progresses` and video progress |
| `submission_created` | cohort_id when known, content_block_id, submission_type, attempt, platform | `submissions` created or updated during the interval |
| `feedback_viewed` | cohort_id when known, submission_id, grade_state, age_bucket, platform | graded submissions; this event is a client view, not proof of comprehension |
| `redo_submitted` | cohort_id when known, submission_id, attempt, age_bucket, platform | submissions whose preceding state was redo |
| `help_requested` | cohort_id, context_type, context_id, category, urgency, platform | `help_requests` created during the interval |
| `help_request_resolved` | cohort_id, help_request_id, category, resolution_bucket, platform | resolved `help_requests` |
| `intervention_opened` | cohort_id, intervention_id, trigger_type, severity, platform | support-queue cases opened from explicit rules |
| `intervention_resolved` | cohort_id, intervention_id, trigger_type, outcome, age_bucket, platform | resolved support-queue cases |
| `recording_engaged` | cohort_id, recording_id, progress_bucket, captions_on, platform | persisted watch progress; use buckets, never raw playback history |
| `code_block_scrolled` | surface, overflow_bucket, platform | directional product usage only |
| `code_block_copied` | surface, normalized language category, platform | directional product usage only |
| `voice_draft_started` | surface, permission_state, platform | product usage only |
| `voice_draft_recorded` | surface, duration_bucket, platform | product usage only; never audio metadata or filenames |
| `voice_draft_transcribed` | surface, latency_bucket, outcome, platform | content-free provider request metrics |
| `voice_draft_inserted` | surface, raw_or_cleaned, platform | product usage only |
| `voice_draft_restored` | surface, platform | product quality signal |
| `voice_draft_sent` | surface, edit_distance_bucket, platform | ordinary sent-message count plus content-free client state |
| `voice_draft_discarded` | surface, stage, platform | product quality signal |

Categorical values use lowercase snake case and are capped at 40 characters. Code-language values are normalized to a 24-character slug or `other`. Time, duration, progress, latency, and edit distance use documented buckets rather than raw detailed telemetry.

## 4. Implemented capture points

The foundation release captures:

- lesson opening on web and native;
- manual, video, and submission-backed learning-step completion;
- submission and redo success;
- rendered graded feedback;
- native message code-block horizontal use and Copy;
- web lesson code-block Copy.

Weekly-plan, voice, and contextual-help events are implemented at their feature boundaries. `help_requested` fires only for a newly created request after server success; duplicate active requests do not emit it. `help_request_resolved` fires only after a successful staff resolution. Intervention and remaining recording events are added with their own product slices. A client event must not fire before the corresponding server write succeeds unless the event describes a clearly client-only action such as opening a view, starting a voice draft, scrolling, or copying.

## 5. Configuration

### Web

Set `VITE_PUBLIC_POSTHOG_KEY` and optionally `VITE_PUBLIC_POSTHOG_HOST`. Development opts out of capture. Autocapture and session replay remain disabled in code.

### Native

Set `EXPO_PUBLIC_POSTHOG_KEY` and optionally `EXPO_PUBLIC_POSTHOG_HOST` in the EAS build environment. Development and demo builds do not capture. Automatic screens, touches, lifecycle events, and session replay remain disabled. The app uses the internal user ID and role after the authenticated CSG session resolves.

The production EAS environment was configured on 2026-08-02 for the canonical `csg-learning-platform` project and `https://us.i.posthog.com`. Build 9 is the first submitted native release containing both this instrumentation and that production configuration.

## 6. Reconciliation and four-week baseline

Week 1 begins when build 9 is available to the intended TestFlight users and emits its first verified production event. For each Guam teaching week:

1. Query event counts by event, platform, cohort ID, and Guam-local day.
2. Compare server-write events with the matching Rails records created or resolved in the same interval.
3. Investigate duplicate ratios, missing platform values, unknown category values, and events without valid source IDs.
4. Record expected differences: views, scrolls, copies, and voice-draft stages intentionally have no one-to-one database record.
5. Review the results with Leon and the active instructor without exposing authored content.

After 28 production days, calculate the baseline distributions in `docs/PRODUCT_STRATEGY_AND_LEARNING_EXPERIENCE_PLAN.md`. Do not set percentage targets before that review. The software implementation is complete when events are live and reconcile; the outcome baseline is necessarily time-gated until four teaching weeks have elapsed.

## 7. Release verification

- Confirm custom events arrive in the CSG PostHog project, not another Shimizu Technology project.
- Confirm event properties contain only the keys in this document.
- Confirm no session-replay snapshot or touch-autocapture event originates from the new clients.
- Confirm development, demo mode, signed-out state, and a missing project key produce no custom event traffic.
- Confirm logout resets the native and web analytics identity.
- Use Guam-local reporting boundaries when reviewing cohort behavior.

Official implementation references: [PostHog React Native installation](https://posthog.com/docs/product-analytics/installation/react-native), [React Native autocapture controls](https://posthog.com/docs/libraries/react-native#autocapture), and [PostHog data-collection controls](https://posthog.com/docs/privacy/data-collection#autocapture).
