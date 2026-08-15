# Connected Experience Phase 5 — Completion Record

- **Completed:** 2026-08-15
- **Scope:** explainable learning evidence, GitHub check relationships, source-linked cohort patterns, and focused native review parity
- **Pull request:** #101
- **Merge commit:** `388ef91f3ac9b245cbf40676cf3664b2eaffdca0`
- **Release state:** merged after clean CI and Greptile review; iOS build 13 is `VALID` and `IN_BETA_TESTING` in App Store Connect

## Delivered experience

Staff can open a cohort's **Evidence** tab, review objective-by-objective status counts, expand any objective, and move directly to the relevant learner or exact submission. A learner's **Learning** tab uses the same evidence rule and accepts a deep-linked objective so the cohort-to-student transition keeps its context.

Submission records now show persisted GitHub checks for the exact saved commit. Web staff can refresh those records and open an individual check on GitHub; native quick review shows the same persisted pass/fail/pending evidence and links outward for detail. The platform stores metadata only—not output, annotations, code, or logs.

Curriculum patterns summarize open redo work, repeated attempts, and failed automated checks. Each pattern is a related-record list rather than an opaque score: staff can open the source submission and retain cohort/student return context.

## Evidence rule

The `staff-evidence-v1` projection uses three sources:

1. instructor rubric criterion results;
2. graded submissions explicitly aligned to an objective;
3. the latest attempt for an objective-linked formative knowledge check.

`demonstrated` requires instructor-confirmed evidence. Retrieval-only evidence remains `developing`. Current redo work is `needs_revision`; missing evidence is `not_evidenced`. Completion, watch time, and messaging activity do not imply mastery. The projection is read-only and never modifies grades, progress, access, or scheduling.

## Privacy and authorization boundaries

- Cohort evidence is staff-only; a student filter must match an enrollment in that cohort.
- A submission owner may read their persisted check metadata, while only staff may refresh it.
- Student submission text/code, overall and criterion feedback, GitHub output/logs, message bodies, and signed asset URLs are excluded from the projection.
- GitHub credentials remain server-side and are never included in errors or logs.
- Existing old-commit check records are retained, but only the exact current commit appears in a submission's check summary.

## Product decision: no relationship graph

Interactive validation did not reveal a path that became clearer as a node graph. Cohort sizes are small enough that expandable objective lists, visible counts, breadcrumbs, stable record URLs, and reciprocal links are faster to scan and easier to use on mobile. A graph remains deferred until observed navigation behavior demonstrates a real need.

## Verification record

The delivery gate covers:

- Rails integration/service/model tests, RuboCop, Brakeman, and dependency audit;
- web TypeScript, ESLint, Vitest, production build, and connected-route walkthroughs;
- native TypeScript, Expo lint, Jest accessibility guards, Expo Doctor, and Hermes exports;
- interactive web and native walkthroughs from cohort signal to learner/source record and back;
- GitHub CI plus a clean Greptile review before merge.

Local verification completed with 407 Rails tests / 1,402 assertions, 305 RuboCop files, 35 web tests, and 29 native suites / 111 tests. The final Greptile pass reviewed 30 files with zero new comments, every required CI check passed, and PR #101 merged as `388ef91`.

The connected-experience TestFlight candidate is `1.0.0 (13)`: EAS build `03fd9ec4-22a6-4933-80e8-ed0e440d8f2a`, submission `dd49f5ae-1851-4ed2-ac27-7933e1dfff82`, sourced from that exact merge commit. EAS finished both the archive and upload successfully, and App Store Connect reports the build `VALID` and `IN_BETA_TESTING`. Physical-device acceptance remains an operational gate rather than a code-completion claim.
