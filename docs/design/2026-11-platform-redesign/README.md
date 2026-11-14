# CSG Learn platform redesign: design spec (W0 PR 0.3)

**Status:** draft for Leon's review, 2026-11-14. Nothing here is built. Waves W3, W5, W7 and W8 start from this spec once Leon approves it.
**Source of truth for scope:** the audit backlog `Brain-Dump/code-school/csg-learn-platform-audit-2026-11-14.md` (sections U, L, S, T, M, AS, Decisions, Implementation plan) and its link matrices. Backlog IDs are cited in brackets throughout.
**Decisions this spec assumes (Leon, 2026-11-14):** light and dark mode with a Light / Dark / System choice; Enter-to-send is a per-user setting, on by default; self-paced work is reviewed by an instructor; features are switchable at school and cohort level, and the nav, Today, help and empty states are generated from what's on; course community for self-paced learners is a per-course option, off by default.

## How to review

Open [`index.html`](index.html). It links all 13 mockups, says what changed in each and which backlog IDs it covers, and ends with a review checklist. Each mockup has:

- **Light / Dark / System** at the top. Your choice carries across pages.
- **Desktop / Phone**, which switches the frame between 1280px and 390px. Layouts respond to the frame, so the phone view is accurate on a laptop.
- **Variants** where a screen has several states (for example "Behind · Blair", "After submit").
- **Notes**, a panel listing what changed and why, with backlog IDs.

The mockups are static HTML with no build step. To view them locally, run `python3 -m http.server 4817` in this folder and open `http://127.0.0.1:4817/`. They load Manrope from Google Fonts and Lucide icons from unpkg (`lucide@0.469.0`); everything else is in [`assets/`](assets/).

| File | What it is |
| --- | --- |
| [`assets/tokens.css`](assets/tokens.css) | Proposed light and dark theme tokens (the values this spec documents) |
| [`assets/mock.css`](assets/mock.css) | The patterns below, written as plain CSS on those tokens |
| [`assets/shell.js`](assets/shell.js) | Nav config per role and feature, and the search results; generates the shell |
| [`assets/mock.js`](assets/mock.js) | Mockup behavior only (theme, width, tabs, filters, drawers, toasts). Not production code |

## 1. Principles

1. **One next action per screen.** Today, Learn and the lesson page each have one primary button. Everything else is secondary or a link.
2. **Phones first for students.** The first thing to do is visible on a 390px screen without scrolling past banners or stat cards [U-6.7].
3. **Every mention is a link, and you can always get back.** Names of students, lessons, cohorts and submissions are real links. Back labels say where you came from [L-0].
4. **Show only what this school and cohort actually run.** A switched-off feature disappears from nav, Today, help and search instead of leaving an empty page [C-3, C-7].
5. **One name per concept**, in sentence case, in plain language. No developer words in the UI [S-4, U-6.6, T-9].
6. **Status comes from one place.** "Behind", progress counts and "waiting for review" are computed once on the server and shown the same way everywhere [U-0.5, T-3, AS-10].
7. **Calm motion.** Animation confirms an action or shows where something went. Keyboard-driven and high-frequency actions don't animate [U-6.2].
8. **Name the person.** "Audreana will review it, usually within 2 days" beats "Your submission is pending review" [S-8].

## 2. Glossary

One name per concept. Use the left column in the UI, routes, page titles, toasts and emails. The "retire" column lists names to remove (the naming test in `web/src/styles/naming.test.ts` should grow to flag them [S-4]).

