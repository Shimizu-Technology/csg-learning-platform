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

## Independent review fix round

Starting head: `3005b348`, independent Opus findings supplied by Leon. The P1 proves that a self-entered username is not identity: App verification must use OAuth-proven GitHub user IDs and owner-only personal installations. This round adds a separate Connect GitHub user-authorization flow with one-use, user/enrollment-bound authenticated encrypted state and PKCE. Numeric identity, login and verification time are persisted; OAuth access/refresh tokens are not. Existing unverified Off-cohort behavior remains legacy/trusted-username behavior. Forks and organization-owned repositories will be refused rather than sent to a new approval workflow.

Agent-executed acceptance for this round: Connect GitHub → verified binding → persisted identity; self-entered/classmate and post-rename impersonation refusal; personal installation isolation; organization/fork refusal; read-only verified username with reconnect recovery; valid/tampered/expired/replayed/cross-user OAuth state; flat school-setting reads outside HTTP requests; concurrent binding save returning success/409; malformed provider bodies returning sanitized errors. API modes, web/security gates and fake-provider browser rechecks are not yet complete for this round. Previous head's full ASUS gate did pass and posted its result, but that is not final-head evidence for these fixes.

### Fix-round results

Tested the review fixes on parent `3005b348` plus this commit's changes, against an owned local PostgreSQL database. The final focused set passed **140 tests / 1,019 assertions in each mode** (`prepared_statements=true` and `false`), with no failures, errors or skips. Coverage includes real two-connection duplicate inserts for both partial binding indexes (200 + 409, one row), migration down/up/idempotency with all pooled caches cleared, verified-ID uniqueness without legacy backfill, malformed provider/state bodies, OAuth expiry/replay/cross-user/PKCE, rename impersonation, personal-installation isolation, forks and organization refusal. Off batch sync reads school settings once with either one or six learners outside a request; check refresh also resolves switches once. An unenrolled legacy check submission stays on the legacy path even with the school App switch On.

The final web gate passed: ESLint, both TypeScript projects, **247 Vitest files / 3,479 tests**, Netlify routing/service-worker checks, production build and initial bundle budget. Both generated API files were regenerated and `api:check` passed. RuboCop inspected 828 files without offenses; Brakeman found zero errors/warnings. The advisory Impeccable scan returned no findings. The first web run caught the glossary's reserved “owned” wording in new UI copy; the corrected copy passed the complete gate.

The fake-provider browser matrix passed **24/24 at 390 and 1280, light and dark**. G02 now performs Connect GitHub → synthetic GitHub authorization → explicit confirmation → saved verified identity → Pending → Verified binding. G03 additionally refuses classmate-ID impersonation and forks with saved failure reasons, then recovers. G05 confirms the username is disabled and a forged profile PATCH returns 422. Setup/callback, module scope, instructor/other-learner 404s and an Off cohort still pass. External browser/provider HTTP is blocked. The shared T3 browser separately reconnected, observed binding invalidation, reverified the default binding, and checked persisted `github_user_id=24680`, a locked username and zero horizontal overflow at 390. Screenshots and traces remain under ignored local QA artifacts.

The ASUS attempt first returned busy (75); a later retry acquired the slot and was still running when this result was recorded. Its source predates the final unenrolled-submission guard; it is supplementary evidence only. The final-head CI full suites and both transaction-pooler legs remain the authoritative full-run gate, per Leon's instruction. Do not infer a final-head full-suite pass from the earlier `3005b348` ASUS success.

Real GitHub consent/token exchange and private personal-repository staging remain untested until the real App exists. Register user callback `https://learn.codeschoolofguam.com/github-app/authorize`, distinct from the installation Setup URL. New required names: `GITHUB_APP_CLIENT_ID` / `github_app.client_id` and `GITHUB_APP_CLIENT_SECRET` / `github_app.client_secret`; optional callback override `GITHUB_APP_USER_CALLBACK_URL` / `github_app.user_callback_url`. No extra permissions or events: Contents read, Checks read and automatic Metadata read; webhooks inactive for this slice. Forks and organization repositories have no staff approval override. Unverified Off cohorts continue trusting the self-entered username, as before.

### Final P3 round after ready security re-check

Leon supplied the independent Opus security re-check of `daf8d9be`: ready, no P1/P2 findings, including both login-CSRF directions, PKCE/state, fixed callback, server-side numeric identity and every named impersonation case. This round merges `origin/main` at `c1cff777` (#313 personal pace). The schema was rebuilt from the common base and actual migrations applied in order: `20261118170000`, `20261119010000`, `20261119030000`. OpenAPI was combined structurally and both type files regenerated. #313's strict Off-cohort golden received only the new default `github_app:false` in 16 feature maps; every existing value remains unchanged. The first combined test run caught that intentional additive key missing from the older golden; no runtime parity comparison was weakened.

P3 decisions: 200 OAuth error bodies produce “That GitHub link expired. Connect again.” before fetching missing token keys. Every acquired user token gets a best-effort DELETE after `/user`, including unsuccessful identity reads; revoke failures never replace the identity result or expose secrets. Exact `/\Acode\z/` filtering preserves `github_code_url`/`source_code` while masking OAuth code and `code_verifier`. Verified username changes are rejected only on the self-profile path; admin/re-add/import paths skip the field with a warning, preserve proof/bindings and apply other valid fields. Case-only changes are no-ops without warnings. Admin warnings are exposed in the additive API contract and shown in staff UI; import warnings also appear in dry runs. This preserves provider-proven identity rather than unlinking it based on manual or stale archive metadata.

Acceptance is agent-executed focused API and component testing for the final backend/message changes: provider expiry/retry after consumed nonce, authenticated revocation with fake transport (including failure), exact log filtering, admin PATCH/re-add plus archive overwrite and case-only writes, existing binding/legacy routes, both migrations and #313's integration/parity cases. No new real-provider or browser-matrix acceptance is claimed in this short round; the prior fake-provider browser matrix applies to `daf8d9be`. Final combined gate results will follow below.

The prior optional ASUS snapshot finished: full prepared API 2,383 tests / 44,615 assertions passed (one CI-only skip); full unprepared API had one curriculum-copy HTTP-pause timing assertion fail (expected 409, received 200). Other cross-stack stages passed. That snapshot predates the final unenrolled guard and this merge and is not current-head full-suite evidence. Both original helper and reporter are no longer running; current-head CI full suites and pooler legs remain authoritative under Leon's instruction.

Final combined verification passed **236 tests / 1,661 assertions in each prepared-statement mode**, no failures/errors/skips. This includes the previously noted copy/pause case and #313's migration, personal-pace integration and strict Off-cohort parity. Web gate passed **252 files / 3,502 Vitest tests**, ESLint, both TypeScript projects, Netlify routing/service-worker tests, production build and bundle budget. `api:check` passed both regenerated type files. RuboCop: 834 files, no offenses; Brakeman: zero errors/warnings. Impeccable's advisory scan of the warning displays returned no findings. Staff component regressions verify warnings stay visible after profile save and cohort re-add. No real GitHub was called. The only new local resource was the disposable test database; it is removed before handback. Current-head CI and review coverage are reported on the PR; the ready Opus security review is specifically for `daf8d9be`.
