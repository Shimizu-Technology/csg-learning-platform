# Curriculum repair — November 19, 2026

Context: Leon approved the November 19 curriculum audit and the remaining-lesson PLAN.md. CSG Learn serves prework, live-class lessons, submissions and personal learning plans. Rails 8.1 API on Render, React web on Netlify; production database is Neon. Source at implementation start: `7b576d2a`, curriculum 1, Lance user 7 / enrollment 3 / plan 1. Curriculum 1 is shared with Test Cohort. No other curriculum is edited.

Required acceptance, agent-executed: preserve every existing learner record and completion state; only add the Git assignment and Nov 21 milestone entry. Preserve all plan dates, exceptions and existing revisions. Re-point frozen guides, teach WSL terminal identity, add JS evidence and deploy hand-ins, retire dead prework media without losing history, and give the live CRUD path a temporary JWT. Create a separate unassigned draft for Cohort 4 with no learner data and no Lance plan. Its login and session restoration precede its first protected read; excess video viewing and repeated Rails teaching become optional review/practice.

Private production snapshot and full dry-run/apply logs are outside Git, under `output/csg-curriculum-fixes-20261119/`. The initial snapshot includes 246 lessons, 396 blocks, 316 progress records, 226 submissions and 3 plan revisions. It confirms lessons 2–4 were already archived, 230/231 already had repo+live fields, and affected lesson prose had no Actualize wording. The task still guards these outcomes.

| Case | Required outcome and execution | Status / evidence |
| --- | --- | --- |
| C01 | Read-only dry-run shows exact shared field changes, new lesson, plan addition and full Cohort 4 content, allocating no IDs | Passed: focused migration tests and local exported-content rehearsal |
| C02 | Apply preserves raw progress/submissions/grades, existing assignment rows and dates; 213 remains complete | Passed: transaction assertions, focused tests, synthetic evidence on exported production content |
| C03 | Apply without matching snapshot refuses; failure rolls back all content; second apply changes nothing | Passed: focused migration tests |
| C04 | New required Git lesson before first live-class work; on Nov 21 path with PR hand-in | Passed locally: rendered before 131; required in plan; Markdown PR hand-in submitted and persisted after reload. Production pending |
| C05 | Cohort 4 is draft/unassigned; optional labels match flags; 228→229→221→CRUD; required viewing <=30 min in the six flagged lessons | Passed in focused tests; production pending |
| C06 | Student reads WSL/client/token/deploy content, repo/live fields, submits PR evidence, and saved outcome survives reload | Passed locally at 1280 and 390 CSS pixels: PR submission and 230 repo/live submission saved, reload shows waiting review; 213 keeps completed state and new repo field. WSL and deploy content readable without overflow. Real provider login, actual hardware/WSL and native app excluded |
| C07 | Production snapshot, dry-run, apply and independent post-apply reconciliation; new links resolve | Pending PR merge and API release |

## Before → after structure

- Live shared curriculum: original sequence and flags retained. New written required Git lesson goes at Live Class day 0 position 0, before 131, and first in Lance's Nov 21 milestone. No plan dates or existing exceptions change. Live 221–226 borrow a local HTTPie JWT until 228 replaces it with AuthContext.
- Cohort 4: deep-copy content only into `CSG Full-Stack Bootcamp — Cohort 4`, draft/unassigned. Prework, Live Class and AI modules remain. Retired source lessons stay retired; optional titles become optional, including 232/235 and prework Optional Additional Resources.
- First full Rails CRUD teaching: 143–146. 148/149, 151–156 and 171 become applied project practice. 165–169 and 183–190 become optional retrieval/review labs. Their old video ranges are optional. No graded evidence is waived in the live curriculum.
- After static React components/props (218–220), the copy teaches 228 (forms/router scaffolding + signup/login), 229 (restore/protect session), 221 (authenticated reads), 222 (optional modal), 223–226 (protected CRUD), 227 (optional rebuild), 230/231 (deploy), 232 (optional diagnosis), 233–237 (final delivery; 235 optional). Release days are reassigned to valid weekdays only in the copy.
- Long videos: preserve reviewed start/stop boundaries and cap required aggregate viewing at 1,800 seconds per flagged lesson. If a whole reviewed range exceeds the budget, it is optional review; the written exercise remains required. No arbitrary video cut is represented as reviewed.

## Safe operation

The repair is manual and never runs at deploy/boot. Snapshot uses a repeatable-read, read-only transaction and an exclusive-create private file. Run the default dry-run, inspect its complete JSON diff, then apply with `APPLY=1 SNAPSHOT_PATH=...`. Apply locks source curriculum/cohorts/enrollments/plan/content top-down, rejects snapshot drift, and applies everything in one transaction. It preserves all existing progress/submissions/criteria/attempts/assignments/enrollments/cohorts unchanged in their serialized attributes, checks existing completion states, and checks the plan after removing only the new Git lesson. No messaging, grading, completion, notification or enrollment-copy service is called. The sole added plan revision names admin 1 as author. An existing target package key makes a repeated run a no-op.