| Concept | Use | Retire | Notes |
| --- | --- | --- | --- |
| Daily home page, every role | **Today** | Dashboard, Staff home, Home | Staff and students both land on Today. The installed app opens Today, not the landing page [U-0.8]. |
| Learner's course outline | **Learn** | Materials, Open learning, My course, Your course, cohort home | One outline for every delivery mode [C-2]. Buttons: "Continue", "Open lesson". |
| Learner's submitted work | **My work** | Grades, Submissions page | Tabs: Needs you, Waiting for review, Graded [L-1.2]. |
| Staff announcements | **Updates** (one is "an update") | Announcements, Class notices, Class updates, Announcement studio | Staff action: "Post update". |
| System alerts | **Notifications** (bell) | Updates › Inbox | Bell in every shell [L-2.9]. |
| Learner asks about a lesson | **Ask for help**, which creates a **help request** | Ask a course question, Instructor support, Instructor messaging, Course questions | One button per lesson [S-6, C-4]. After a reply the button reads "View response" [L-1.3]. |
| Account or billing problem | **Contact CSG** | Technical or account support | Opens the school support email from brand config [X-2]. |
| Direct conversation | **Message _name_**, **Messages** | DM (in UI), Instructor messaging | "Message Audreana" opens that conversation, never an empty inbox [S-7, L-1.7]. |
| Staff area for help requests and follow-ups | **Support** | Student support, Support queue | |
| Staff record for a struggling student | **Follow-up plan** | intervention, case, recovery plan, check-in, owned intervention | Actions: "Start follow-up plan". Items inside are "next steps" [U-4.6]. |
| Students who need staff attention | **Needs attention** | At risk, Active enrollments checked, Released unfinished | "Behind" is a reason shown inside it: "about 3 weeks behind" [T-3]. |
| Staff grading area | **Grading** | Grading inbox, review queue | |
| Shared work statuses | **Waiting for review**, **Redo requested**, **Graded** | Awaiting review, Latest attempts awaiting review, Submitted (as a status) | Same words for staff and learners. |
| Grades | **A, B, C, Redo** | R, "Submission graded R." | Toast: "Saved B for Alex Rivera". |
| The thing learners do | **Exercise** | assignment, practice block | What they turn in is a **submission**; each try is an **attempt** ("attempt 2"). |
| What progress counts | **Lessons** ("155 of 243 lessons") | blocks, steps, parts, "0/1 blocks" | Learners never see block counts [U-5.6]. |
| Pieces of a lesson (authoring only) | **Block** | part, step, "2b" | Text, Video, Exercise, Code challenge, Checkpoint [U-2.1]. |
| Quick quiz block | **Checkpoint** (staff); "Check: _topic_" title for learners | knowledge check (in learner UI) | |
| Group of lessons | **Module**; programs group a module by **Week _n_** | unit | Self-paced modules show as numbered sections without weekdays [S-1]. |
| Staff content area | **Content** (nav); each item is a **curriculum** | Content Management, course package (except import/export) | |
| Group of enrolled learners | **Cohort** | class, workspace (in UI) | The word "workspace" leaves the UI. |
| What a learner bought | **Course**, shown by its **public title** | internal cohort name, "Pilot Draft", "Internal draft" | [U-0.11] |
| How a cohort runs | **Live program**, **Self-paced** | guided, async (in UI) | The partially async mode gets a name when AS-5 is designed. |
| Enrollment state | **Active, Paused, Completed, Withdrawn** | inactive, "Not enrolled yet" for a paused learner | [U-0.2] |
| Scheduled sessions | **Live class**, **Office hours**, **Meeting** (one-to-one) | Private meetings, live session | Staff nav: "Meetings". |
| Class video | **Recording** | video (for class recordings) | A lesson's own video is a Video block. |
| Seeing a learner's view | **View as student** | Preview as student, Student preview | In the editor, "Preview" previews the lesson. |
| Manual completion | **Mark complete** | Mark done | One control per lesson [S-14]. |
| Group conversation | **Class chat** (cohort), **Course community** (self-paced, per course) | Class Chat, channels (in learner UI) | Course community is off by default (Decision 3). |
| Alumni content | **CSG Alumni library** | course framing, "0 of 80 blocks" | Browse, not progress [U-5.10]. |
| Global search | **Search** (⌘K) | command palette (in UI) | |

**Writing rules**

