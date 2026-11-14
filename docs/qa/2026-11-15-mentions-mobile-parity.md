# Mentions and mobile Markdown parity

Source: `62e258a` (`origin/main` at task start), branch `feat/mentions-mobile-parity`.

CSG Learn is the learning hub for students, instructors and admins (`docs/PRODUCT_VISION.md`, `AGENTS.md`). This change covers message reading, mention insertion/editing, phone Markdown composition, and announcement reading/writing. Clerk and the existing Rails REST API remain unchanged. Acceptance follows redesign §9, §9.9 and §12, with mobile Rich mode excluded as W10.

## Acceptance and evidence

Agent-executed affected-flow QA used `scripts/qa/run start`, the local synthetic personas and Chromium at 1280×800. No production data or services were used.

- Passed: plain `@QA Admin` with no stored id stays plain; the same label with id 1 renders in the current-user color for `?qa_user=1`.
- Passed: inline-code `@QA Admin` with id 1 remains code, with no mention pill.
- Passed: the Markdown composer sent `QA saved @QA Program`; the saved message appeared with the ordinary mention color. Other UI sends containing unrecorded names and inline code stayed plain/code. Saved bodies and empty id arrays for those sends were verified in the isolated QA database.
- Passed by tests: duplicate names, renamed-user safety, code exclusion during id resolution, current-user color, native id gating, mobile formatting help dismissal, announcement toolbar→Preview→saved Markdown, keyboard source behavior, and code/HTML/list normalization.
- Regression evidence: restored original implementations temporarily and ran the new regression suites. Web's three mention tests failed; mobile help, toolbar insertions, normalization, duplicate-id resolution, id-gated rendering, announcement preview and keyboard-source tests failed. Restored fixes and reran gates.

## Gates and limits

Web: lint, `tsc -b`, full Vitest (135 files / 1,238 tests), production build. Parser, source-action and normalization parity checks pass. Impeccable advisory scan returned no findings for the scanned message renderer and native toolbar paths.

Mobile: lint (zero errors; 27 existing warnings), typecheck, full Jest. Native UI is tests-only on this host: no iOS/Android simulator or real-device keyboard/gesture checks. WebKit/mobile Safari and production deployment were not run. API code was not changed; API lint/Minitest gates do not apply. Review and merge belong to the lead session.

The API has no historical mention labels or per-token positions. A renamed user's old label remains plain, and identical labels within one message cannot be distinguished by position. Legacy API notification matching is unchanged.

## Cleanup

Closed the task-owned preview tab. Ran `scripts/qa/run stop` then `scripts/qa/run clean`: both owned servers stopped and `csg_qa_75449_1794687435` was dropped. No simulators or containers were started. Shared PostgreSQL remains available. The shared lifecycle helper could not start because its machine profile failed validation (`schema_version must be 1`); the QA script recorded exact process identities and performed cleanup. Branch and checkout are retained for the lead.
