# CSG Learn platform redesign: design spec (W0 PR 0.3)

**Status:** review round 1 done, 2026-11-14. Leon approved the mockups with one addition, the two-mode editor (§9), and answered the open questions; they're recorded as decisions in §12. Nothing here is built. Waves W3, W5, W7 and W8 start from this spec once it merges.
**Source of truth for scope:** the audit backlog `Brain-Dump/code-school/csg-learn-platform-audit-2026-11-14.md` (sections U, L, S, T, M, AS, Decisions, Implementation plan) and its link matrices. Backlog IDs are cited in brackets throughout.
**Decisions this spec assumes (Leon, 2026-11-14):** light and dark mode with a Light / Dark / System choice; Enter-to-send is a per-user setting, on by default; self-paced work is reviewed by an instructor; features are switchable at school and cohort level, and the nav, Today, help and empty states are generated from what's on; course community for self-paced learners is a per-course option, off by default. Review round 1 added the decisions in §12.

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
| [`assets/md-editor.js`](assets/md-editor.js) | Mockup of the two-mode `MarkdownEditor` (§9): Rich, Markdown, Preview, typing rules, paste. Not production code |

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
| Editor modes | **Rich**, **Markdown**; **Preview** in Markdown mode | WYSIWYG, plain text mode, source, raw | Toggle label "Rich \| Markdown" [U-6.8, §9] |
| Instructor permission to edit lessons | **Editing access** | authoring rights, content admin | Given per cohort by an admin (§12, decision 1) |
| A cohort's own curriculum | **Make a copy for this cohort**; the result is "Cohort 3's copy" | fork, clone, duplicate curriculum | [T-12] |
| Proof of finishing a course | **Certificate** | diploma, badge | Issued after the final project is graded (§12, decision 8) [AS-8] |

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
| Content | library | Admins edit. Instructors see it read-only unless an admin gives them editing access for specific cohorts (§12, decision 1) |
| Messages | message-circle | |
| More: Updates, Recordings, Meetings, Office hours | | Feature-driven |
| More (admin only): Catalog, Team, Safety, School settings | | School settings holds "Content editing access" |

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
| **Paused / ended** | Say the state, since when, that work is saved, and how to resume. Past lessons and all feedback stay open read-only; submitting, new lessons and class chat are off (§12, decision 7) [U-0.2]. |
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
- **Public and sign-in pages** get dark mode in the same release as the app (§12, decision 6), not a later PR. The cream landing surfaces and Newsreader headings need dark equivalents in `tokens.css`; signed-out visitors follow their system setting, with the same Light / Dark / System choice in the public footer.
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
- **While writing:** in the Rich editor a code block is a plain monospace block with its language in the corner; the full `<CodeBlock>` (header, Copy, highlighting) appears in Markdown mode's Preview and wherever the text is read (§9).

## 9. Writing formatted text (two modes) [U-6.8, U-6.5]

Everywhere people write formatted text, they use one shared component, `MarkdownEditor`, with two modes: **Rich** and **Markdown**. Both modes edit the same stored Markdown. The mode only changes how the text looks while you write it, so switching never changes what gets saved or what readers see.

**Where it's used:** messages and class chat, updates (announcements), lesson Text blocks and exercise instructions, grading feedback and feedback snippets, help-request replies, text submissions, and learning-plan and follow-up-plan descriptions. Everything people read goes through the one Markdown renderer (U-6.5), so Markdown mode's Preview matches what readers see.

**Try it:** the composer in [`12-messages.html`](12-messages.html), the Text block and exercise instructions in [`03-lesson-editor.html`](03-lesson-editor.html), and the feedback box in [`05-grading.html`](05-grading.html). The mockup behavior is in [`assets/md-editor.js`](assets/md-editor.js) (mockup code, not production).

### 9.1 The two modes

| | Rich | Markdown |
| --- | --- | --- |
| What you see | Formatting as you type: bold, code, lists, code blocks | The Markdown itself, in a monospace font, with a **Preview** button |
| Toolbar buttons | Format the selection | Insert Markdown syntax around the selection |
| Typing `**bold**`, backticks, `- ` | Turns into formatting | Stays as typed |
| Good for | Most people, and phones | People who know Markdown, long code, syntax Rich can't show |

