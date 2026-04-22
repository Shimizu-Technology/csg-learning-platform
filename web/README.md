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
| `/` | `Dashboard` | Student home — progress, modules, next actions |
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
npm run check               # Lint + typecheck + production build
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