- Sentence case for every title, button, tab, label and toast ("Save changes", "Add team member") [U-2.5, U-6.6].
- Dates: "Friday, Nov 14" in headings, "Fri, Nov 14" in lists. Add the year only when it isn't this year. Times: "9:00 AM". Show a time zone only when it differs from the viewer's [U-5.4].
- Relative time under 7 days: "3 h", "2 d" in dense lists; "2 days ago" in sentences. Waiting times over 7 days turn danger-colored in staff queues.
- Numbers use tabular figures. Never show internal IDs, except "Submission #812" in staff views.
- No developer language: "URL-backed", "owned", "entity", "record", "evidence, not an automated verdict" [T-9].
- Page title (browser tab) = page name, then "· CSG Learn". The lesson editor's title is "Edit lesson", not "Staff home" [U-2.5].

## 3. Navigation model

The nav is one config per role ([`assets/shell.js`](assets/shell.js) is the prototype). Items with a `feature` key appear only when that feature is on for the viewer's cohort [C-3, S-5]. Try the switches in [`01-app-shell.html`](01-app-shell.html).

**Students** (sidebar on desktop; four tabs + More on phones)

| Item | Shown when | Phone |
| --- | --- | --- |
| Today | always | tab |
| Learn | always | tab |
| My work | always | tab |
| Messages | always (instructor DM; class chat when on) | tab |
| Updates | `updates` on | More |
| Recordings | `recordings` on and the cohort has at least one | More |
| Office hours | `office_hours` on | More |
| Course community | `community` on (self-paced, per course) | More |

A course switcher appears above the nav only when the learner has more than one enrollment; with one course it's hidden [S-5, U-5.8]. Switching goes to that course's Today, not `/cohorts/:id`.

**Instructors and admins**: seven items, the rest under More [T-7].

| Item | Icon | Notes |
| --- | --- | --- |
| Today | sun | Ranked inbox [U-4.4] |
| Cohorts | layers | |
| Students | users | |
| Grading | clipboard-check | Count of waiting work |
| Support | life-buoy | Help requests and follow-up plans; hidden if `help_requests` is off |
| Content | library | Admins edit; instructors see it if instructor authoring is approved (open question 1) |
| Messages | message-circle | |
| More: Updates, Recordings, Meetings, Office hours | | Feature-driven |
| More (admin only): Catalog, Team, Safety, School settings | | |

Phone tabs for staff: Today, Grading, Support, Messages, More. Each item has its own icon; nothing is reused [T-7].

**No global cohort switcher for staff.** Each list page shows its own scope in the page header ("Showing: All cohorts ▾"). Visiting a cohort never changes another page's filter [U-4.3, U-3.7].

**Logo and unknown routes:** the logo goes to Today when signed in. Unknown routes show a "Page not found" with a link to Today, not the landing page [S-13].

**Feature switches** [C-7, Decision 4]: School settings set defaults; a cohort's Settings tab can override any switch, and the school row shows "Overridden in 2 cohorts" with links. Turning a feature off removes its nav item, Today card, help action, empty page and search results. Defaults match what CSG runs today.

## 4. Patterns

All patterns are in [`assets/mock.css`](assets/mock.css) with the same class names used in the mockups.

### 4.1 Page header [U-6.3, T-8]

For list and hub pages (Today, Grading, Content, Students).

- **Title** (h1, 26px desktop / 22px phone) and a **context line** under it: scope, date, or a count ("Friday, Nov 14 · 14 things need you").
- **Actions on the right**, in this order: scope control, filters, then the primary action. Refresh is not a button; data refreshes on focus and after actions. If manual refresh stays, it lives in the ⋯ menu on every page.
- **Scope control** is always visible when a page can be filtered by cohort: "Showing: **All cohorts** ▾". When filtered it turns tinted, so a filtered page never looks unfiltered.
- On phones the actions wrap to a full-width row under the title.

### 4.2 Record header [L-0.3, plan §5.2]

For pages about one thing (submission, student, help request, lesson, cohort, curriculum).

```
[‹ Back to Grading · Redo]   Cohort 3 › Alex Rivera › Make Decisions with JavaScript      3 of 9  ˄ ˅
SUBMISSION #812 · ATTEMPT 1
Make Decisions with JavaScript   [Waiting 2 days]
Alex Rivera · Exercise: Ticket prices · submitted Wed, Nov 12        [Copy link] [Message] [⋯]
```

