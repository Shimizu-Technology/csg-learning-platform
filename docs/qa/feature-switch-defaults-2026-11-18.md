# Feature switch defaults — 2026-11-18

Base: `origin/main` at `6c169d6dd0fb946f004544cbf22da8511071545e`.
Branch: `feat/switch-defaults-off`. Implementation worker; PR must remain open and unwatched.

CSG Learn serves Code School of Guam learners and staff across Rails, React and Expo. Feature settings resolve code defaults, school overrides, then cohort overrides; nil cohort values inherit. Existing learners must keep the same experience, particularly Cohort 3's explicit Off override for `student_experience_v2`.

Sources checked: `docs/PRODUCT_VISION.md`; `FeatureSwitches`, `SchoolSetting`, their callers and request cache; admin FeatureSettings and glossary; native `student-experience.ts`; OpenAPI `FeatureSettingsData`; rollout migration `20261118020000`; Brain Dump `code-school/csg-learn-platform-audit-2026-11-14.md` entries for #293–#295. Those dated production verifications report Cohort 3 Off and Python pilot On. This task makes no live production-data query or change. The shipped default is On; explicit stored overrides remain authoritative.

## Change and acceptance

The explicit boolean map is the only key registry. All eleven shipped defaults remain true. A separate, fixed legacy snapshot guards their behavior, and tests reject a missing/nonboolean default or any additional key defaulting On. A temporary test-only Off switch exercises school fallback, cohort overrides, inheritance, validation and admin payloads. No production key, migration or API payload field is added.

The four read-only school fallback callers use `FeatureSwitches.school(read_only: true)` instead of duplicating merges. It performs the same single SELECT and never creates a row. Tests also prove that resolving ten cohorts from a prefetched school map performs zero additional queries. ScheduledAnnouncementPublisher contains no separate defaults merge. Remaining `index_with(true)` calls index push receipt/recipient IDs, not switches.

Agent-executed affected-flow cases:

| Case | Required outcome | Status |
| --- | --- | --- |
| All shipped keys, no cohort settings / no school row | Identical to shipped snapshot; read-only path does not insert | Passed in both API modes |
| Every shipped key explicitly On, Off and nil | Same school/cohort precedence; running cohort redesign remains Off | Passed in both API modes |
| Future test-only Off key | Off absent settings; explicit On works; inherit returns Off; invalid value rejected | Passed in both API modes |
| Query count | One read-only school SELECT, zero additional queries for ten cohort resolutions | Passed in both API modes |
| Admin inherited Off at 1440px and 390px | Display “Inherit → Off”; On override → inherit → save → reload; 44px target; no horizontal overflow | Passed in Chromium |

Browser coverage mounts the real FeatureSettings and ReviewResponseSettings components with an isolated synthetic API adapter and localStorage persistence. It proves the select interaction and saved/reloaded adapter result, not a live Rails write. Rails integration tests separately exercise real persistence and response payloads. Native device QA is not run: native code, resolved feature contract and types are unchanged. `npm run api:check` verifies both generated files remain current, so regeneration and conditional native typecheck/Jest are unnecessary.

## Engineering gate

Source under test: implementation commit `b5b2c2bc1f16df265145fd8a90580427267c11e8`; the final evidence commit changes only this record. Full ASUS gate passed with zero failed stages: 2,298 tests / 43,885 assertions in each mode, zero failures/errors, one skip each (the transaction-pooler-only canary, which requires `POOLER_CANARY=1`). RuboCop passed; Brakeman reported zero errors and zero security warnings (one existing ignored warning). Both actual prepared-statement mode assertions passed. Command: `asus-test --postgres csg_learning_platform_test <repo-root> -- bash scripts/qa/scheduled-jobs-gate.sh`. Ran the full API suite in both prepared-statement modes, assertions for the actual mode, OpenAPI coverage, RuboCop and Brakeman. Existing migration-process port adapter remains unchanged; one serial job.

Web typecheck, lint and Vitest passed (247 files / 3,478 tests). Build and API type freshness check passed after removing the temporary browser fixture; an earlier build included that disposable fixture and failed on its mock return type. Impeccable 4.6.0 advisory scan returned `[]`.

## Runtime ownership

Lifecycle session `01a1ec44-ca98-7322-8725-c8394f363c76`. Isolated Vite PID 67512 was claimed and terminated; both owned Chromium processes closed through their launch servers. Temporary browser source/HTML/runner files removed. Lifecycle status reports no active owned resources. The helper refused to claim ASUS wrapper PID 53904 because its command matches the protected `postgres` pattern; the wrapper owns and removes its disposable remote container and terminates WSL on exit. The wrapper exited successfully after its cleanup; PID 53904 is no longer running. Shared local services were left running.
