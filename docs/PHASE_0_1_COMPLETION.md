# Strategic Phase 0–1 Completion

Status date: 2026-08-02

## Decision

Phase 0 and Phase 1 are complete in product code. The remaining work below is release/measurement acceptance that cannot be truthfully completed in a local branch: physical-device checks, enabling the reviewed voice provider after privacy acceptance, and collecting the first 28 production days of event data.

Release status: production EAS configuration now includes the CSG PostHog project and ingest host. Build `1.0.0 (9)` is the planned first Phase 0–1 TestFlight candidate; its build, App Store Connect upload, Apple processing, internal-group availability, and physical-device results remain to be recorded as they complete.

## Phase 0 — interaction and readability

| Outcome | Product evidence | Verification |
|---|---|---|
| Long message code remains reachable | Native fenced code has horizontal scrolling, Copy, and overflow-only page controls | Unit coverage plus iOS/Android production exports |
| Mobile formatting matches web intent | Shared native formatted-message renderer supports code, lists, quotes, emphasis, inline code, and links; previews remove raw markers | Renderer and preview tests |
| Readability and accessibility improve | Semantic type roles, 11 pt meaningful-text floor, stronger muted contrast, Dynamic Type adaptations, 44 pt actions | Automated type/contrast tests and native lint/typecheck |

Operational gate: run the documented VoiceOver, largest Dynamic Type, Increase Contrast, and long-code smoke cases on the TestFlight build.

## Phase 1 — voice, plan, help, measurement, and continuity

| Outcome | Product evidence | Verification |
|---|---|---|
| Reviewed voice drafts | Foreground record → transcribe → conservatively format → edit → explicit Send for channels and DMs; temporary audio cleanup; release gate | Native/API tests and `VOICE_TO_TEXT_PLAN.md` acceptance matrix |
| One weekly orientation model | `/api/v1/weekly_plan` powers **This Week** on web/native with required vs optional work, carry-forward, redos, events, unlocks, deadlines, and recording catch-up | Rails projection tests, web/native tests |
| Contextual help with visible state | Authorized lesson/exercise/recording requests support open, acknowledged, resolved, and canceled state plus retained response | Rails model/integration tests and web/native checks |
| First staff support queue | Direct requests are separated from explainable redo, ungraded, and inactivity signals; staff can acknowledge and resolve | Projection/integration tests and web/native checks |
| Privacy-safe measurement | Typed content-free event contract on web/native; success events occur only after successful writes | Contract tests, typecheck, analytics reconciliation runbook |
| Offline continuity | Seven-day user-scoped learning cache; channel/DM/thread drafts; durable failed-message retry; version-aware text-submission drafts; authored state removed at sign-out | Storage tests, native suite, `OFFLINE_CONTINUITY.md` release checks |

Operational gates:

1. Build and upload candidate build 9 to App Store Connect, wait for processing, and make it available to the internal TestFlight tester.
2. Complete the voice privacy/provider checklist and representative Guam-network physical-device checks before enabling server transcription.
3. Reconcile build 9 events against Rails source records and complete the first 28-day baseline review. This is observation, not unfinished feature code.
4. Run the physical-device Phase 0 and offline-interruption smoke matrices on the release candidate.

## Deliberate later-phase boundaries

- Voice reuse in threads, contextual help, and grading feedback follows measured native message quality in Phase 2.
- Objectives, rubrics, retrieval checks, and richer feedback workflows are Phase 2.
- Durable intervention cases, recovery plans, follow-up ownership, and outcomes are Phase 3.
- Managed offline media downloads wait for retention, quota, device-loss, logout deletion, and signed-URL policy.
- Automatic background write queues wait for an idempotency contract; explicit retry currently prevents duplicate or falsely successful work.

New product work should now begin with Phase 2 unless one of the operational gates exposes a Phase 0/1 defect.
