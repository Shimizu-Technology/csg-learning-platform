# CSG Learning Platform — Frontend

React 19 + TypeScript + Tailwind v4 + Vite SPA for the CSG Learning Platform.

## Setup

```bash
cd ..
nvm use                      # uses .nvmrc from repo root
cd web
cp .env.example .env       # Configure API URL and required Clerk key
npm install
npm run dev                 # http://localhost:5173
```

Use `npm run lint` or `npx eslint .` for linting. Do not use a global `eslint` binary, because an older global install can bypass the repo's local ESLint 9 toolchain.

### Auth in Development

Local development still uses Clerk authentication. There is no supported auth-bypass mode in this repo anymore, so keep `VITE_CLERK_PUBLISHABLE_KEY` set in `.env`.

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `VITE_API_URL` | Yes | `http://localhost:3000` | Backend API base URL |
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | — | Clerk publishable key for local and deployed environments |
| `VITE_PUBLIC_POSTHOG_KEY` | No | — | PostHog analytics project key |
| `VITE_PUBLIC_POSTHOG_HOST` | No | — | PostHog ingest endpoint |

## Routes

### Student Routes (Authenticated)

| Path | Component | Purpose |
|------|-----------|---------|
| `/dashboard` | `Dashboard` | Student home — shared This Week plan, progress, modules, and next actions |
| `/modules/:id` | `ModuleView` | Module detail — lessons grouped by week/day |
| `/lessons/:id` | `LessonView` | Lesson content — videos, text, exercises |
| `/recordings` | `Recordings` | Cohort recordings library |
| `/resources` | `Resources` | Cohort resources and links |
| `/announcements` | `Announcements` | In-app announcement feed with read/unread state |
| `/announcements/:id` | `Announcements` | Announcement detail view |
| `/messages` | `Messages` | Cohort messaging workspace |
| `/messages/:channelId` | `Messages` | Specific cohort channel |
| `/messages/dm/:dmId` | `Messages` | Direct message conversation |
| `/profile` | `Profile` | Edit profile and GitHub username |

### Staff Routes (Instructor + Admin)

| Path | Component | Purpose |
|------|-----------|---------|
| `/admin` | `AdminDashboard` | Overview — cohort stats, student health, quick actions |
| `/admin/support` | `SupportQueue` | Direct contextual-help requests and explainable learning signals |
| `/admin/students` | `StudentManagement` | All students grouped by cohort with search/filter |
| `/admin/students/:id` | `StudentDetail` | Individual student progress and submissions |
| `/admin/cohorts` | `CohortManagement` | Cohort CRUD and settings |
| `/admin/cohorts/:id` | `CohortDetail` | Cohort detail — enrollments, modules, access control |
| `/admin/cohorts/:id/watch-progress` | `CohortWatchProgress` | Recording watch matrix for a cohort |
| `/admin/grading` | `Grading` | Grading queue across cohorts |
| `/admin/cohorts/:cohortId/modules/:moduleId/grading` | `CohortModuleGrading` | Per-module grading with GitHub sync |

### Admin-Only Routes

| Path | Component | Purpose |
|------|-----------|---------|
| `/admin/content` | `ContentManagement` | Curriculum → Module → Lesson → Block CRUD |
| `/admin/lessons/:id/edit` | `LessonEditor` | Rich lesson editor (WYSIWYG, Monaco, preview) |
| `/admin/team` | `TeamManagement` | User management — roles, invites, Clerk sync |

### Linking to records

Don't build record URLs by hand. `src/lib/routes.ts` has one registry:

- `recordPath(ref, { viewer, returnTo })` returns the page that opens a record for this viewer, or `null` when there is no page or the viewer can't open it. A lesson opens the editor for admins and `/lessons/:id?cohort_id=` for everyone else. `return_to` is added only where the destination reads it. `RECORD_ROUTES` lists each record type's pages and the query keys they accept.
- `<RecordLink record={{ type: 'student', id, cohortId }}>` (`src/components/shared/RecordLink.tsx`) renders a name as a real link, so ⌘/Ctrl-click and "open in new tab" work. It passes the current page as `return_to` and renders plain text when `recordPath` returns `null`. Use `variant="plain"` in dense rows; `touchTarget` for every link that stands alone (a heading, row title or context line; 44px on phones, compact from `sm` up), adding `truncate` when the name should cut off with an ellipsis; links inside a sentence stay inline. On a page with an unsaved editor that isn't covered by `UnsavedChangesGuard` (e.g. an inline submission review), pass `onClick={useLeaveGuard(...)}` (`src/lib/useLeaveGuard.ts`) so a plain click confirms first and ⌘/Ctrl-clicks still open a new tab.
- Learner pages use `learnerPaths(cohortId)` / `useLearnerPaths`, which keep staff in the learner view. Code that navigates programmatically uses `useRecordPath()`. Parent and sub-page links use the named helpers (`cohortPath`, `cohortStudentPath`, `cohortSettingsPath`, `conversationPath`, …).

`src/test/recordNames.test.ts` fails when a staff or student page renders a cohort, student, module or lesson name as plain text. The top of that file explains how to add an exception.

## Sidebar Navigation

The sidebar adapts based on user role:

- **Students**: Dashboard, Recordings, Resources, Announcements, Messages, Profile
- **Instructors**: Admin Dashboard, Cohorts, Grading, Announcements, Messages, Profile
- **Admins**: Admin Dashboard, Cohorts, Content, Grading, Team, Announcements, Messages, Profile

Sidebar collapse state persists in `localStorage`.

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `react` + `react-dom` 19 | UI framework |
| `react-router-dom` | Client-side routing |
| `@clerk/clerk-react` | Authentication provider |
| `@monaco-editor/react` | Code editor for solutions |
| `@tiptap/react` + `@tiptap/starter-kit` | Rich text editor surface |
| `react-markdown` | Markdown rendering for student content |
| `marked` | Markdown → HTML conversion |
| `dompurify` | HTML sanitization (XSS protection) |
| `@vimeo/player` | Legacy Vimeo video completion tracking |
| `lucide-react` | Icon library |
| `posthog-js` | Analytics |
| `tailwindcss` v4 | Styling |

## Build

```bash
npm run build               # Production build → dist/
npm run lint                # ESLint
npm run typecheck           # TypeScript only
npm run test                # Vitest unit tests
npm run check               # Lint + typecheck + unit tests + production build
npm run preview             # Preview production build locally
```

TypeScript is strict — `npx tsc --noEmit` should pass with zero errors before deploying.

## Design System

| Element | Value |
|---------|-------|
| Colors | Slate neutrals, ruby/red primary, green success |
| Corners | `rounded-2xl` cards, `rounded-lg` buttons |
| Font | System UI (default Tailwind) |
| Icons | Lucide React only — no emojis in UI |
| CSS | Tailwind v4 only — no CSS modules or styled-components |
