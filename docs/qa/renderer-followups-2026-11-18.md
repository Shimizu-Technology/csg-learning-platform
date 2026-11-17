# Renderer review follow-ups — 2026-11-18

Base: fresh `origin/main` at `096cc89a` (#298 merged). Application/test source:
`7201c5ca7a659c1210a11e8c1d95645d65a30ff8`. Branch `fix/renderer-followups` reuses the cleaned
`~/work/csg-student-polish` location; the old worktree and merged local
`feat/student-polish` branch were removed before implementation.

This inherits the W8.5 product brief and learner protection rules. Only an explicit
resolved cohort switch shows the redesign. Off keeps the same learner behavior
and DOM apart from the two legacy Learn touch targets. No API, mobile or generated
transport types changed. Existing outline data determines whether a module exists;
the notice and recovery add no requests. No new motion.

All six P3s are addressed:

1. Replace hashes with 72 readable, line-broken HTML snapshots generated from the
   pre-split renderer at `90f075e3`. Only anchors matching the artifact links' full
   old class list, target/rel and four labels normalize 36px to 44px. Responsive
   Button classes remain exact. A separate test checks normalization boundaries.
2. Rendering and playback tracking share `videoUrls.ts`. Tests cover youtu.be,
   embed and watch?v= plus Vimeo IDs/private hashes and unsupported formats.
   Shorts remain unsupported, preserving Off's previous fallback behavior.
3. Student-polish captures and comparison JSON now go to ignored
   `.qa-local/student-polish/`. An actual eight-case rerun passed and Git status
   for tracked `docs/qa` was identical before and after.
4. Legacy Expand all/Collapse all retain their styling with a local 44px minimum
   at the desktop breakpoint. Shared Button sizes are unchanged.
5. On missing/invalid module targets show an h1 notice and Back to Learn in the
   same cohort. Valid module links still open their outline group. Unit tests
   cover missing numeric and malformed targets, recovery and one outline request.
6. Remove the unused checkpoint-hook completion parameter and tidy extracted
   JSX indentation, import spacing and extra blank lines. Controller narrowing
   is deliberately deferred.

## Validation

- Affected tests: 156 passed in 7 files (renderer parity/extractions, URL parsing,
  CourseOutline and student experience routes).
- Typecheck, ESLint, production build and bundle check passed. Advisory Impeccable
  scan returned no findings.
- Mutation proof: temporarily changing actual Button `lg:min-h-9` to
  `lg:min-h-10` failed five snapshots (68 tests passed). Restore Button, and all
  73 DOM-parity/normalization tests pass. Repeated after switching to the final
  readable HTML format. Button has no committed diff.
- Agent browser QA: four cases passed, 390/1280 × light/dark. Both legacy targets
  measured **44px** in every case. Collapse/Expand changed every disclosure;
  missing On module showed its notice; Back preserved the cohort; a valid module
  link reopened the outline. No horizontal overflow. The existing eight
  On/Off block-type browser journeys also passed after helper/formatting changes.
- Chromium only; no real device, Safari or provider-playback certification.

## Cleanup and residual

Lifecycle `manual-20261118-024758-44135-e1ff` reports no owned resources remaining.
The owned harness servers were stopped, QA database dropped, and preview/browser
pages closed. Ignored captures were removed with the disposable harness state.
Protected and borrowed services were left unchanged. Keep the clean implementation
worktree for PR review; do not merge or watch.

Residual: narrow `useContentBlockController` and its view-specific prop contracts
in a separate task, as requested. CI and independent review are separate from
these completed local checks.
