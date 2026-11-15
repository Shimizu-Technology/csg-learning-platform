# W3 PR 3.10: dark mode, motion and one code block (U-6.1, U-6.2, U-6.4)

Agent-executed affected-flow QA on the Mac mini, branch `feat/theme-motion`,
using the synthetic QA harness (`scripts/qa/run`, Clerk stubbed, no external
traffic). Chromium only: WebKit doesn't start on this machine.

## What was checked

`scripts/qa/theme.spec.ts` (new) visits 54 pages across the roles at 1280 and
390, in light (a saved Light choice) and dark (System with a dark OS), for 216
page loads. Each load records axe WCAG 2.1 AA results with contrast reported
separately, horizontal overflow, the `data-theme` and `theme-color` values,
console errors, and, in dark only, any large near-white box (a missed
hard-coded surface). It also saves a screenshot.

| Role | Pages |
| --- | --- |
| Admin (1) | Today, Students, Grading, Help, Content, Cohorts, Cohort, Student workspace, Watch progress, Module grading, Submission, Help request, Follow-up plan, Lesson editor, Team, Activity, Meetings, Moderation, Messages, Conversation, Updates, Profile, Not found |
| Instructor (2) | Today, Grading, Help, Students, Submission, Cohort, Content, Messages, Updates, Profile, Team (No access) |
| Program student (3) | Today, Learn, Module, Lesson, Lesson with a redo submission, Recordings, Resources, Meetings, Messages, Updates, Notifications, Profile, Staff page (No access) |
| Self-paced student (6) | Today, Learn, Lesson |
| Signed out | Landing, Sign in, Terms, Privacy |

Final run: 226 harness tests passed (theme sweep plus the existing smoke and
sign-in destination specs).

## Results

| Check | Light | Dark |
| --- | --- | --- |
| Text contrast (axe `color-contrast`) | 0 failures on 108 loads | 0 failures on 108 loads |
| Horizontal overflow at 390 and 1280 | none | none |
| `data-theme` / `theme-color` | `light` / `#ffffff` app, `#faf7f0` public | `dark` / `#151a22` app, `#11100d` public |
| Near-white boxes in dark | n/a | only the Profile email switch in its "on" state (ink fill; the switch inverts on purpose) |
| Console errors | none from the app | none from the app |

Token contrast is also checked by unit test (`src/styles/tokens.test.ts`) for
every text, status, code, syntax, focus-ring and control-border pair in both
themes. All pass, including the focus ring (blue `#1d4ed8` / `#6ea8ff`)
against page, raised, sunken and cream surfaces.

### Found and fixed during QA

- **Terms and Privacy were illegible in dark.** `prose-slate` set its own
  dark-on-light colours (1.06:1). The legal pages now use `prose-tokens`, which
  maps the typography plugin to the colour roles, and the raw-colour lint
  now flags `prose-<palette>` classes.
- **Logo plate (reverted).** The first pass put the logo on a light plate in
  dark. The PNG is an opaque dark tile, so the plate only added a frame; it
  was removed.

### Checked by hand (screenshots and targeted scripts)

- **Code blocks:** the lesson, submission (line numbers) and redo views in
  both themes. Copy shows "Copied" and the live region announces it; the
  clipboard holds the code without line numbers. No overflow at 390.
- **Monaco:** for this one check only, the jsDelivr CDN was allowed. The
  editor background is `#f6f7f9` in light and `#0f141b` in dark, the same as
  `code-bg`, so the editor and `<CodeBlock>` match.
- **Theme choice:** on a 390px phone, More › account menu › Dark sets
  `data-theme="dark"`, the `#151a22` status bar and the saved choice; it
  survives a reload. After switching back to System, changing the OS to dark
  follows straight away. The public footer choice is covered by
  `test:a11y`.
- **Reduced motion:** after a page change with `prefers-reduced-motion:
  reduce`, `document.getAnimations()` has nothing running, both in the app
  and on public pages.
- **Charts and progress:** the dashboard and cohort cards, student-workspace
  progress, the watch-progress matrix and the Today progress bar. Tracks use
  `line`, fills use the status `-solid` roles, and all are visible in both
  themes. The "Week complete" ring wasn't reached in the fixtures; it uses
  the same roles (`success-line` track).
- **Status colours:** Redo, Waiting, Active, Online and error notices all
  read in dark (`*-soft` fills with `*-ink` text).
- **No access and Not found:** both read in dark at 390 and 1280.
- **Video and media:** players, placeholders and the image lightbox use
  `media` / `on-media`, which stay dark in both themes like any player.
  Embedded YouTube and Vimeo iframes and PDFs keep their own styling; they
  aren't reachable in the harness, because media URLs are `example.invalid`.

## Not covered

- **Real Clerk widgets.** The harness stubs Clerk. Clerk's `appearance`
  variables for dark are unit-tested against the tokens
  (`clerkAppearance.test.ts`), but the hosted widget in dark has not been
  seen. `test:a11y` was run against the harness, because no publishable key
  is available here and CI skips that job without one.
- **Safari / WebKit, real iPhones.** Not available on this machine. The iOS
  standalone status bar keeps `apple-mobile-web-app-status-bar-style:
  default`.
- **Rich-text editing.** The lesson editor's Edit view was screenshotted in
  dark. Typing in the TipTap surfaces was not exercised beyond the existing
  unit tests.
- **Emails.** Server-side and out of scope.

## Pre-existing issues (same in both themes, not changed here)

- Updates: the two filter `<select>`s have no accessible name (axe
  `select-name`).
- Follow-up plan: `<dt>`/`<dd>` sit outside a `<dl>` (axe `dlitem`,
  `definition-list`).
- Submission page: the grading panel shows the focus ring after load
  (programmatic focus).

## Resources

The harness (API PID 20012, Vite PID 20018, database
`csg_qa_19996_1794757903`) was stopped and its database dropped. Playwright
browsers closed with each run. Nothing started for this task is still
running. Raw results and screenshots stay in the ignored `.qa-local/theme/`.
