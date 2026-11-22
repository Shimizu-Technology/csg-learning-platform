# Optional per-course peer space for self-paced learners — W9.8 / AS-9

## Context and invariants

Date: November 22, 2026. Base: `68092b67` (`origin/main`). Branch: `feat/w9-self-paced-peer-space`. Source spec: `csg-learn-w9-self-paced-design-2026-11-18.md` (Section 2 & Slice 9.8 / AS-9).

This slice adds an optional, default-Off per-course peer space for self-paced cohorts using the existing `FeatureSwitches` JSONB storage and existing cohort workspaces/channels (no database migration required):

- **`self_paced_peer_space` defaults `false`** in `FeatureSwitches::DEFAULTS` and requires **both** school activation and an explicit cohort `On` opt-in (`FeatureSwitches::COHORT_OPT_IN`, matching `github_app`). Inherit stays Off even when the school default is On.
- **Zero impact on existing cohorts:** All existing cohorts (including Cohort 3 and every existing self-paced cohort) stay Off and byte-identical; `api/test/golden/personal_pace_off_cohorts.json` adds only `"self_paced_peer_space": false` inside the 16 feature maps.
- **Privacy boundary:** Enabling `self_paced_peer_space` (while `class_channels` is also On) opens only `visibility: :cohort` channels in that self-paced cohort for learners with an active, unexpired, non-paused enrollment. `staff_only` channels stay strictly staff-only, classmate-to-classmate DMs remain blocked (learners can still DM their assigned support instructor), and `UserBlock` hides blocked messages and suppresses notifications.
- **Clean posting boundary:** Posting follows `Channel#can_post?` (active enrollment with active support window). `ChannelSummary` exposes additive optional `can_post` and `post_disabled_reason` fields so learners whose support period has ended (or has not yet started) see a clear read-only status notice instead of a failing composer.

## Agent-executed browser QA

Fixtures are synthetic and local-only via `scripts/qa/run start` + `scripts/qa/w9-peer-space-fixtures.rb` + `scripts/qa/w9-peer-space.spec.ts` against bundled Chromium (`chromium-1280` and `chromium-390`, light and dark). External HTTP is blocked.

| Case | Verified outcome | 1280 | 390 |
| --- | --- | --- | --- |
| PS01 (Off baseline) | Default-Off self-paced learner sees zero channels (`GET /api/v1/channels` returns `[]`), no `Class Chat` in Messages, and retains instructor DM empty state | passed, light/dark | passed, light/dark |
| PS01 (Admin opt-in) | Admin sees `"Course community (self-paced)"` with recommendation copy on `/profile`, enables school switch (cohort stays Off via `Inherit → Off`), then opts cohort In on `/admin/cohorts/:id?tab=settings` | passed, light/dark | passed, light/dark |
| PS01 (Peer space On & privacy) | Self-paced learner sees `#Class Chat` in Messages, reads existing message, posts a new message, and verifies persistence across reload; `available_users` contains only the support instructor (`[2]`), keeping classmate DMs blocked | passed, light/dark | passed, light/dark |

- `scripts/qa/w9-peer-space.spec.ts`: **4/4 passed** (34.5s) on owned QA database `csg_qa_48666_1795311399`.
- **Layout & accessibility:** `0` horizontal overflow across all 12 captures (390px and 1280px, light and dark), `0` serious/critical Axe WCAG 2.1 AA violations on inspected regions, `0` console errors.
- **Cleanup:** Owned QA servers and disposable database were stopped and dropped via `scripts/qa/run clean`; local screenshots and `ledger.jsonl` remain in git-ignored `.qa-local/w9-peer-space/`.

## Automated verification

| Check | Result |
| --- | --- |
| Targeted + messaging/channel/workspace/parity/OpenAPI API tests (`prepared_statements=true`, `PARALLEL_WORKERS=1`) | **226 runs, 1,817 assertions, 0 failures, 0 errors, 0 skips** |
| Same API suite (`prepared_statements=false`, `PARALLEL_WORKERS=1`) | **226 runs, 1,817 assertions, 0 failures, 0 errors, 0 skips** |
| RuboCop (`bundle exec rubocop`) | **853 files inspected, 0 offenses** |
| Brakeman 8.1.1 (`bundle exec brakeman -q --no-pager`) | **0 errors, 0 security warnings** (1 pre-existing ignored warning) |
| Web OpenAPI & type generation (`cd web && npm run api:check`) | **Passed** (`web/src/types/api.generated.ts` and `mobile/src/lib/api.generated.ts` in sync) |
| Web full check (`cd web && npm run check`) | **Passed**: ESLint, TypeScript, **256 Vitest files / 3,539 tests**, Netlify checks, Vite build, bundle budget |
| Mobile full check (`cd mobile && npm run check`) | **Passed**: brand check, URI decoder/OTA tests, TypeScript, ESLint, **142 Jest suites / 1,830 tests** |
| QA ownership harness (`node --test scripts/qa/ownership.test.mjs`) | **5/5 passed** |

## Limits

- Local Playwright QA runs against synthetic fixtures and bundled Chromium; native iOS/Android Expo clients, Safari, and live Clerk/ActionCable/push delivery are not claimed beyond automated unit/integration coverage.
- Full CI workflows (including pooler legs) will run on the opened PR.
