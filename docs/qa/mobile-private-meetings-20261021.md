# Mobile private meetings — implementation and acceptance

2026-10-21. Worker: mobile-pr2. Base: PR #187, ed74dccc. Executor: agent.

## Context and scope

CSG Learn serves invited adult beginners in the December 2026 Python Fundamentals guided pilot (at most five learners). The course includes one private Zoom hour in each of three weeks. Self-paced learners do not receive this benefit. Sources: Brain Dump `code-school/python-fundamentals-guided-addendum-2026.md`; `docs/MOBILE_APP.md`; mobile README; web PrivateMeetings screen and helper; Rails PrivateMeetingsController, PrivateMeetingScheduler and PrivateMeetingSerializer; merged PRs #179 and #185.

Rails owns enrollment, slot availability, one-change limits, cutoff and booking conflicts. Native must use the existing API and shared `course-time.ts` ChST formatters. Current/upcoming weeks precede collapsed history; past bookings read Completed. Join opens 15 minutes before the meeting and disappears at its end. Learner cancellation releases the slot; rebooking after learner cancellation consumes a change. Staff management stays on web.

Placement: Today is the one-tap weekly task entry. You/Profile provides a stable second entry without expanding the existing five-tab bar. Both open native `/meetings`; booking notifications also route there.

New screen uses a small local CSG family token object: ruby action, danger red, success/warning/pending/info tones, 16+ pt body/buttons, 48pt minimum buttons, unrestricted text scaling, scrollable confirmation sheets, 120ms press scale with reduced-motion handling. Expo Network provides offline detection; the query uses the existing seven-day user-scoped SQLite cache and sign-out cleanup. No writes queue or retry automatically. This native dependency requires a new dev/store binary.

## Acceptance ledger

Required simulator: iPhone 16 Pro, 3D83D0F5-22C0-41BD-AEB4-1136EEA2C4ED. Baseline: booted and handed off to mobile-pr1; do not interfere while its owner is active. API port 3511, Metro 8111, dedicated DB `csg_mobile_pr2_20261021`. No outbound credentials. Screenshots: `output/implementation-2026-10/mobile-pr2/{before,after}`.

| ID | Fixture/actions → expected saved or visible outcome | Status |
|---|---|---|
| M01 | Invited learner; Today and You → native meetings, ChST openings | not_run |
| M02 | Free slot → sheet → book → reload preserves one confirmed booking | not_run |
| M03 | Booked week → new time → limit warning → confirm → one change saved; second move unavailable | not_run |
| M04 | Cancel → Keep meeting preserves booking; cancel → confirm releases time; exhausted week cannot self-rebook | not_run |
| M05 | Closed week displays exact help copy; no openings displays distinct empty state | not_run |
| M06 | Concurrent learner takes selected slot → clear conflict and refreshed openings, no double booking | not_run |
| M07 | Load then disconnect → saved read, disabled writes with explanation; reconnect/retry recovers | not_run |
| M08 | Current/upcoming first; expand past → Completed, no Join; future/near Zoom gating | not_run |
| M09 | Message instructor → correct in-app instructor DM for the course | not_run |
| M10 | XL Dynamic Type, reduced motion, long title/name and empty/one/full opening; actions readable/reachable | not_run |
| M11 | VoiceOver labels/roles/disabled states static review | not_run |
| M12 | Loading/error/retry and submission-in-progress; rapid taps create only one booking | not_run |

Each simulator case requires actual UI execution and saved-record verification for mutations. Unit/component tests are separate evidence, not simulator acceptance. Physical iOS, Android, real VoiceOver speech and TestFlight are deferred release dimensions.

## Automated checks and review

Pending: npm ci, dependency audit, Expo dependency check, TypeScript/ESLint/Jest, iOS export, advisory Impeccable, CodeRabbit final-head review. Never merge before #187 is merged and this branch is rebased onto main; required simulator acceptance remains a gate.