The audited source has no objectives, rubrics, checks, course files or hosted uploads. The task refuses a new dependency rather than silently copying an incomplete relationship. Source lesson 4's retired dead Vimeo URL is cleared directly so no watch history is reset. Its text and blocks remain. All other content edits use normal validations.

Resources PRs #3 and #4 merged during implementation. Lance retains the exact matching Alumni archive JWT references, with an explicit single-client contract. Leon subsequently approved cookie sessions for the separate Cohort 4 draft: its password/signup/login/ownership and React auth lessons now teach HTTP-only first-party SameSite=Lax cookies, CSRF protection, and a shared session client. Vite proxies /api in development; Netlify proxies /api/* to Render before the SPA fallback in production. The copied legacy JWT/cross-origin clips in 203–206 and 231 are optional contrast, not required instruction. Resources deploy PR #5 is merged, and all replacement paths were checked against the merged main tree.

## Engineering checks

- Focused migration suite: 4 runs, 480 assertions, no failures/errors. Includes source-shape/rollback/idempotence, retained 213 completion, final HTML entry tags and written PR editor metadata.
- Full Rails suite first pass: 2,484 runs, 45,686 assertions, no failures, 3 local environment errors, 1 expected skip. Migration-process fixtures defaulted to absent postgres role. Final full rerun uses the supported MIGRATION_PROCESS_TEST_DATABASE_URL override and a separate disposable database; pre-cookie rerun passed 2,484 runs / 45,722 assertions, 0 failures/errors, 1 expected skip.
- RuboCop: 850 files, no offenses. Brakeman: no warnings. bundler-audit: no vulnerabilities. Web API types, audited dependency policy and complete check passed (255 test files / 3,522 tests, lint, TypeScript, build and bundle checks).
- Local UI found and fixed an HTML-format detection issue before publication: leading section tags render as literal source in the existing renderer, so new containers use div tags. Added a regression assertion and reran the affected browser journey.
- Production browser check reached Clerk sign-in; no authenticated browser session was available. Production read-only verification will use Rails domain projections and raw records over Render SSH.

Leon approved **cookie/session auth for Cohort 4**. Lance remains on JWTs and the matching archive links. The Git lesson uses `web-development/02-git-github/branches_and_pull_requests.md`, supplied by the lead after Resources #3–#5 merged without renames.

## Cohort 4 session decision

Leon approved cookie/session auth in the lead update. Only the copy changes: 203–206, 228–229 are rewritten around the matched session guides; 205 becomes “Log In with a Rails Session”. Serializer lessons 198–202 point forward to the session guide. 221–226 share the session/CSRF client and use Vite’s same-origin /api proxy. 210/234 acceptance checks use session expiry, CSRF and two-user isolation. 230’s HTTPie checks keep its cookie jar and expect session-login 200. 231 teaches a Netlify /api/* proxy rewrite ahead of the SPA fallback, VITE_API_BASE_URL=/api/v1, first-party Secure cookies in production and SameSite=Lax. The copied old token recordings (203–206) and cross-origin deployment recording (231) become optional historical context. The source curriculum, JWT lesson bodies and source video ranges stay unchanged. Final wording was checked against merged Resources #6 (`6a4a4f9b4dde088385f2fe79af629c4c6414cd58`): same-origin cookies, Vite proxy, relative base URL, Netlify 200 rewrite, no-store auth responses and preserved CSRF.

Final pre-cookie full API rerun: 2,484 runs, 45,722 assertions, no failures/errors, 1 expected skip. Cookie-focused suite: 4 tests, 511 assertions, no failures/errors. Full final API rerun and final-head CI pending.

Cohort 4 browser check: local exported-content rehearsal, synthetic cohort enrolled on the copy only for QA. At 1280 and 390 CSS pixels, lesson 228 renders the matched cookie guide links, same-origin client, CSRF/header instructions and SameSite=Lax wording without literal HTML or horizontal overflow. The production copy stays unassigned. These checks verify curriculum rendering; they do not claim a hosted student sample-app deployment or physical-device cookie test.

Review round 1: CodeRabbit reviewed `3ff5aa95` and requested five changes. Fixed both video-budget findings (one per-lesson budget; missing required flag defaults true), explicit WSL Ubuntu selection, credential form-body instructions (confirmed by HTTPie docs and Leon), and a failure-injection test after source+copy persistence with a successful same-snapshot retry. Focused suite now passes 6 tests / 528 assertions. CodeRabbit’s review reports its one-review-per-hour included allowance exhausted, so a final-head independent review is needed for the subsequent cookie and review-fix changes; this is advisory under the actual repo rules. No claim of final-head CodeRabbit approval.

HTTPie correction approved by Leon: passwords/secrets in Body → Form → URL-encoded name/value rows; Params only for non-sensitive query values. Bearer tokens stay in the Auth panel; CSRF secrets stay in their header and sessions in the cookie jar. The live 203–206/228–230 reminders and borrowed-token step match this. Resources #7 carries matching guide corrections.
