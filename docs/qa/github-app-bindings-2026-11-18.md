# GitHub App connections and repository bindings — X-6 slice 2

## Context and gate

Date: November 18, 2026. Base: `c8b34f51` (`origin/main`). Functional source: `cc4c4080`. Sources: `docs/PRODUCT_VISION.md`, the approved Brain Dump `code-school/csg-learn-x6-prework-grader-parity-2026-11-18.md` sections 2–3, and the existing GitHub sync/check services, `FeatureSwitches`, `SchoolSetting`, `StaffCohortScope` and `ScheduledTick`.

CSG Learn serves learners, instructors and admins through Rails, web and Expo. Clerk remains sign-in. This slice adds cohort installations and enrollment-default/module repository bindings for manual source sync and check refresh. Both the school switch and explicit cohort opt-in must be On; the new switch defaults Off. Inherit remains Off even when the school switch is On. Existing URL submissions stay unbound until verification. Legacy sync requests, passing-grade retention, notifications, issues, invitations and scheduling are preserved. No webhook, grading automation or GitHub cron task is added.

Leon revised the execution gate after repeated ASUS lock contention: run focused tests locally in both prepared-statement modes, push and open the PR, and use CI's full suite and both pooler legs as the required full run. ASUS retries are optional background work and must not hold the PR. CI results remain pending until the PR's actual checks finish. Do not merge or watch this PR.

## Agent-executed acceptance

Fixtures are invented, local-only, and served by `scripts/qa/run` with `QA_GITHUB_APP=1` and `github-app-bindings-fixtures.rb`. The fake provider is installed at the App client boundary; external HTTP remains blocked. No real GitHub, production cohort, email or notification delivery was exercised.

Use existing cohort Settings, student Access and Profile surfaces. Preserve entries on failure, show explicit pending/verified/failed states with recovery, and retain 44px controls. No new motion.

| Case | Visible and saved outcome | 1280 | 390 |
| --- | --- | --- | --- |
| G01 | Admin confirms manual installation and signed callback; metadata survives reload; expired/pending-approval callbacks explain recovery; no secrets returned | passed, light/dark | passed, light/dark |
| G02 | Enrollment default saves Pending, verifies, reloads with numeric repo ID, username and timestamp | passed, light/dark | passed, light/dark |
| G03 | Wrong owner/unselected repo shows Failed with reason; edit/retry verifies and preserves entries | passed, light/dark | passed, light/dark |
| G04 | Module override persists independently of the enrollment default | passed, light/dark | passed, light/dark |
| G05 | Learner verifies own binding in Profile; instructor/other learner receive uniform 404s for setup/cross-scope requests | passed, light/dark | passed, light/dark |
| G06 | Off cohort and its learner show no connection/binding UI; API refuses App access | passed, light/dark | passed, light/dark |

`github-app-bindings.spec.ts`: **24/24 passed** on `cf582fb2`, bundled Chromium, owned database `csg_qa_23761_1794974286`. API reads verify persisted outcomes, not just banners. Axe checks on the changed regions passed. Screenshots and the JSONL ledger are retained locally under `.qa-local/github-app-bindings/`. The shared T3 browser separately exercised setup at both widths and Pending → Verified; at 390, controls measured 44–46px and the page had no horizontal overflow. Phone-size Chromium does not certify native keyboards, Safari or installed Expo behavior.

The later feature-inheritance label change has a component regression proving that school On + cohort Inherit displays Off and only an explicit On is saved. The later provider query change has a transport regression for BigInt identity (`4,000,000,000`), mismatch refusal and disabled rename following. No accepted browser control or route was removed by those changes.

## Automated verification

| Check | Result |
| --- | --- |
| Focused API, `prepared_statements=true` | **129 tests / 902 assertions; 0 failures/errors/skips** |
| Same focused API set, `prepared_statements=false` | **129 tests / 902 assertions; 0 failures/errors/skips** |
| Local full API with OpenAPI inventory, prepared Off | **2,366 tests / 44,452 assertions; 0 failures/errors; 1 pooler-CI-only canary skip**; run before the extra BigInt transport case, which passed in the focused set |
| Full web Vitest | **247 files / 3,478 tests passed** before adding the inheritance regression |
| Focused web after that addition | **74 tests passed**, including all 5 FeatureSettings tests, naming and route titles |
| RuboCop, Brakeman | **Passed**: 817 Ruby files, zero offenses; zero Brakeman security warnings (one pre-existing ignored warning) |
| Web lint, typecheck, build, bundle, generated API types | **Passed** on final source; both type files regenerated with `npm run api:generate` |
| Impeccable advisory | Empty findings array for the three new UI components |
| Required CI full API/web/mobile and both pooler legs | **Pending PR checks; not claimed passed locally** |
| Optional ASUS full gate | Background retries; current result in `.qa-local/asus-background-status.json`; an acquired run will post its result to the PR |

Focused API files cover App setup/bindings/client/routing, migration rollback/reapply, feature switches, existing cohort sync/check flows, curriculum copies/concurrency, and OpenAPI schema rules. They verify actor/cohort/App/expiry state, selected repositories, token cache/expiry retry, revoked access, identity changes/transfers, active enrollment, strict scope IDs, concurrent rebind preservation, flat binding-list queries, and the unchanged legacy HTTP request. The copy remaps only its cohort's module bindings and retains numeric provenance; defaults and another cohort's rows stay unchanged.

Migration `20261118170000` creates additive tables only. SET LOCAL and DDL share an explicit transaction; its test clears every pool's connection caches and resets model column metadata. The ASUS helper retains the migration subprocess loopback port adapter. Local subprocess tests use an explicit local PostgreSQL username and all three production-connection cases passed.

## Findings fixed and limits

Initial failures are retained in local logs/traces. G02/G04 first timed out because the select test used exact label text including options; accessible combobox locators fixed that. The first full API pass found the missing curriculum-copy policy/count, plus a test intercepted by the concurrency suite's global fake and two incorrectly configured local subprocess URLs. The remap/preview, original-method binding and corrected URL fixed those failures; affected reruns and the later full unprepared pass are green. Web guards caught the missing callback title and retired glossary wording; the complete web rerun passed after correction.

Real App creation and disposable personal/private-repository, installation consent, token-expiry and revocation staging acceptance remain required before rollout. Native Expo, Safari, real Clerk and live provider delivery are not claimed. Webhook receipt, reconciliation, revisions, suggestions and issue reliability belong to later slices. Setup names, permissions, events and callback URL are in `docs/DEPLOYMENT.md`.

All local QA servers, browser pages and disposable databases are cleaned. Shared PostgreSQL/Redis, the baseline simulator and other sessions' resources remain untouched. The only intentional running resource is Leon's requested, bounded ASUS retry supervisor: at most eight attempts, three minutes apart, stopping after one acquired run and recording its result in the PR. Its exact PID, lifecycle handoff and next action are in the local handoff; the branch/worktree stay available for the lead.
