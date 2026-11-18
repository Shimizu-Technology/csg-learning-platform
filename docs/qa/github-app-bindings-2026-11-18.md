# GitHub App connections and repository bindings — X-6 slice 2

## Context and acceptance

Implementation base: `c8b34f51` (`origin/main`), November 18, 2026. Sources: `docs/PRODUCT_VISION.md`, the approved Brain Dump `code-school/csg-learn-x6-prework-grader-parity-2026-11-18.md` sections 2–3, and the existing `GithubSyncService`, `GithubCheckRunSyncService`, `FeatureSwitches`, `SchoolSetting`, `StaffCohortScope`, and `ScheduledTick`.

CSG Learn serves learners, instructors and admins through Rails, web and Expo. Clerk remains sign-in. This slice adds cohort-scoped App installations and enrollment defaults/module repository overrides for manual source sync and check refresh. The school switch and explicit cohort opt-in must both be On; the new switch defaults Off. Existing URL submissions stay unbound. Existing cohorts retain legacy token behavior, passing-grade retention, notifications and scheduling. Organization invitations and issue delivery remain separate. No webhook, reconciliation task or grading automation is added.

Agent executes affected-flow acceptance with synthetic local fixtures and a fake GitHub provider. No production cohort data or real GitHub calls are needed. Native Expo, Safari, real Clerk and real provider delivery are excluded. The PR is held for the lead; no merge or watch.

Experience: reuse existing cohort Settings, student Access and Profile surfaces, semantic colors and app controls. Show explicit pending, verified and failed states with recovery. Keep forms quiet, preserve entered values on failure, and use 44px controls at 390 and 1280. No new animation.

| Case | Required steps and outcome | 1280 | 390 |
| --- | --- | --- | --- |
| G01 | Admin prepares connection, saves verified installation metadata, reloads; no secrets in response/UI | passed (light/dark) | passed (light/dark) |
| G02 | Save learner enrollment default, see Pending, verify, reload; numeric identity and timestamp persist | passed (light/dark) | passed (light/dark) |
| G03 | Wrong owner/unselected repository fails with reason, edit/retry succeeds | passed (light/dark) | passed (light/dark) |
| G04 | Module override is independent of enrollment default and persists | passed (light/dark) | passed (light/dark) |
| G05 | Learner can manage own binding; instructor/other learner cannot set up or cross scope | passed (light/dark) | passed (light/dark) |
| G06 | Off cohort shows no App UI; legacy manual sync/check branches remain covered | passed (light/dark) | passed (light/dark) |

Backend acceptance also covers callback state/expiry/actor/cohort, selected repositories, token caching and one expired-token retry, revoked access, changed username/transfer, cross-cohort/module refusal, flat list queries, migration up/down, and both prepared-statement modes. All test calls use a fake provider at the client/transport boundary.

## Execution

The matrix `github-app-bindings.spec.ts` passed **24/24** (six cases × two widths × light/dark) using bundled Chromium and the isolated harness database `csg_qa_26463_1794973317`. This accepts G01–G06 for the simulated web contract. It does not certify native phone interaction or live GitHub.

The shared T3 browser also exercised admin connection setup at 1280 and 390, and saved a default Pending → Verified repository. A read through the API confirmed repository `98765`, username `app-learner`, and a persisted verification timestamp. At 390, the changed controls measured 44–46px high and the page had no horizontal overflow. Axe checks on the changed regions passed in the automated matrix. Screenshots and the JSONL ledger are under `.qa-local/github-app-bindings/`.

Initial test-run failure: the native scope select's accessible name was visible, but the test used an exact label-text locator that included option text. G02/G04 timed out at selection. Changing those tests to role `combobox` with the accessible name fixed the locator; the fresh 24-case run passed. No product behavior was bypassed.

Local focused backend: 30 tests / 272 assertions passed before the final active-enrollment guard, then the affected routing/integration set passed (14 tests / 180 assertions). This includes concurrency protection: a pending provider response cannot verify a replacement binding. Migration rollback/reapply uses an explicit transaction for SET LOCAL and DDL, and clears every pooled connection cache afterward.

Local RuboCop: 817 files, zero offenses. Brakeman: zero security warnings (one pre-existing ignored warning). Web typecheck and lint passed. Impeccable's advisory scan returned an empty findings array for the three new UI components.

The first ASUS attempt disconnected during rsync before tests; the second returned its exclusive-lock busy status. Neither is a passing gate. Full ASUS execution, final source/head recording and runtime cleanup remain in progress.
