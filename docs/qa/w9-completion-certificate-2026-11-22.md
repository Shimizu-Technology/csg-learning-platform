# Course completion and certificates QA

Verified the application at `b9a71d12` on November 22, 2026, after integrating `origin/main` at `38331470`. The agent ran Chromium against the local Rails and Vite harness with an owned PostgreSQL database, synthetic learners, an assigned instructor, an admin, and a fresh signed-out visitor context. Each browser case has a fresh fixture. [Wave 2 browser spec](../../scripts/qa/w9-completion-certificate.spec.ts)

| Learner and staff journey | 390 px light | 390 px dark | 1280 px light | 1280 px dark |
| --- | --- | --- | --- | --- |
| Submit the final project, then open **All work handed in**. Certificate and next step stay hidden during review. | Pass | Pass | Pass | Pass |
| Grade A as the assigned instructor. Open **Course completed**, check the configured offering link, and verify the same certificate appears on Today and Profile. | Pass | Pass | Pass | Pass |
| Save an edited printed name. Verify the same name and code in a signed-out browser with the exact public API allowlist. Copy the verification URL. | Pass | Pass | Pass | Pass |
| Revoke with a reason. Confirm the signed-out page shows Revoked and hides print. Reissue and verify the new link with the preserved printed name. | Pass | Pass | Pass | Pass |
| Submit and grade in the inherited-Off program cohort. The original **Course complete** screen stays in place with no certificate or next step. | Pass | Pass | Pass | Pass |

The verified page passed a scoped axe WCAG 2.0/2.1 A/AA scan in all four runs. Screenshots at the main checkpoints had no horizontal overflow. All four generated PDFs contained a single A4 landscape sheet with the holder name, code and verification status. PDF text contained no controls. The final mobile-dark PDF was visually checked for centering and legibility. Browser output is in the ignored `.qa-local/test-results/` directory.

The staff authoring case passed at 390 px and 1280 px in light mode. The cohort inherited Off while the school switch was On. The admin switched the cohort On, saved an external next-step URL, and confirmed both persisted on reload. The lesson inspector saved the changed final-project marker and preserved the block's existing metadata.

## Automated checks

- PgBouncer 1.26.1 in transaction mode, `PARALLEL_WORKERS=1`, with a separate disposable database per mode. Prepared mode passed 202 tests and 12,709 assertions. Unprepared mode passed 202 tests and 12,707 assertions. Coverage included migration up/down and cache invalidation, enrollment and staff authorization, the public allowlist and rate limit, manual progress, late hand-in after a passing final project, revocation and reissue, OpenAPI, the small-class integration, and the unchanged Cohort 3 golden. The prepared migration switched to a direct connection for DDL and cleared PgBouncer server plans before restoring the runtime connection. The unprepared migration stayed on the pooler.
- RuboCop checked 873 files with zero offenses. Brakeman 8.1.1 reported zero security warnings and one existing ignored warning.
- Both generated type files passed `npm run api:check`. The web gate passed lint, typecheck, all 3,546 Vitest tests, Netlify tests, the production build and the landing bundle check. The mobile gate passed all 142 Jest suites and 1,833 tests.
- The full ASUS Rails run before the small-class rebase executed 2,555 tests. Eight assertions in the capabilities and activity history suites expected the new Off key in legacy payloads. After updating those expectations, all 33 tests in the two files passed in each statement mode. One test was skipped in the direct full run. The pooler canary passed in both pooled runs.

`scripts/qa/run clean` stopped the owned harness and dropped its database. The separate PgBouncer process and test databases were also cleaned up.

Chromium used responsive viewports on macOS. This run covered web journeys and generated mobile types. Native device behavior, Safari, hosted Clerk, and production deployment were outside the test environment.