- **Back link label comes from where you came from**, passed as `return_to` with a label: "Back to Today", "Back to Grading · Redo", "Back to Cohort 3". With no history it falls back to the parent ("Back to Students"). Never `navigate(-1)` [L-2.4, L-2.5].
- **Breadcrumb**: staff `Cohort › Student › Record`; learners `Cohort › Learn › Module › Week`. Hidden on phones (the back link carries it).
- **Type line** (uppercase 12px): record type plus identity ("Submission #812 · attempt 1", "Cohort · Self-paced").
- **Title and status badge** on one line.
- **Queue position** when opened from a queue: "3 of 9" with previous/next [L-0.7].
- **Actions**: at most three visible (role-aware), the rest under ⋯. **Copy link** is always available, as a button or in ⋯.

### 4.3 Related panel [L-0.4]

A card on the right of record pages (below the content on phones). Each row: icon, label, count or short value, and it links to a focused list that keeps context (cohort, student, lesson). Rows with zero still show, with a quiet "0" count, so staff know the relationship exists. Content per record:

| Record | Related rows |
| --- | --- |
| Submission | Lesson (Edit for admins), week grid, other attempts, help on this exercise, all submissions for this lesson, student profile |
| Student (enrollment) | Cohort, help requests, follow-up plans, conversation, meetings, other enrollments |
| Help request | Lesson, follow-up plan created from it, conversation, other requests from this student |
| Follow-up plan | Evidence (linked), help request, conversation, next steps |
| Lesson (staff) | Used in (cohorts with release dates), submissions, open help, recordings |
| Curriculum | Used in cohorts, waiting submissions, learner files |

### 4.4 Record link [L-0.2]

Every mention of a record renders `<RecordLink>`: a real `<a>` (so ⌘-click and new tab work) that passes the current page as `return_to`.

- **Style:** ink-colored, weight 650, a thin underline in `line-strong` that becomes the full text color on hover and focus. In dense rows and context lines use the `plain` variant (no underline until hover) so lists don't look striped.
- **Fallback:** if the viewer can't open the record, render plain text, never a dead link.
- **Rows:** when a whole row links to the next action (Grade, Reply), the names inside it are still separate links to their own records [L-2.7].
- Add a lint or test that flags record names rendered as bare text on staff and student pages.

### 4.5 Peek card [L-0.5]

Desktop pointer only. Hovering or focusing a student, lesson or cohort link for **300ms** opens a 300px card with identity, four facts and two actions (for example Open profile, Message). Moving to the card keeps it open; leaving closes it after 150ms; once one is open, the next opens immediately. Escape closes it. On touch, a tap goes straight to the record. Backed by `GET /api/v1/records/:type/:id/summary` with permission checks. Try it on names in [`04-instructor-today.html`](04-instructor-today.html).

### 4.6 Lists, queues and inboxes

- Row height about 56–64px, at least 44px tap targets. One line of identity, one of context, a right-aligned status or waiting time.
- Primary row action as a visible button, not hover-only [U-1.4]. Secondary actions in ⋯.
- Selected row: `surface-selected` background plus a 3px primary bar on the left.
- Filters are chips with counts. Search filters the whole set first, then chips narrow it [U-5.3].
- List and detail screens (Grading, Content, Messages) are two panes on desktop and one pane at a time on phones, with "Back to …" in the detail.

### 4.7 Search (⌘K) [L-0.9, T-7]

