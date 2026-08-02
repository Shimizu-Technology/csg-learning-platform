# Strategic Phase 2 Completion

Status date: 2026-08-02

## Decision

Phase 2 is complete in product code. The platform now supports a visible learning chain from intended outcome to student task, formative or rubric evidence, and actionable feedback on both web and native surfaces.

This decision does not claim that every production lesson has been pedagogically configured. Instructors still need to choose meaningful objectives, criteria, and retrieval prompts for live curriculum. Voice transcription also remains fail-closed until the privacy/provider and physical-device release gates pass.

## Delivered outcomes

| Outcome | Product evidence | Review record |
|---|---|---|
| Mobile code reachability | Long formatted code can be dragged horizontally by touch; optional paging and Copy remain available | PR #83 |
| Objectives before work | Reusable ordered objectives and success criteria can be aligned to lessons and are visible on web/native | PR #84 |
| Criteria before and after work | Reusable rubrics attach to submission blocks; students see criteria before submitting and criterion ratings/feedback after grading | PR #85 |
| Faster, still-human feedback | Shared snippets insert editable text; owners/admins manage lifecycle and inactive snippets cannot be used | PR #86 |
| Retrieval-based evidence | Objective-linked checkpoint questions hide answers before an attempt, return immediate evidence, require a correct answer for completion, and reset with enrollment restart | PR #87 |
| Lower-friction mobile drafting | One temporary-audio controller supports messages, threads, student/staff help, and grading feedback with review before the normal explicit action | PR #88 |

Every PR passed Rails, strict TypeScript, lint, security, web/mobile tests and builds as applicable. Greptile reviewed each PR; all actionable threads were fixed and resolved before merge, and the final review for each merged cleanly.

## Exit-gate trace

1. **Objective:** admin selects a curriculum objective and writes student-facing success criteria.
2. **Task:** the objective is shown at the lesson start and may be connected to a submission rubric or checkpoint retrieval check.
3. **Evidence:** a correct check attempt completes its checkpoint, or the instructor records criterion ratings against the preserved rubric snapshot.
4. **Feedback:** the student receives immediate check explanation or criterion-level grading plus personalized overall feedback.

The product path is complete end to end. Operational acceptance should author at least one real foundational module using this chain and review it with an instructor and a student before broad curriculum rollout.

## Release candidate and verification

The next production EAS archive will be iOS `1.0.0 (10)` because `eas.json` uses remote versioning with production auto-increment. It includes Phase 0–2 changes merged through PR #88. The build must be created and submitted from updated `main`; its EAS build/submission identifiers belong in `docs/app-store/README.md` after the services return them.

Current automated evidence:

- Rails: 369 tests / 1,227 assertions; RuboCop 269 files; Brakeman zero warnings; bundler-audit clean.
- Web: strict TypeScript, ESLint, 10 suites / 29 tests, and production build pass.
- Mobile: strict TypeScript, Expo lint, 28 suites / 103 tests, Expo Doctor 20/20, and CI iOS/Android exports pass.

## Remaining operational gates

1. Install build 10 from TestFlight and run the Phase 0–2 physical-device matrix.
2. Author and review at least one real objective → task → rubric/check → feedback chain in the live curriculum.
3. Update the public privacy disclosure and App Store privacy answers, approve provider data controls, and validate Guam-network accuracy/audio-session behavior before enabling `VOICE_TRANSCRIPTION_ENABLED`.
4. Complete the already-planned 28-day analytics baseline and reconcile events against Rails source records.
5. Keep public App Review separate until the internal TestFlight acceptance pass is recorded.

## Next product phase

Phase 3 is recovery and accessible media: durable intervention ownership/follow-up/outcomes, explicit restart plans and pacing, captions/transcript ingest and review, recording chapters/search-to-time, and calendar export. Phase 4 mastery claims remain deferred until instructors agree on objective-evidence rules and the Phase 2 evidence model has real operating data.
