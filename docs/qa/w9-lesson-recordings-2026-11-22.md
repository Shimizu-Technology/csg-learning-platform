# AS-7 lesson recordings QA · November 22, 2026

CSG Learn staff can attach a cohort recording to lessons on its curriculum. Learners can open the replay and resume watching from their lesson. The W9 design (§9.6) and the existing recording library define the cohort, pause, and watch-credit rules.

Application code under test was `d41f51a6` on top of `98b3f1c9`. Codex ran the cases against the local Rails and Vite harness on macOS. Three synthetic cohorts shared one curriculum. The primary cohort used the redesigned lesson page, a second cohort had no attachments, and a third used the legacy lesson page with its own attachment.

## Browser acceptance

| Scenario | 390 light | 390 dark | 1280 light | 1280 dark |
| --- | --- | --- | --- | --- |
| Instructor searched by lesson, used the matching-week filter, selected a lesson, and uploaded and published an eight-second video. Rails returned the measured duration and attachment. | Pass | Pass | Pass | Pass |
| Instructor opened the recording detail, saw the duration and lesson, reopened Edit, and saved a second attachment in order. | Pass | Pass | Pass | Pass |
| Learner saw the recorded date, duration, and unwatched state, opened the cohort-specific player, played and paused the clip, and returned to a visible resume action. | Pass | Pass | Pass | Pass |
| Learner in the second cohort saw the same lesson with no recordings section. Its recording library refused the first cohort's recording ID. | Pass | Pass | Pass | Pass |
| The legacy lesson page showed its own cohort's replay and stored duration. | Pass | Pass | Pass | Pass |

The final matrix passed all four runs. An earlier 390px dark run reached the final legacy-page check and hit the 30-second timeout while the package suites ran. The full journey now has a 60-second timeout.

The spec asserts 44-pixel picker rows and watch controls, checks that the watch control receives input, and checks page width. At 390px Chromium used mobile viewport and touch emulation. The fixture simulated S3 with a local clip served with byte ranges. The file upload, browser metadata, Rails persistence, access checks and watch-progress requests ran end to end. Production object storage, physical phones and non-Chromium browsers were outside this pass.

## Rails and client checks

- Rails ran with `PARALLEL_WORKERS=1` on separately created temporary PostgreSQL databases in both prepared-statement modes. Each mode passed 175 tests and 1,386 assertions. Coverage included the reversible migration and pooled cache reset, foreign and archived lesson rejection, atomic replacement and removal, shared-curriculum isolation, the exact pause publication cutoff, fixed query count, write-once duration backfill, remapping only the copied cohort, Cohort 3 parity, and OpenAPI responses.
- RuboCop and Brakeman 8.1.1 completed with zero offenses and zero active security warnings. Brakeman retained the repository's existing ignored warning.
- Web `npm run api:check` checked both generated clients. Web and mobile `npm run check` passed 3,544 and 1,833 tests, respectively. The full web rerun used `VITEST_MAX_WORKERS=2` after an existing focus assertion failed during the concurrent run.

## Reproduce the browser run

Run from the repo root with local dependencies installed and the lifecycle session supplied by the task host.

```sh
mkdir -p .qa-local
ffmpeg -y -f lavfi -i 'testsrc=size=320x180:rate=10' -t 8 -c:v libx264 -pix_fmt yuv420p -movflags +faststart .qa-local/synthetic.mp4
QA_LESSON_RECORDINGS=1 QA_SYNTHETIC_VIDEO=1 scripts/qa/run start
QA_DATABASE=$(python3 -c 'import json; print(json.load(open(".qa-local/state.json"))["database"])')
(cd api && DATABASE_URL="postgresql://localhost/$QA_DATABASE" PARALLEL_WORKERS=1 bundle exec ruby ../scripts/qa/w9-lesson-recordings-fixtures.rb)
QA_SPEC=w9-lesson-recordings.spec.ts node web/node_modules/@playwright/test/cli.js test --config scripts/qa/playwright.config.ts
scripts/qa/run clean
```

The Playwright report is at `.qa-local/results.json`. Picker and learner row screenshots are under `.qa-local/test-results/`. The harness database, Rails and Vite processes, and task browser contexts were cleaned after the run.