- Opens with ⌘K / Ctrl+K or the sidebar search. No open or close animation (it's keyboard-driven).
- Results are grouped by type: Students, Lessons, Work (submissions, help requests), Cohorts, Recordings, Resources, Messages, Go to (every nav destination), Actions ("New cohort", "Post update").
- Each result shows its relationship context ("Web Development Bootcamp › JavaScript Foundations › Week 10, Mon") and inline actions on the selected row (Edit / Preview for lessons, Grade, Reply, Message).
- Role-aware: students search lessons, recordings, resources, messages and pages; the placeholder says so.
- Empty result: "No results for "…"", plus what search covers.

## 5. States

| State | Pattern |
| --- | --- |
| **Empty** | Icon tile, an h-level heading that says what isn't here yet, one sentence on what will appear and when, and one action if there is one. Full-page empty states use an h1 [S-16]. If a feature is off, there is no empty state because the page doesn't exist. |
| **Loading** | Skeleton rows that match the final layout, only while a request is in flight. After 10 seconds, switch to "Still loading…" with Retry. Never a skeleton for an outage. |
| **Error** | Inline notice in the place the content would be: what failed in plain words, Retry, and a way back. Never a blank page [B-4]. |
| **Validation** | The message sits next to the control that caused it, inside the pinned area if there is one, and never above the viewport [U-0.4]. |
| **No access** | "You don't have access to this page" with who to ask and a link to Today. Never a silent redirect [L-0.10]. |
| **Paused / ended** | Say the state, since when, that work is saved, and how to resume; keep past work readable [U-0.2]. |
| **Unsaved changes** | Save state in the sticky bar ("Unsaved changes" → "Saving…" → "Saved · just now"). Leaving with unsaved edits asks: Keep editing / Discard / Save and leave [U-0.6]. |
| **Success** | One inline confirmation at the place of the action, plus the next step. A toast only when the result isn't visible on screen [U-5.7]. |

## 6. Motion [U-6.2]

Durations and easings follow the `emil-design-eng` guidance, choosing the quieter option on operational screens. Tokens live in `tokens.css`: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`, `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`.

| Interaction | Duration | Easing | What moves | Reduced motion |
| --- | --- | --- | --- | --- |
| Button press | 120ms | ease-out | `scale(0.97)` | none |
| Hover, color change | 150ms | ease | color, background | same (color only) |
| Accordion expand/collapse | 200ms | `--ease-out` | `grid-template-rows: 0fr → 1fr`; chevron rotates 90° | instant |
| Tab change | indicator 220ms, panel 160ms | `--ease-out` | indicator slides (transform + width); new panel fades in from 4px below | indicator jumps, panel appears |
| List insert (new row, sent message) | 200ms | `--ease-out` | opacity, `translateY(-4px)` | appears |
| Jump to a new or linked item | scroll + 1600ms tint | ease-out | item scrolls into view; primary-soft tint fades out | instant scroll; tint shown 2s, then removed |
| Page change | 160ms | `--ease-out` | main content fades in; no exit animation, nav doesn't move | none |
| Drawer / bottom sheet | enter 240ms, exit 180ms | `--ease-drawer` | translate from the edge; scrim fades | fade only |
| Modal | 200ms | `--ease-out` | opacity + `scale(0.97)`, centered | fade only |
| Popover / menu | 150ms | `--ease-out` | opacity + `scale(0.96)` from the trigger's corner | fade only |
| Toast | enter 240ms, exit 180ms | `--ease-out` | from 8px below; auto-dismiss after 4s (6s with an action), paused on hover/focus; at most 3 | fade only |
| Peek card | 300ms delay, 150ms | `--ease-out` | opacity + 4px | fade only |
| Milestone (course complete) | 600ms, once | `--ease-out` | ring scales from 0.9 | none |
| Skeleton shimmer | 1.4s loop | linear | background position | static |

The mockups show enter animations; exit animations are specified here and built with the components.

**Never animate:** search open/close, keyboard list navigation, grading "Save and next" (swap instantly and scroll to the top), opening a conversation (start at the latest message, no smooth scroll). Only `transform` and `opacity` animate, plus the accordion's `grid-template-rows`. No transition delays input or navigation.

## 7. Theme tokens [U-6.1]

### Light and dark values

Semantic roles only. Components never use raw palette classes (`bg-white`, `text-slate-600`, `#1e1e1e`) for surfaces, text or borders. Ratios are WCAG 2 contrast, computed from the values in `tokens.css`.

| Role | Light | Dark | Contrast (light / dark) |
| --- | --- | --- | --- |
| `surface-page` | `#f8f7f4` | `#0c0f14` | |
| `surface-raised` (cards) | `#ffffff` | `#151a22` | |
| `surface-sunken` (wells, chips) | `#f3f2ee` | `#10141a` | |
| `surface-overlay` (menus, sheets) | `#ffffff` | `#1b212b` | |
| `surface-hover` | `#f1f0ec` | `#1c222c` | |
| `surface-selected` | `#fbf4f4` | `#2a1a1c` | ink-secondary on it 6.98 / 8.77 |
| `ink` | `#0f172a` | `#e8ecf2` | on page 16.66 / 16.19 |
| `ink-secondary` | `#475569` | `#b4bdca` | on raised 7.58 / 9.21 |
| `ink-muted` | `#5f6b7f` | `#8d98aa` | on raised 5.39 / 5.99; on sunken 4.81 / 6.34 |
| `ink-disabled` | `#94a3b8` | `#5b6575` | decorative only |
| `line` (dividers) | `#e2e8f0` | `#262d38` | decorative |
| `line-strong` | `#cbd5e1` | `#364152` | decorative |
| `line-control` (input borders) | `#7d889b` | `#66728a` | on raised 3.58 / 3.61 (non-text 3:1) |
| `primary` (solid fill) | `#9c292b` | `#b23e40` | white text 7.59 / 5.74 |
| `primary-hover` | `#842225` | `#c24b4d` | white text 9.39 / 4.76 |
| `primary-ink` (ruby text, icons) | `#9c292b` | `#ec9496` | on raised 7.59 / 7.68 |
| `primary-soft` / `-soft-ink` | `#fbf4f4` / `#842225` | `#2a1a1c` / `#f4b9ba` | 8.65 / 9.89 |
| `success-ink` / `-soft` | `#15803d` / `#f0fdf4` | `#5fd38d` / `#0f2419` | 4.79 / 8.70 |
| `warning-ink` / `-soft` | `#92400e` / `#fffbeb` | `#f5c04a` / `#2a2008` | 6.84 / 9.57 |
| `danger-ink` / `-soft` | `#b91c1c` / `#fef2f2` | `#f88a8a` / `#2c1214` | 5.91 / 7.47 |
| `info-ink` / `-soft` | `#075985` / `#f0f9ff` | `#7dd3fc` / `#0b2230` | 7.09 / 9.80 |
| `focus` (ring) | `#1d4ed8` | `#6ea8ff` | on raised 6.70 / 7.24 |
| `code-bg` / `code-ink` | `#f6f7f9` / `#1e293b` | `#0f141b` / `#dbe2ea` | 13.65 / 14.15 |
| `code-inline-bg` | `#eef1f5` | `#1f2630` | ink on it 15.76 / 12.85 |
| Syntax: keyword, string, number, function, comment, type | see `tokens.css` | see `tokens.css` | all ≥ 5.0 on `code-bg` in both themes |

Notes:

- Ruby stays the brand and primary action; red (`danger`) is only for errors and destructive actions, as today.
- In dark mode the solid primary lightens one step (`#b23e40`) so it doesn't sink into the background; ruby used as text uses `#ec9496`.
- The focus ring is blue in both themes, distinct from brand and danger.
- Dark surfaces use borders, not shadows, to separate layers.
- `ink-muted` on `surface-sunken` in light is 4.81:1, which passes AA but is the tightest pair. Don't put muted text on sunken wells smaller than 13px.

### Mapping onto Tailwind v4

Keep today's utility names (`bg-surface-raised`, `text-ink`, `border-line`) so existing screens keep working, and point them at variables that flip per theme:

```css
/* web/src/index.css */
@theme inline {
  --color-surface-page: var(--csg-surface-page);
  --color-surface-raised: var(--csg-surface-raised);
  --color-ink: var(--csg-ink);
  --color-ink-muted: var(--csg-ink-muted);
  --color-line: var(--csg-line);
  --color-action-primary: var(--csg-primary);
  --color-primary-ink: var(--csg-primary-ink);
  --color-focus: var(--csg-focus);
  /* …one line per role in tokens.css */
}

:root { color-scheme: light; --csg-surface-page: #f8f7f4; /* … */ }
:root[data-theme="dark"] { color-scheme: dark; --csg-surface-page: #0c0f14; /* … */ }

/* For the rare component that needs a different rule in dark */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```

- **Theme choice:** store `light | dark | system` on the user's profile (and in local storage for the first paint). A small inline script in `index.html` resolves "system" with `matchMedia('(prefers-color-scheme: dark)')`, sets `data-theme` on `<html>` before the bundle loads, and listens for OS changes. The mockups use the CSS-only fallback (`@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`); keep it in the app for no-JS first paint.
- **Browser chrome:** update `meta[name="theme-color"]` per theme (`#ffffff` light, `#151a22` dark) alongside the existing surface logic in `lib/brand.ts`.
- **Where to choose:** Profile › Appearance, the account menu, and the phone More sheet (all three in the mockups).
- **Migration:** `tokens.test.ts` grows to check both themes; add a lint that flags raw `slate-*`, `white`, hex colors and `primary-600` in components [S-17]. Mobile (Expo) gets the same roles in its theme file when W10 touches it.

## 8. Code blocks [U-6.4]

One `<CodeBlock>` component for lessons, messages, submissions, grading, feedback, help replies and updates. Today there are three styles (light lesson, navy messages, Monaco `#1e1e1e`) [U-5.7].

- **Container:** `code-bg`, 1px `code-line` border, 12px radius, no shadow.
- **Header (36px):** language or filename on the left, **Copy** on the right (announces "Copied" to screen readers). Single-line snippets in messages may drop the header and show Copy on hover/focus.
- **Code:** `ui-monospace, SF Mono, Menlo, Consolas` at 13.5px (14px in lessons), line height 1.6, padding 12px 14px, `white-space: pre`, **horizontal scroll, never wrapping mid-token** [U-5.7].
- **Line numbers:** on for submissions and grading; off elsewhere.
- **Syntax colors:** the `syntax-*` tokens. Recommendation: highlight.js core with JavaScript, TypeScript, Ruby, Python, Bash, HTML, CSS, SQL and JSON registered (small bundle, class-based output we can theme). Unlabeled fences render as plain code, never inline [S-12].
- **Inline code:** `code-inline-bg`, 1px border, 5px radius, 0.86em. Bold or italic around inline code keeps both marks [U-0.9, M-1].
- **Editing code on phones:** use a plain monospace textarea on touch devices; keep Monaco for desktop only after it's tested on a real iPhone [U-5.7].

## 9. Mockups and the backlog

| Mockup | Backlog IDs | Builds in |
| --- | --- | --- |
| [a. Content library](02-content-library.html) | U-1.1–U-1.9, L-3.1–L-3.3, B-1, B-2, U-3.2 | W5 PR 5.1, 5.2, 5.4 |
| [b. Block lesson editor](03-lesson-editor.html) | U-2.1–U-2.5, B-3, U-0.6, L-3.1, T-12 | W5 PR 5.3; W1 PR 1.6 (guard) |
| [c. Instructor Today](04-instructor-today.html) | U-4.4, U-4.3, U-4.6, U-4.7, U-3.4, L-2.7, L-0.5, T-6 | W7 PR 7.1, 7.2; W3 PR 3.6 |
| [d. Grading workbench](05-grading.html) | U-4.1, U-4.2, U-4.5, U-0.4, L-2.1, L-2.2, L-0.7, T-13 | W7 PR 7.3; W1 PR 1.4 |
| [e. Student profile (staff)](06-student-workspace.html) | U-4.8, L-2.6, T-3, T-10, U-0.5, L-0.3, L-0.4 | W7 PR 7.5; W3 PR 3.2 |
| [f. Student Today](07-student-today.html) | U-5.1, U-5.2, U-5.5, U-0.2, L-1.2–L-1.4, L-1.6, L-1.9, S-11, U-6.7 | W8 PR 8.2; W1 PR 1.5 |
| [g. Learn](08-learn.html) | U-5.6, U-5.3, U-5.10, S-1, S-9, C-2, L-0.6, L-1.10 | W8 PR 8.1, 8.4 |
| [h. Lesson page](09-lesson.html) | U-5.7, B-6, S-6, S-8, S-14, C-4, L-1.7, AS-8 | W8 PR 8.3; W9 PR 9.7 |
| [i. Self-paced first run](10-first-run.html) | U-5.4, S-3, S-5, U-5.5, S-8 | W8 PR 8.4; W6 PR 6.3 |
| [j. My work](11-my-work.html) | L-1.2, U-5.2, L-1.1, L-1.8 | W8 PR 8.2 |
| [k. Messages and composer](12-messages.html) | M-3, M-4, M-6, U-4.11, U-0.9, L-1.8, L-2.8, A-3 | W2 PR 2.3, 2.4, 2.6, 2.8 |
| [l. Self-paced setup wizard](13-setup-wizard.html) | U-3.1, U-3.2, T-5, L-3.4, S-2, U-0.11 | W6 PR 6.2, 6.3 |
| [m. App shell, nav and search](01-app-shell.html) | T-7, C-3, C-7, S-5, S-13, L-0.9, U-4.3, L-2.9, U-0.8 | W3 PR 3.7; W4 PR 4.1 |
| This README | S-4, U-6.1–U-6.6, C-5 (naming), L-0.2–L-0.5, T-8, T-9 | W3 PR 3.2, 3.8, 3.10 |

Personas in the mockups are synthetic, matching the audit harness: Alex Rivera (program, on track), Blair Cruz (behind), Casey Lim (paused), Dana Kim (self-paced, mid-course), Eli Santos (new self-paced), CSG Alumni library; staff Leon Shimizu (admin) and Audreana (instructor). Lesson titles come from the real curriculum.

**Not designed here** (on purpose): the public landing page and catalog course pages [S-2, S-18], the updates composer [U-3.6], the learning-plan editor [U-4.9], Team and Safety pages (already clean), and the native mobile app screens. Native screens follow these patterns and tokens when W10 lands.

## 10. Verification of these mockups (2026-11-14)

- All 25 mockup states and the review hub loaded in a browser at 1280px and 390px frames, light and dark: no horizontal overflow inside the frame, no missing icons. Fixed during the pass: a grid item that overflowed at 390px, an icon name missing from Lucide 0.469, a class clash that stretched the phone Send button, and search not being added to any shell.
- Interactions exercised in the browser: Enter sends and Shift+Enter doesn't; turning the setting off makes Enter a new line and ⌘/Ctrl+Enter send; bold around inline code renders as bold code; ⌘K opens, filters ("loops" returns the lesson and the help request), shows an empty state and closes on Escape; feature switches remove nav items; library search finds a curriculum by a lesson title; Learn's "Needs redo" filter; the grading Redo validation message appears in the pinned footer; the lesson editor's unsaved-changes guard.
- Contrast: computed for every token pair above (script output in the PR). Not tested: real phone keyboards, screen readers, and reduced-motion playback on a device.

## 11. Open questions for Leon

1. **Instructor authoring [T-12].** Should instructors edit lessons, or only admins? The mockups show Content in the instructor nav; if admin-only, instructors get a read-only Content view or no nav item.
2. **Redo and rubrics [U-0.4].** The grading mockup requires every rubric criterion to be rated before Redo. Keep that, or allow Redo with feedback alone?
3. **"Today" for staff.** The backlog's T-7 list says "Home"; this spec uses **Today** for every role so there's one word. OK?
4. **Catch-up plan [U-5.1].** Should the "2-week path back" be generated automatically (as mocked, required lessons only), or set by the instructor, or both (automatic with an instructor override)?
5. **Review time promise.** Learners see "usually within 2 days". Is 2 days right for live programs and self-paced, and should it be a per-cohort setting (the wizard has it)?
6. **Public pages in dark mode.** Recommendation: the signed-in app gets dark mode in W3 PR 3.10; public and sign-in pages (cream, Newsreader) follow in a later PR. Or should they ship together?
7. **Paused learners.** The mockup keeps past lessons and feedback readable while paused. Confirm that's the policy.
8. **Course completion [AS-8].** Is a downloadable certificate in scope, and is it issued on finishing lessons or after the final project is graded?

To review: work through the checklist in `index.html`, then reply with changes or "approved".