- **Default:** Rich for everyone.
- **Remembered per person:** the choice is saved to the profile (like Enter-to-send and the theme) and cached in local storage for the first paint. It applies to every editor the next time one opens. Switching one editor doesn't flip other editors already open on the same page.
- **Lossless:** Rich → Markdown → Rich returns the same Markdown for everything in the supported syntax (9.3). The only allowed differences are spelling normalizations that don't change meaning: `*` bullets become `-`, `*italic*` becomes `_italic_`, numbered lists count from 1. Round-trip tests cover every supported construct and the combinations that broke before, such as bold around inline code (U-0.9, M-1).
- **Drafts survive switching.** The draft, caret block and scroll position carry over; switching is never an edit and doesn't mark the page unsaved.

### 9.2 The toggle and Preview

- A compact segmented control labeled **Rich | Markdown** sits at the right end of the editor's toolbar. In the message composer the toolbar is the footer row, so the toggle sits just left of **Send**. Tooltips: "Rich: formatting as you type" and "Markdown: plain text with Preview".
- ⌘⇧M (Ctrl+Shift+M) switches modes from the keyboard.
- In Markdown mode a **Preview** button (eye icon) appears next to the toggle. It swaps the text box for the rendered result, read-only, with real code blocks (§8). Pressing it again goes back to editing at the same place. Formatting buttons are disabled while Preview is showing. In the composer, Preview is icon-only to save room, with "Preview" as its accessible name.

### 9.3 Supported syntax

Paragraphs and line breaks; **bold**, _italic_ and `inline code`, including bold or italic around inline code; fenced code blocks with an optional language; bulleted and numbered lists (one level); quotes; links; and `##` / `###` headings. The toolbar doesn't offer headings; they're mainly for lesson text and updates.

### 9.4 Toolbar, shortcuts and typing rules

| Action | Shortcut (Mac / Windows) | Typing rule in Rich mode |
| --- | --- | --- |
| Bold | ⌘B / Ctrl+B | `**text**` |
| Italic | ⌘I / Ctrl+I | `_text_` |
| Inline code | ⌘E / Ctrl+E | `` `text` `` |
| Code block | ⌘⇧C / Ctrl+Shift+C | ```` ``` ```` then Enter (```` ```js ```` sets the language) |
| Bulleted list | ⌘⇧8 / Ctrl+Shift+8 | `- ` or `* ` at the start of a line |
| Numbered list | ⌘⇧7 / Ctrl+Shift+7 | `1. ` at the start of a line |
| Quote | ⌘⇧9 / Ctrl+Shift+9 | `> ` at the start of a line |
| Link | ⌘⇧U / Ctrl+Shift+U | Paste a URL while text is selected |
| Heading | none | `## ` or `### ` at the start of a line |
| Switch mode | ⌘⇧M / Ctrl+Shift+M | |
| Paste as plain text | ⌘⇧V / Ctrl+Shift+V | |

- These follow Slack's shortcuts. Link uses ⌘⇧U because ⌘K is search (§4.7).
- Typing rules fire when the closing mark is typed. ⌘Z right after a conversion undoes the formatting and keeps the characters. Rules never fire inside inline code or code blocks.
- In Markdown mode the same shortcuts and buttons insert syntax: ⌘B wraps the selection in `**`, the list button prefixes each selected line with `- `, and so on.
- **Code blocks in Rich mode** show their language in the corner (click it to change). Enter adds a line, Enter on an empty last line leaves the block, and Tab indents two spaces. Esc then Tab moves focus out.
- A literal `*` or backtick typed in Rich mode is escaped when saved (`\*`), so it comes back exactly as typed instead of turning into formatting.

### 9.5 Paste

- **Rich mode, Markdown text:** plain text that looks like Markdown (`**`, backticks, fences, list markers, headings, links) is converted to formatting. A short note under the editor says "Pasted Markdown as formatting. ⌘Z undoes it; ⌘⇧V pastes plain text."
- **Rich mode, HTML** (from a web page or a doc): supported formatting is kept, everything else is cleaned out with DOMPurify. Tables or images that can't be shown follow 9.6; they never vanish silently.
- **Into a code block**, or with ⌘⇧V: always plain text.
- **Markdown mode:** always plain text.

### 9.6 Syntax Rich mode can't show

Nothing is silently dropped. When the stored Markdown has something Rich mode can't edit (a table, an image, raw HTML, a nested list, a checklist, a divider), Rich mode shows that part as a locked block of Markdown text (monospace, dashed warning border) and a warning under the toolbar:

> Rich mode can't edit a table. It's shown as Markdown text and saved unchanged. **[Edit in Markdown]**

The locked block is saved byte for byte and can be deleted as a whole. Readers still see whatever the renderer supports (GFM tables render on display, S-12). Anything the renderer can't show appears as plain text, never as a gap. Try it: in Markdown mode, type `| a | b |` on its own line, then switch to Rich.

