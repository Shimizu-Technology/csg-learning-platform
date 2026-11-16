# Setup wizard round 1

Scope: PR #275, feat/setup-wizard, based on 4b1218d4, integrating main 9bb714b2 (#273/#274). This is Code School of Guam's admin setup/enrollment flow; students use public catalog and checkout. Sources: PRODUCT_VISION.md, ROADMAP.md, DEPLOYMENT.md, the existing setup acceptance record, and the independent round-1 findings. Acceptance: retry-safe enrollment, time-based cohort activity, consistent curriculum/defaults, protected wizard drafts, accurate public copy and useful readiness errors. No production changes or production data.

## Changes and regression coverage

- P1 enrollment: sequential 25-row requests, cumulative progress, merged global row numbers. Enrollment uniqueness (cohort + user/email identity) remains the idempotency key across all chunks and entire-upload retries. Existing pending/failed invitations are dispatched again; queued and recently sent invitations deduplicate for 10 minutes. Inline delivery now returns its actual state. No new jobs or recurring tasks. The server retains its 200-row request cap.
- P1 activity: active scope and predicate include upcoming cohorts once the school-calendar start date arrives. API cohort status projections use effective status so mobile selection/upload filters agree. Stored status remains unchanged on reads. Explicit upcoming on creation is preserved, including a past start date.
- P2 curriculum: enrolled cohorts reject swaps with a specific 422; empty cohorts reset module defaults. Controller saves share the cohort lock with enrollment creation. Wizard locks the curriculum selector for enrolled cohorts.
- P2 wizard: existing UnsavedChangesGuard covers route/query changes and reload; dirty previews explicitly say unsaved and block publication. Validation messages render and a successful readiness check clears old errors. Saved patches update the dirty baseline.
- P2 checklist/public copy: program/guided checklist omits offering; checkout status uses public title or “Self-paced course”.
- P3 bulk: dropped rows say “Previously dropped; not re-added”; accepted learners receive the same notification as single create after the enrollment transaction commits. Labels use the glossary humanizer, and invitation failures include recovery instructions. Account/enrollment saves share a transaction; uniqueness races retry in a fresh transaction and resolve existing enrollments honestly. A per-admin 1,000-row/10-minute budget supplements existing request limits.
- P3 visibility: Settings requests the same server readiness as the wizard, including catalog and school checks, and shows missing items. Only switching checkout on enforces publish readiness; an unchanged enabled flag does not reject unrelated edits. Published legacy offerings without copy remain purchasable.
- Migration: unique 20261116190000, transaction-local lock timeout, reversible migration, schema dumped from the disposable local database. OpenAPI status enum updated, honest required fields retained, twins regenerated. Validity, path declaration and coverage gates apply.

Tests cover effective scope/predicate and explicit status; curriculum reset/rejection; invitation recovery/dropped rows; notifications and weighted rate limits; transactional rollback and uniqueness retry; checkout title/fallback; unrelated settings; delivered invitation deduplication; client 60-row chunks and row numbering; Settings catalog/school checks. Existing fixtures now use a genuinely future start date when expecting inactivity, and a milestone within the current school week when expecting weekly-plan inclusion.

## Cohort activity audit

| Use | Decision |
|---|---|
| dashboard_controller active cohort scope and missing-module counts | Shared effective scope/predicate |
| attention_projection scope and reason filtering | Shared effective scope/predicate |
| notifications.rake lesson unlock reminders | Shared effective scope; task is still operator-run, no scheduler added |
| clerk_authenticatable bootcamp selection | Shared effective scope |
| github_issue_service cohort selection | Association uses shared effective scope |
| record_summary next session | Shared predicate |
| cohort_home_projection missing-module count | Shared predicate |
| cohort offering_readiness and purchase_ready? | Shared predicate through readiness |
| dashboard catalog_enabled | Replaced raw status predicate with effective scope |
| course_offerings_controller catalog listing | Replaced raw status predicate with effective scope |
| curricula_controller live checkout offerings | Replaced raw status predicate with effective scope |
| record_search resource cohorts, resources_controller, student_recordings_controller | Active/upcoming union already includes arrived upcoming; preserved |
| curriculum availability/archive protection; cohort curriculum lock | Active/upcoming union already includes arrived upcoming; preserved |
| API cohort status projections (sessions, cohorts, dashboard, progress, users, records, lesson editor) | effective_status for consistent client behavior; no stored-status writes |
| mobile cohort-provider, recording upload/link active filters | Receive effective status from API |
| enrollment/curriculum/workspace/slot/intervention active uses | Different entities; preserved |

## Browser acceptance

Agent-executed shared-preview browser against scripts/qa harness, synthetic fixtures only. Chromium CSS viewports 1280×844 and 390×844, light and dark. QA cohort 2 self-paced; cohort 1 set to guided in disposable DB (visible label “Focused course with meetings”).

- Wizard: all six steps open at both widths/themes, locked curriculum on enrolled cohort, readiness prevents publishing incomplete offering, no horizontal overflow. Invalid HTTP image URL produced validation error; correcting to HTTPS cleared it. Navigating to Students showed leave dialog; discard proceeded. Saving catalog copy showed saved readiness and cleared dirty state.
- Bulk: 60 synthetic rows at each width/theme, 25/25/10 requests, 60 visible results, no horizontal overflow. Invitations queued in harness; external providers blocked.
- Retry: at desktop/light, fetch interception returned a simulated 400 on the second chunk after first committed. UI explained safe whole-upload retry. Retry returned 60 rows: first 25 already enrolled, remaining 35 enrolled. No lost enrollments or duplicated enrollment rows.
- Guided checklist: both widths/themes show curriculum/instructor/students and omit offering.

Observed desktop/light request timings: initial 25 rows 367 ms; simulated second-chunk failure; retry chunks 25/25/10 rows took 100/302/109 ms. These are local harness timings, including real database work but no Clerk/email network delivery. Production provider latency and Neon latency were not measured. Enrollment idempotency and dispatch dedupe are additionally covered by API tests.

Not run: production Clerk/email/Stripe delivery, production latency, Safari/WebKit (unsupported on this host), native device interactions. Resizing is mobile web coverage only. No production deployment requested. PR remains open for independent review.

## Final automated gate

- API: OPENAPI_COVERAGE=1, PARALLEL_WORKERS=1, PGGSSENCMODE=disable, own local DB: 1,710 tests / 39,200 assertions, zero failures/errors/skips. Includes OpenAPI 3.1 validity, declared path params, required-key checks, populated response/schema coverage and reversible production migration process tests.
- RuboCop: 651 files, no offenses. Brakeman: no warnings (one existing ignored warning).
- Web Node 22: typecheck, ESLint, 189 Vitest files / 2,251 tests, build, test:bundle, api:check passed. Both generated API twins current.
- Mobile Node 22: typecheck and Jest, 135 suites / 1,380 tests passed. Typecheck repeated after final generated twins.
- Impeccable advisory detect on three changed admin components: empty finding list.
- Task-owned preview tab closed; exact QA harness server processes stopped; harness DB and csg_fix275_round1 dropped. Lifecycle reports no unresolved resources. Shared Postgres service preserved.
