# Staff workspace phone layout — W7 PR 7.6b

Agent-executed affected-flow QA, 2026-11-17 (Guam). Application source:
`5a1d629781ea81d66a96cf2b090530fe662379b1`, based on `e0af0801` (#284,
including #268 and #287). Branch: `feat/staff-mobile-layout`. This PR is held
for lead review; no merge, watch or deployment was performed.

## Context and acceptance

CSG Learn combines learning and staff operations. Admins configure cohorts;
assigned instructors use cohort and student workspaces to review learning,
work, support, communication and access. Sources: `AGENTS.md`,
`docs/PRODUCT_VISION.md`, redesign README §§3–6 and mockups 01/06, existing
workspace tests, and Brain Dump `code-school/_overview.md` and
`code-school/csg-learn-platform-audit-2026-11-14.md` (T-10/T-14).

At 390px the admin's nine cohort sections occupied five rows (237px). The new
native Section select occupies one 47px row. All seven student sections stay
available, with work/support counts in their option labels. The existing
URL-backed desktop links retain their semantics and styles. The select uses the
same route builders and return state. The existing synchronous `useMediaQuery`
hook chooses the control on the first client render, without a later layout
measurement or effect-driven swap. No motion was added.

Phone Settings controls use one column, at least 44px targets and 16px input
text. Save settings stays above the primary bottom navigation throughout the
long form. Module/resource dialogs retain their footer actions. Desktop layouts
and save placement remain unchanged. Acceptance requires every permitted
section, no horizontal page overflow, saved/recoverable edits, preserved
navigation context and pixel-equivalent desktop output.

## Fixtures and environment

Owned schema-only harness database `csg_qa_72395_1794889625`, base synthetic seed
plus `student-workspace-fixtures.rb`; admin 1, assigned instructor 2, cohort 1
and synthetic student 3. The fixture includes a second enrollment, an objective,
reviewable work, messages and a meeting. All people/content are synthetic.
No production database or provider credentials were used. External browser
requests were blocked. The failed-save check intercepts one local PATCH with a
503; retries and final persistence use the real local Rails API.

Bundled Chromium on the MacBook, viewports 390×844 and 1280×844, light/dark,
admin/instructor; one browser worker. The app shell and student-profile mockups
were also inspected at 390px. Browser Date was fixed to
`2026-11-17T04:28:00Z` for section screenshots. That controls relative labels,
not the Rails clock. No native screens or real-phone/Safari behavior was tested.

## Required journeys

| Case | Actions and independently checked outcome | Coverage | Result |
| --- | --- | --- | --- |
| L01 — Every section | Open every cohort/student section through its actual control; verify URL, rendered content, settled loading/error state, no document overflow and a compact phone nav. Also open Learning insights and verify Learning remains selected. | Both roles × both widths × both themes; 8 matrix executions, 120 section screenshots and 8 insights visits | Passed |
| L02 — Settings editing and recovery | Check visible text/date/select sizes; scroll top/middle/bottom and verify Save remains above primary nav. Edit GitHub organization, try leaving, Keep editing, check draft and selected section. Fail one save, retry, read saved API value, reload and verify. Restore original value through the UI and verify it through the API. Open dense module Configure dialog and check containment. | Admin × both widths × both themes; 4 executions | Passed |
| L03 — Keyboard, Back and return context | Focus the phone select and use native type-ahead to choose Support, then choose Access. Browser Back restores the prior route/selection and Back to Activity retains its exact destination. Desktop uses original links. Direct instructor Settings URL falls back to Overview; Settings/Teaching team remain unavailable. | Both roles × both widths; 4 executions | Passed |

All 3 required journeys accepted across 16 executable scenarios. No outstanding
failed, blocked or not-run required dimension. Native popup arrow-key handling,
physical keyboards, screen readers, iOS safe areas and software keyboards are
not certified by resized Chromium. Keyboard type-ahead and focus were exercised;
selection keeps the browser's native semantics rather than adding a custom ARIA
tab implementation.

## Desktop screenshot comparison

Captured original page source from `e0af0801` and the final application against
the same database, viewport, browser clock and theme, after fonts and secondary
panels settled. Original page files were restored only for baseline capture;
the implementation was restored before final acceptance. **60 of 60 full-page
desktop PNGs are pixel-identical: zero differing pixels.** This covers every
ordinary workspace section for both roles in light/dark, including Settings.
The insights route was checked separately in all eight dimensions.

The complete per-screen result is
[desktop-comparison.json](staff-mobile-layout-2026-11-17/desktop-comparison.json).
Representative full-page evidence:

- Admin Settings desktop: [before](staff-mobile-layout-2026-11-17/before-1280-1-light-cohort-Settings.png), [after](staff-mobile-layout-2026-11-17/after-1280-1-light-cohort-Settings.png).
- Instructor Learning desktop, dark: [before](staff-mobile-layout-2026-11-17/before-1280-2-dark-student-Learning.png), [after](staff-mobile-layout-2026-11-17/after-1280-2-dark-student-Learning.png).
- Phone: [cohort Overview](staff-mobile-layout-2026-11-17/390-1-light-cohort-Overview.png), [Settings dark](staff-mobile-layout-2026-11-17/390-1-dark-cohort-Settings.png), [instructor Support](staff-mobile-layout-2026-11-17/390-2-light-student-Support.png), [instructor Learning dark](staff-mobile-layout-2026-11-17/390-2-dark-student-Learning.png).

All 120 after screenshots and the full baseline remain in ignored
`.qa-local/staff-layout/`. The committed
[source manifest](staff-mobile-layout-2026-11-17/source-sha256.json) identifies
the tested application files. Local and ASUS SHA-256 values for all three page
entry points were explicitly compared and matched during the final gate.

## Refactor map

| Original file | Extracted responsibilities |
| --- | --- |
| `CohortDetail.tsx` (880 → 108 lines) | `cohortSettings/useCohortSettings.ts`: existing load, draft, dirty-baseline and multi-request save operations; `settingsForm.ts`: types/date/status helpers; `SettingsFields.tsx`, `ModuleSettings.tsx`, `ModuleSettingsDialog.tsx`, `ResourceSettingsDialog.tsx`: form surfaces |
| `CohortWorkspace.tsx` | `cohortWorkspace/useCohortWorkspace.ts`: loading, permissions/features, route selection and insights; `Overview.tsx`, `Students.tsx`, `Learning.tsx`, `Insights.tsx`, `Communication.tsx`: section views |
| `StudentWorkspace.tsx` (466 → 240 lines) | `studentWorkspace/useStudentWorkspace.ts`: loading, history/roster, sections and refresh/message operations; `StudentWorkspaceHeader.tsx`, `StudentStepper.tsx`: record/roster navigation; `OverviewTab.tsx`, `WorkTab.tsx`, `LearningTab.tsx`, `SupportTab.tsx`, `presentation.tsx`: views and badges |

`components/admin/WorkspaceSectionSelect.tsx` supplies the phone control.
Apart from T-10 layout, the extraction preserves requests, state lifetime,
feature/role boundaries, existing links, partial-save retry behavior, leave
guards, preview entry points and return-state handling. No API, schema, URL,
Expo or `ContentBlockRenderer.tsx` changes. Existing tests were not edited.
A new Vitest guard rejects lines over 160 columns in these JSX files; a second
new test checks selection, URL history and forwarded return state.

## Engineering checks and retests

Final ASUS command (exit 0):

```sh
asus-test --postgres csg_learning_platform_test <repo-root> -- bash scripts/qa/staff-mobile-layout-gate.sh
```

Passed: web typecheck, ESLint, **2,513 tests / 220 files**, Netlify build-ignore,
routing and notification checks, production build, `test:bundle`, and
`api:check` (including the mobile generated-type twin). API/native suites were
not run because their application source is untouched. The existing
`student-workspace-gate.sh` migration-process port adapter and prepared-statement
configuration were not changed. Impeccable 4.6.0 advisory scan returned `[]`
for the split UI and final select. Diff whitespace validation passed.

The first full run had five roster-test failures because their first-select
selectors encountered the CSS-hidden phone select. Rendering that control only
below the existing breakpoint fixed the issue; the complete suite passed with
all existing tests unchanged. Early screenshots caught async loading/empty
states and relative-time changes. Waiting for spinners and the assigned
instructor, and fixing browser Date, produced the final zero-diff comparison.
One run was invalidated by an HMR reload while the select was being updated.
The final section/form matrix passed on the stable source. The initial native
popup key sequence did not commit a choice under automation; the final test
exercises native type-ahead, focus and Back successfully for both roles/widths.

Reproduction and fixture commands are in `scripts/qa/README.md`.

## Resource disposition

Lifecycle session `01a1e7c0-8012-7a82-bd18-0161cf996efc`. The owned preview tab
was closed, all browser runners/pages finished and released, mockup server
96149 stopped, API 81011 and Vite 81029 stopped, and the exact harness database
was dropped. The first ASUS wrapper's claim was refused because its
`--postgres` argument matched the machine's protected-process pattern; its
exact PID was retained and verified absent at completion. The final ASUS
wrapper used a claimed Python parent; `asus-test` cleaned its disposable
PostgreSQL container and shut down WSL on exit. `dev-lifecycle cleanup` and
`status` report **no active owned resources**. Borrowed/protected PostgreSQL,
Redis, simulators and other sessions were left available. The requested branch
and worktree remain for lead review.
