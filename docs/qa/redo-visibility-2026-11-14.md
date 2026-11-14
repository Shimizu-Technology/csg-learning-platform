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
