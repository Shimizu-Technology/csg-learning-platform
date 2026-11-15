# Self-paced setup and bulk enrollment

Agent-executed affected-flow QA on the Mac mini, 2026-11-16. Base: main at
2d21e4eb; implementation: 4a30f744, c17c888e, 385ca9ce.

## Context and acceptance

CSG Learn serves students, assigned instructors and school administrators.
This change helps administrators prepare a self-paced offering without moving
between Settings and Teaching team, and enroll a roster without repeated
individual requests.

Sources checked: the requested W6 PR 6.2 brief; the approved redesign README and
13-setup-wizard.html; Cohort and CourseCheckout; cohort, offering and enrollment
controllers; the current cohort workspace and local QA harness. Main includes
#268 and #264. #272 and #273 remained open when checked. The Students directory
change adds only the Add student action.

Acceptance: active curriculum selection; inline support assignment; validated
pricing; separate public catalog copy; server readiness including school sales
availability; guarded publication; date-based creation status; labelled active
and draft curricula; capped, admin-only, idempotent enrollment with row results.

## Browser acceptance

Synthetic harness fixtures only. Interactions used the shared Chromium preview,
with native DOM input/change events and buttons. No API calls replaced the UI
journey. For each new cohort: select self-paced delivery and an active
curriculum, save curriculum, assign QA Instructor inline, enter USD 149 and a
synthetic price ID, enter public title/description/image, inspect readiness,
publish, preview five pasted emails, submit, and confirm five roster entries.

| Case | Dimensions | Result and saved outcome |
| --- | --- | --- |
| Setup and five-student enrollment | 1280 light | Passed: all readiness checks, publication, five enrolled; no alerts or horizontal overflow |
| Setup and five-student enrollment | 1280 dark | Passed: all readiness checks, publication, five enrolled; no alerts or horizontal overflow |
| Setup and five-student enrollment | 390 light | Passed: all readiness checks, publication, five enrolled; no alerts or horizontal overflow |
| Setup and five-student enrollment | 390 dark | Passed: all readiness checks, publication, five enrolled; no alerts or horizontal overflow |
| Checkout disabled | 1280 light, ordinary harness | Passed: steps saved, school checkout remained a blocker |
| Reopen saved cohort | Desktop and phone | Passed: six steps complete and five persisted enrollments |
| Payment configuration panel | 1280 light and 390 dark, final UI | Passed: server Stripe/webhook booleans visible; no horizontal overflow |

The ready/publish runs used QA_CHECKOUT_READY=1 in the existing guarded local
harness. This overrides readiness only, without provider keys, sessions or
payments. Invitations were unchecked in browser runs. Actual email delivery,
Clerk signup, Stripe payment, native mobile, WebKit/Safari and real hardware
are not covered. The image uses an example.invalid URL; image transport was
not tested. Browser dimensions are CSS viewport checks.

## Automated gates

API: full Rails tests with OPENAPI_COVERAGE=1, PARALLEL_WORKERS=1 and
PGGSSENCMODE=disable against csg_setup_wizard_test; RuboCop; Brakeman;
zeitwerk:check. New request tests exercise populated readiness, public
catalog copy, future status, batch rows, duplicates, idempotency, cap,
permissions, disabled checkout and publish guards. New endpoint responses are
validated by the OpenAPI test observer.

Web: typecheck, ESLint, full Vitest, build and test:bundle. Parser regressions
cover normalized duplicates, invalid emails, CSV headers/BOM, quoted commas and
unclosed quotes. Catalog tests assert public description/image without the
internal curriculum label. Curriculum option expectations include status labels.
Mobile: typecheck and full Jest because generated transport types changed.
Impeccable advisory scan returned an empty findings list.

The first gate run caught outdated option-label expectations, glossary
formatting, missing OpenAPI parameter declarations and missing local auth test
helpers. These were corrected; subsequent full runs passed. Test totals and
final gate outcomes are also recorded in the PR description.

## Deployment and follow-up

The migration adds three nullable columns, without defaults, backfills, indexes
or destructive operations. Deploy the API migration before relying on the web
catalog fields. Legacy offerings without public copy use the generic title
“Self-paced course”; internal names are never a fallback.

Stripe price selection remains validated text with the price_ format hint.
Follow-up: verify list permission on the existing restricted key before adding
an admin-only cached picker. No new secrets were introduced.

The lifecycle helper could not begin: “Invalid machine profile: schema_version
must be 1”; its expected machine profile was absent. Exact QA processes and
databases were tracked by scripts/qa/run and cleaned with its identity checks.
Only task-owned preview tabs were closed. Shared PostgreSQL and other sessions'
resources were left running. The task test database is dropped after the final
gate run. No merge, PR watch or deployment was performed.
