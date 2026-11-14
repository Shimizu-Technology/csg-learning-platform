# L-1.1 redo visibility acceptance

Base: fb69416b, 2026-11-14. CSG Learn serves student learning and instructor review across Rails API, React web and Expo mobile. Source: AGENTS.md, audit L-1.1/U-5.2 and student-public link matrix in Brain Dump. This slice keeps optional instructor-requested revisions discoverable without changing required-work completion or submission eligibility.

Agent-executed affected-flow QA used isolated production course content plus synthetic accounts, own PostgreSQL database csg_redo_qa_20261114, Rails :3734 and Vite :5734 with test auth and external HTTP blocked. No production writes.

Passed: instructor 2 graded Alex submissions 8 (optional lesson 200/block 301) and 7 (required lesson 199/block 299) Redo through the review UI, saving distinct written feedback. Database confirmed saved optional feedback. Alex 3 with active personal plan and cohort_id=1 saw both redos on Today and Learn. Clicked both links; exact blocks showed redo grade and saved feedback before content. Anchored block top approximately 80px. Desktop 1280 and mobile browser 390px checked, no horizontal overflow. Manual-completion work retains manual completion; no new unsupported submission action is introduced. Existing supported submission forms remain available under their existing eligibility rules.

Evidence (local browser artifacts):
- Today desktop: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgdnbue-dceb15c3.png
- Optional manual block 390px: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgdnnxj-aad912e8.png
- Required feedback desktop: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgdo89o-e5ee564e.png
- Learn 390px: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgdnspq-ebb1145e.png
- Learn desktop: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgdof62-2bf53f6e.png

Automated: API learning_plans integration + weekly projection: 24 tests / 154 assertions pass; covers optional/required redos with/without personal plan and disappearance after newer submission. Changed Ruby RuboCop passes. Web lint, TypeScript, renderer Vitest 29 pass. Mobile TypeScript, renderer Jest 41 pass. Impeccable advisory returned []. Native device QA not run; browser resize does not establish native behavior. Full suites delegated to CI. No API payload fields removed or changed.

Initial harness seed guard rejected the new database name before seeding; corrected the copied guard. Initial browser selected Alex alumni workspace; explicitly selected cohort 1 for acceptance. Shared resources were left untouched. Worktree retained for lead; PR must not be merged by implementation agent.

Review fixes, 2026-11-14 (parent 6acf881c; final commit recorded in PR): dashboard redo items now add the enrollment-resolved submission_type already supplied by lessons. Web and mobile distinguish text/repository submissions from manual completion and GitHub sync. Manual redo feedback offers existing contextual help, with “Ask about this feedback” through the existing DM helper when course-question support is available. No submission eligibility changes.

Agent-executed retest: copied harness /tmp/csg-redo-r1-qa-20261114, own database csg_redo_r1_qa_20261114, Rails 3744 / Vite 5744. Synthetic Alex 3, cohort 1; block 299 explicitly configured text_submission, block 301 manual_complete with no text/artifacts, each graded R with distinct feedback. Selected cohort 1 through workspace control. Both cases passed at 1280×800 and 390×844: correct redo copy, feedback exactly once, no horizontal overflow; manual block has no empty submission history/editor or “Review complete” text. Text redo retains an enabled form; clicked Resubmit at 390px, observed awaiting-review confirmation and database attempt 2 (id 58) with null grade and saved text. Manual fixture remains instructor-reviewed. Native device and GitHub service integration not run; GitHub copy covered by web/mobile regression tests. DM helper behavior covered by existing entitlement tests; this fixture uses guided help rather than course-question support.

Retest screenshots:
- Manual 390: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwge2dxw-fdd45ae9.png
- Manual 1280: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwge2lsx-052efcbd.png
- Text 1280: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwge2s6w-924b8899.png
- Text 390: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwge2zv3-12fdf5c5.png

Final automated retest: API 24 tests / 166 assertions, changed Ruby RuboCop; web TypeScript, focused ESLint and 65 Vitest tests; mobile TypeScript and 46 Jest tests all pass. Impeccable advisory returned []. API tests used csg_redo_r1_20261114 with PARALLEL_WORKERS=1. Logs: /tmp/redo-r1-api-tests.log, /tmp/redo-r1-mobile-tests.log, /tmp/redo-r1-impeccable.log. Initial preview attempts failed because shell-background servers exited; persistent sessions resolved it. Alternate browser unavailable (native pipe closed). No production writes.

Known pre-existing difference: dashboard all_block_ids uses completion blocks, while weekly-plan redo projection uses all blocks. This fix leaves that broader projection difference unchanged.

Cleanup: exact Rails PID 63906 and Vite PID 63936 stopped; all three preview tabs (including two failed-navigation tabs) closed. Own test and QA databases dropped. No servers, native devices, or production resources handed off. Existing worktree retained for lead review/merge.