### 9.7 Enter in the message composer

- The Enter-to-send setting (a per-user setting, on by default; see the decisions at the top) works the same in both modes. When it's on (the default), Enter sends, Shift+Enter adds a line, and ⌘/Ctrl+Enter also sends.
- **Enter adds a line instead of sending** when the caret is in a code block or a list item (Rich), or inside an open ```` ``` ```` fence, meaning an odd number of fence lines above the caret (Markdown). Enter on an empty list item ends the list.
- The hint under the composer always says what Enter will do and updates as the caret moves: "In a list or code block, Enter adds a line · ⌘ Enter sends".
- With the setting off, Enter adds a line everywhere and ⌘/Ctrl+Enter sends.
- Other editors (lesson text, feedback, replies) never submit on Enter; their own Save or Send button does.

### 9.8 Accessibility

- **Labels:** the Rich surface is `role="textbox"` with `aria-multiline="true"` and a label naming the field and mode ("Message, rich text"). Markdown mode is a real `<textarea>` labeled "Message, Markdown".
- **Toolbar:** `role="toolbar"` with a label, one Tab stop, arrow keys between buttons. Each button has a label, a tooltip with its shortcut, and `aria-keyshortcuts`. Bold, italic, code, list and quote buttons show `aria-pressed` for the text at the caret.
- **Mode toggle:** a group labeled "Editor mode" with two pressed-state buttons. Switching keeps focus in the editor, in the same block, and a polite live region announces "Markdown mode. Same text, shown as Markdown."
- **Preview** is a pressed-state button. The preview region is labeled ("Preview of message") and focusable, and showing or hiding it is announced.
- Warnings use `role="status"`. Paste conversions are announced politely.
- **Focus:** one visible focus ring on the editor container (the `focus` token) and on every toolbar button. Tab always leaves the editor except inside a Rich code block, where Esc then Tab leaves.
- **Contrast and motion:** existing tokens only; the locked Markdown block uses `warning-soft` with `ink` text. Only the phone format menu animates (popover fade, §6).

### 9.9 Phones

- At phone width the toolbar folds into an **Aa** button. It opens a format menu with the formatting buttons (44px targets) and the **Rich | Markdown** toggle under an "Editor" label. The menu opens above or below the editor, wherever there's room, and closes on Escape or a tap outside. Preview stays in the toolbar in Markdown mode.
- In the composer the footer keeps Attach, Aa, formatting help and Send; the composer stays pinned above the keyboard.
- Text is 16px in both modes so iOS doesn't zoom. The Markdown text box turns off autocorrect and smart punctuation so syntax isn't rewritten; Rich mode leaves them on.

### 9.10 Building it

- **Component:** `MarkdownEditor` in `web/src/components/editor/`, used by every place in the list above. Its value is the Markdown string; nothing else is stored.

```tsx
<MarkdownEditor
  value={markdown}
  onChange={setMarkdown}
  label="Message to Alex"
  placeholder="Message Alex"
  variant="composer"        // "composer": toolbar in the footer, Enter-to-send rules; "field": toolbar on top
  onSubmit={send}           // composer only
  maxHeight={220}
  readOnly={false}
