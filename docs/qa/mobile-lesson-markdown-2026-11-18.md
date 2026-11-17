# N-6: mobile lesson Markdown integrity

## Context and acceptance

Implementation baseline: `3a8b3ebf3f50913e6c4d2dbc56efb0fb26bf9d01` (`origin/main`), November 18, 2026.
CSG Learn shares Rails curriculum records between web and the Expo app. Admins edit the shared library; instructors retain read-only preview. Sources: `docs/MOBILE_APP.md`, `StaffLessonEditor`, `lesson-editor.ts`, `LessonsController#update_editor_exercise!`, and [PR #304](https://github.com/Shimizu-Technology/csg-learning-platform/pull/304) (read at `6c198751e7f7dd4b63378bf5b583005e03d39a5c`). Brain Dump is unavailable on this host; orientation uses repository evidence and the supplied task brief.

Required behavior: opening/previewing must not dirty the lesson; a title-only save must preserve the body exactly; an instruction edit must affect only the edited source; creation must write Markdown. Existing draft recovery, conflict protection, permissions, learner rendering, and Cohort 3 flags stay in place. No production access or repairs are part of this task.

## Implementation

Choose approach (a): a controlled, monospace native Markdown input with autocorrection, capitalization, and spellcheck disabled. Both the existing lesson editor and New lesson use it. Its preview uses the learner's existing `LessonMarkdown` component. The full lesson preview still uses `LessonContentBlockCard`.

Remove the save/preview helper's trim and HTML sanitization pass. Validation may inspect content but never rewrites it. Rendering remains responsible for filtering unsafe HTML (`AuthoredContent`); the Rails endpoint already stores the supplied body without trimming. Existing HTML and old device drafts remain source, with no speculative HTML-to-Markdown repair. Empty input still maps to null as before; nonempty whitespace remains exact.

No API, generated types, shared web converters, native dependencies, package scripts, or Expo configuration change. The unused legacy `StaffRichTextEditor` remains available in source but has no production callers after this change.

Follow-up (b): bundle the web `MarkdownEditor` and the lossless converters from #304 into the existing WebView. Define a Markdown-only bridge, keep source until an explicit edit, lock unsupported blocks, and test readiness/reloads/draft recovery before replacing the native input. This needs a web bundle/build integration and bridge tests; it is larger than this fix. Recheck the fingerprint then.

A server guard was considered and deferred: bodies currently allow both HTML and Markdown, have no format field, and the mobile endpoint supplies no trustworthy per-block format/client provenance. A blanket HTML rejection would break legitimate existing/web content (including inline HTML). A future additive `body_format: markdown` contract could flag a Markdown-to-HTML transition explicitly, after all authoring paths declare their format. It must not guess format from a leading tag.

## Automated evidence

- The fixture is copied byte for byte from #304's `web/src/test/fixtures/prework-lesson-bodies.json` at the revision above. Its generator uses `html_to_markdown` from the prework import over `scripts/prework_exercises.json`: 127 real course bodies, not invented Markdown samples.
- 254 corpus cases load/preview/save unchanged and edit the first paragraph while preserving the complete suffix. Four extra cases cover boundary whitespace, CRLF, HTML fragments/entities/escapes, and whitespace-only source.
- Component tests use the actual Markdown input: opening/previewing remains clean, title-only save preserves source, and a paragraph edit reaches the save callback exactly. New lesson writes exact Markdown. A focused component test checks the preview bridge into `LessonMarkdown` without an `onChange` event.
- Local fingerprint comparison uses the installed `@expo/fingerprint` equivalent: `createFingerprintAsync(mobileRoot, { platforms: ['ios'] })`. Compare pristine main and final files in the same isolated worktree/dependency installation/environment, Node 22.22.3. Both hashes: `164df5a292cd4ad70cf1b725469fc61a3ed919c7`. Source manifests also match. No runtime change from this PR. A separate checkout initially proved unsuitable as a baseline because it was on an older commit without expo-updates; it was not used for acceptance.
- Installed-build/environment compatibility is not established by the local comparison. The release operator must still run `npx eas-cli@16.28.0 fingerprint:compare --build-id <INSTALLED_BUILD_ID> --environment production` immediately before publication, as required by `docs/MOBILE_APP.md`.
- Impeccable 4.6.0 advisory scan on changed UI files: `[]`. This static scan is not native usability acceptance.

Final local gate: `cd mobile && npm run check`, Node 22.22.3, passed: brand assets, URI decoder tests, OTA release-helper tests, typecheck, ESLint (0 errors, 74 existing warnings), and all 144 Jest suites / 1,812 tests. The corpus contributes 258 cases. Existing React test `act` warnings remain in the full suite. `git diff --check` passed. These results apply to the implementation committed with this record; later edits to this record and MOBILE_APP.md are documentation only. No API gate or web gate is required because neither is changed.

Review status at PR creation: local diff inspection completed; CI and automatic CodeRabbit review pending. The user requested no merge and no watch. No OTA was published.

## Affected-flow QA and limits

Agent-executed automated cases cover opening, per-field preview, full draft preview, title-only save, a paragraph edit, creation, draft recovery/conflicts, and role boundaries. Component tests mock network/persistence dependencies; they do not prove installed-device behavior or a real server round trip. The payload tests exercise the actual serializer; Rails storage behavior was inspected, not tested against production.

Native iOS/device QA: **not run**. This Mac mini has no booted/available simulator or screen session; machine policy excludes simulators here. Operator acceptance: on an OTA-compatible test build, open a real Markdown exercise, preview and return, change only the title, save, and compare the stored body byte for byte. Then change one paragraph and verify only that paragraph changes. Check keyboard scrolling, draft recovery, and preview reachability on iPhone. Learner rendering code is unchanged; installed-device acceptance remains separate from automated checks.

No servers, browser tabs, simulators, containers, or databases were started. Lifecycle baseline marked existing PostgreSQL/T3 listeners borrowed/protected; no owned runtime resources remain. Branch/worktree are retained for the held PR.

## Production detection (operator only; not executed)

Run on a read-only connection. This reproduces the mobile renderer's leading-HTML heuristic, includes exercise/code/checkpoint bodies as well as text blocks, and returns candidates without changing records:

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT cb.id AS content_block_id, cb.lesson_id, l.title AS lesson_title,
       cb.block_type, cb.updated_at AS block_updated_at,
       l.updated_at AS lesson_updated_at,
       octet_length(cb.body) AS body_bytes, left(cb.body, 160) AS body_start
FROM content_blocks cb
JOIN lessons l ON l.id = cb.lesson_id
WHERE cb.block_type IN (1, 2, 3, 4)
  AND cb.body ~* '^[[:space:]]*<(p|div|h[1-6]|ul|ol|li|pre|blockquote|table|img|br|hr|!doctype)([[:space:]]|>)'
ORDER BY cb.updated_at DESC, cb.id;
ROLLBACK;
```

Enum values come from `ContentBlock`: text=1, exercise=2, code_challenge=3, checkpoint=4. This is a candidate list, not proof of conversion: legacy HTML and intentionally authored HTML also match; inline HTML later in Markdown does not. Before any repair, compare candidates with an earlier backup/export or the import source and inspect a before/after diff. Never automatically convert all matches.

`content_blocks` and `lessons` have timestamps but no `updated_by`/client-source columns or body revision history in the current models/schema. `s3_video_uploaded_by_id` is video attribution only. `updated_at` narrows a time window but cannot attribute a body edit to mobile or recover its previous source. Retained request/auth logs may correlate an editor request, user identity, and user agent if those fields were captured; user agent alone may be ambiguous and no mobile attribution header is currently sent. A backup/history outside this repository would be needed to prove what changed. Whether production contains converted lessons remains **unknown until the operator runs this read-only check**.
