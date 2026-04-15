# CSG Learning Platform — Frontend

React 19 + TypeScript + Tailwind v4 + Vite SPA for the CSG Learning Platform.

## Setup

```bash
cp .env.example .env       # Configure API URL and optional Clerk key
npm install
npm run dev                 # http://localhost:5173
```

### Dev Without Auth

Omit `VITE_CLERK_PUBLISHABLE_KEY` from `.env` to run without Clerk authentication. All routes become accessible without login — useful for UI development.

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `VITE_API_URL` | Yes | `http://localhost:3000` | Backend API base URL |
| `VITE_CLERK_PUBLISHABLE_KEY` | No | — | Clerk auth (omit for dev without auth) |
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
| `/profile` | `Profile` | Edit profile and GitHub username |

### Staff Routes (Instructor + Admin)

| Path | Component | Purpose |
|------|-----------|---------|
| `/admin` | `AdminDashboard` | Overview — cohort stats, student health, quick actions |
| `/admin/students` | `StudentManagement` | All students grouped by cohort with search/filter |
| `/admin/students/:id` | `StudentDetail` | Individual student progress and submissions |
| `/admin/cohorts` | `CohortManagement` | Cohort CRUD and settings |
| `/admin/cohorts/:id` | `CohortDetail` | Cohort detail — enrollments, modules, access control |
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

- **Students**: Dashboard, Recordings, Resources, Profile
- **Instructors**: Admin Dashboard, Cohorts, Grading, Profile
- **Admins**: Admin Dashboard, Cohorts, Content, Grading, Team, Profile

Sidebar collapse state persists in `localStorage`.

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `react` + `react-dom` 19 | UI framework |
| `react-router-dom` | Client-side routing |
| `@clerk/clerk-react` | Authentication provider |
| `@monaco-editor/react` | Code editor for solutions |
| `react-quill-new` | WYSIWYG rich text editor |
| `react-markdown` | Markdown rendering for student content |
| `marked` | Markdown → HTML conversion |
| `dompurify` | HTML sanitization (XSS protection) |
| `@vimeo/player` | Vimeo video completion tracking |
| `lucide-react` | Icon library |
| `posthog-js` | Analytics |
| `tailwindcss` v4 | Styling |

## Build

```bash
npm run build               # Production build → dist/
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