/>
```

- **Mode preference:** a `useEditorMode()` hook backed by `editor_mode: "rich" | "markdown"` on the user's profile.
- **Rendering:** Preview and every display surface use one `renderMarkdown()` (U-6.5) that outputs `<CodeBlock>` (§8) for fences.
- **Rich engine (recommendation):** TipTap (ProseMirror) with a Markdown serializer limited to the supported syntax, plus a "raw" node for 9.6. Pick it in W2 PR 2.2 after a real-iPhone check.
- **Tests:** a fixture list of Markdown strings that must round-trip unchanged (after the 9.1 normalizations), typing-rule and paste cases, and the Enter rules for both modes.

## 10. Mockups and the backlog

| Mockup | Backlog IDs | Builds in |
| --- | --- | --- |
| [a. Content library](02-content-library.html) | U-1.1–U-1.9, L-3.1–L-3.3, B-1, B-2, U-3.2 | W5 PR 5.1, 5.2, 5.4 |
| [b. Block lesson editor](03-lesson-editor.html) | U-2.1–U-2.5, B-3, U-0.6, L-3.1, T-12, U-6.8 | W5 PR 5.3; W1 PR 1.6 (guard) |
| [c. Instructor Today](04-instructor-today.html) | U-4.4, U-4.3, U-4.6, U-4.7, U-3.4, L-2.7, L-0.5, T-6 | W7 PR 7.1, 7.2; W3 PR 3.6 |
| [d. Grading workbench](05-grading.html) | U-4.1, U-4.2, U-4.5, U-0.4, L-2.1, L-2.2, L-0.7, T-13, U-6.8 | W7 PR 7.3; W1 PR 1.4 |
| [e. Student profile (staff)](06-student-workspace.html) | U-4.8, L-2.6, T-3, T-10, U-0.5, L-0.3, L-0.4 | W7 PR 7.5; W3 PR 3.2 |
| [f. Student Today](07-student-today.html) | U-5.1, U-5.2, U-5.5, U-0.2, L-1.2–L-1.4, L-1.6, L-1.9, S-11, U-6.7 | W8 PR 8.2; W1 PR 1.5 |
| [g. Learn](08-learn.html) | U-5.6, U-5.3, U-5.10, S-1, S-9, C-2, L-0.6, L-1.10 | W8 PR 8.1, 8.4 |
| [h. Lesson page](09-lesson.html) | U-5.7, B-6, S-6, S-8, S-14, C-4, L-1.7, AS-8 | W8 PR 8.3; W9 PR 9.7 |
| [i. Self-paced first run](10-first-run.html) | U-5.4, S-3, S-5, U-5.5, S-8 | W8 PR 8.4; W6 PR 6.3 |
| [j. My work](11-my-work.html) | L-1.2, U-5.2, L-1.1, L-1.8 | W8 PR 8.2 |
| [k. Messages and composer](12-messages.html) | M-3, M-4, M-6, U-4.11, U-0.9, L-1.8, L-2.8, A-3, U-6.8 | W2 PR 2.3, 2.4, 2.6, 2.8 |
| [l. Self-paced setup wizard](13-setup-wizard.html) | U-3.1, U-3.2, T-5, L-3.4, S-2, U-0.11 | W6 PR 6.2, 6.3 |
| [m. App shell, nav and search](01-app-shell.html) | T-7, C-3, C-7, S-5, S-13, L-0.9, U-4.3, L-2.9, U-0.8, T-12 (editing access) | W3 PR 3.7; W4 PR 4.1 |
| Two-mode editor, §9 (in b, d, k) | **U-6.8**, U-6.5, M-1, U-0.9 | W2 PR 2.2 |
| This README | S-4, U-6.1–U-6.6, U-6.8, C-5 (naming), L-0.2–L-0.5, T-8, T-9 | W3 PR 3.2, 3.8, 3.10; W2 PR 2.2 (§9) |

Personas in the mockups are synthetic, matching the audit harness: Alex Rivera (program, on track), Blair Cruz (behind), Casey Lim (paused), Dana Kim (self-paced, mid-course), Eli Santos (new self-paced), CSG Alumni library; staff Leon Shimizu (admin) and Audreana (instructor). Lesson titles come from the real curriculum.

**Not designed here** (on purpose): the public landing page and catalog course pages [S-2, S-18], the updates composer [U-3.6] and the learning-plan editor [U-4.9] (both use `MarkdownEditor` from §9 for their text), Team and Safety pages (already clean), and the native mobile app screens. Native screens follow these patterns and tokens when W10 lands.

## 11. Verification of these mockups

**Round 0 (first draft, 2026-11-14)**

- All 25 mockup states and the review hub loaded in a browser at 1280px and 390px frames, light and dark: no horizontal overflow inside the frame, no missing icons. Fixed during the pass: a grid item that overflowed at 390px, an icon name missing from Lucide 0.469, a class clash that stretched the phone Send button, and search not being added to any shell.
- Interactions exercised in the browser: Enter sends and Shift+Enter doesn't; turning the setting off makes Enter a new line and ⌘/Ctrl+Enter send; bold around inline code renders as bold code; ⌘K opens, filters ("loops" returns the lesson and the help request), shows an empty state and closes on Escape; feature switches remove nav items; library search finds a curriculum by a lesson title; Learn's "Needs redo" filter; the grading Redo validation message appears in the pinned footer; the lesson editor's unsaved-changes guard.
- Contrast: computed for every token pair above (script output in the PR). Not tested: real phone keyboards, screen readers, and reduced-motion playback on a device.

**Round 1 (review changes, 2026-11-14)**

- Checked in a browser: the changed mockups (01 Admin and Instructor, 03 both variants, 05, 07 Behind and Paused, 09 Course complete and Certificate issued, 12 both views) and the hub, at 1280px and 390px frames in light and dark. That's 48 combinations, with no horizontal overflow inside the frame and no missing icons.
- Round trip: in all five editors (composer, Text block, exercise instructions, new Text block, feedback), Rich → Markdown → Rich returned the starting Markdown unchanged, including bold around inline code, a fenced block and a list.
- Interactions exercised: the mode choice persists across reloads and pages. Typing rules worked with real key presses (backticks, `**bold**`, `- ` at a line start, ```` ``` ```` then Enter, leaving a code block with Enter on an empty last line). Markdown paste in Rich mode converted with the undo note. A table typed in Markdown mode showed the locked block and warning in Rich, and saved unchanged. Markdown mode's Preview rendered real code blocks. In the composer, Enter inside an open fence added a line, the hint changed, and Enter at the end sent the message with the shared code block. Grading: Redo with empty feedback showed the new message, snippets inserted into the editor, and drafts were kept per submission. The lesson editor's instructor variant stayed read-only until "Make a copy for Cohort 3". The editing-access popover saved.
- Fixed during the pass: the composer's Send button overflowed by 8px in Markdown mode with Preview on (Preview is now icon-only there). The `- ` rule hit the list above instead of the empty line. The phone Aa menu ran off the bottom of the grading footer (it now opens upward when there's no room). Opening a submission wiped its feedback draft. The editing-access popover covered its own button on phones.
- Specified but not in the mockups: ⌘Z undoing a typing-rule conversion, pasting a URL over selected text to make a link, the language picker on code blocks, arrow-key navigation inside the toolbar, escaping literal `*` and backticks typed in Rich mode, and closing the Aa menu on an outside tap. Not tested: real phone keyboards, screen readers, IME composition.

## 12. Decisions from review round 1 (Leon, 2026-11-14)

Leon approved the mockups overall and added one thing: the two-mode editor in §9 (U-6.8). His answers to the eight open questions are below. Two details marked *proposed* are this spec's reading of an answer; change them in review if they're wrong.

1. **Lesson editing is admin-only by default [T-12].** An admin can give a specific instructor editing access to specific cohorts' content, in School settings › Content editing access ([`01-app-shell.html`](01-app-shell.html), Admin variant). Lessons live in a curriculum that several cohorts can share, so the editor shows a notice when other cohorts use it and offers **Make a copy for this cohort** ([`03-lesson-editor.html`](03-lesson-editor.html)). The copy keeps that cohort's progress, submissions and release dates; later changes to the shared version don't reach it. Admins can still edit the shared version directly. Instructors without access see Content read-only, with Preview and View as student.
   - *Proposed:* an instructor whose access doesn't cover every cohort sharing a curriculum sees it read-only until they make a copy for their cohort (03, "Instructor · Cohort 3 access" variant).
2. **Redo needs written feedback; rubric ratings are optional [U-0.4].** Grades stay A, B, C and Redo. A per-cohort setting, **Require rubric ratings for Redo** (off by default), adds the rating requirement back. The error reads "Write feedback before choosing Redo, so the student knows what to change." ([`05-grading.html`](05-grading.html)).
3. **Every role's home is Today.** The backlog's "Home" in T-7 becomes Today.
4. **Catch-up plan [U-5.1].** The app suggests a plan from the required work left and a target date, the instructor can adjust it, and the student sees the agreed version: target date, who agreed it and when, and "Ask Audreana to change it" ([`07-student-today.html`](07-student-today.html), Behind variant).
   - *Proposed:* until an instructor agrees a plan, the student sees how far behind they are and the next required lesson, with "Ask Audreana for a plan", not the unreviewed suggestion.
5. **Review promise:** "usually reviewed within 2 days" is the default. Schools set their own default and each cohort can override it (the wizard's "Typical response time" field, [`13-setup-wizard.html`](13-setup-wizard.html)). Learners see it everywhere they wait: after submitting, in My work and on Today.
6. **Dark mode ships for public and sign-in pages too**, in the same release as the app (§7).
7. **Paused learners keep read-only access** to past lessons and all their feedback. Submitting, new lessons and class chat are off until they resume ([`07-student-today.html`](07-student-today.html), Paused variant).
8. **Certificates: yes [AS-8],** issued after the final project is graded, not when the last lesson is marked complete. The course-complete screen shows the certificate as pending with who is reviewing; the "Certificate issued" variant shows the download ([`09-lesson.html`](09-lesson.html)).

To review this round: try the Rich | Markdown switch in Messages, the lesson editor and grading, check the decisions above, then reply with changes or "approved".
