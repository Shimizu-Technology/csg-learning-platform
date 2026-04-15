# CSG Learning Platform

The all-in-one learning hub for Code School of Guam — prework, live class, workshops, recordings, grading, progress tracking, and cohort management.

## Architecture

| Layer | Tech | Details |
|-------|------|---------|
| Frontend | React 19 + TypeScript + Tailwind v4 + Vite | SPA with role-based routing |
| Backend | Rails 8.1 API-only | RESTful JSON API under `/api/v1/` |
| Auth | Clerk | Invite-only, JWT-based, role-based (student / instructor / admin) |
| Database | PostgreSQL | Neon (production), local Postgres (development) |
| Frontend Hosting | Netlify | `learn.codeschoolofguam.com` |
| API Hosting | Render (Singapore) | `learn-api.codeschoolofguam.com` |
| Analytics | PostHog | Page views, feature flags, session replay |

## Monorepo Structure

```
csg-learning-platform/
├── api/            Rails 8.1 API backend
├── web/            React + Vite frontend
├── docs/           Product vision, roadmap, deployment guides
├── scripts/        Data import and utility scripts
└── AGENTS.md       AI/developer conventions
```

## Quick Start

### Prerequisites

- Ruby 3.3+ and Bundler
- Node.js 20+ and npm
- PostgreSQL 16+

### Backend Setup

```bash
cd api
cp .env.example .env        # Edit with your Clerk + DB credentials
bundle install
rails db:create db:migrate db:seed
rails server -p 3000
```

### Frontend Setup

```bash
cd web
cp .env.example .env        # Edit with API URL + Clerk key
npm install
npm run dev                  # Starts on http://localhost:5173
```

### Running Tests

```bash
cd api
bundle exec rails test       # Runs integration + unit tests
```

## Environment Variables

See [`api/.env.example`](api/.env.example) and [`web/.env.example`](web/.env.example) for all required and optional variables. Key ones:

| Variable | Where | Required | Purpose |
|----------|-------|----------|---------|
| `CLERK_ISSUER` | API | Yes | JWT verification |
| `CLERK_SECRET_KEY` | API | No | Enriching user data from Clerk |
| `DATABASE_URL` | API | Prod only | Neon connection string |
| `FRONTEND_URL` | API | Yes | CORS allowlist |
| `VITE_API_URL` | Web | Yes | API base URL |
| `VITE_CLERK_PUBLISHABLE_KEY` | Web | No | Omit to run without auth in dev |

## Core Domain Model

```
Curriculum
  └── CurriculumModule (prework, live_class, workshop, etc.)
        └── Lesson (day-based release scheduling)
              └── ContentBlock (video, text, exercise, checkpoint)

Cohort (assigned a Curriculum)
  └── Enrollment (User ↔ Cohort)
        ├── ModuleAssignment (per-student access overrides)
        └── LessonAssignment (per-student unlock overrides)

User
  ├── Progress (per ContentBlock completion tracking)
  └── Submission (graded exercise responses)
```

## Key Features

- **Curriculum Management** — Reusable curricula with modules, lessons, and content blocks
- **Cohort Operations** — Create cohorts, assign curricula, manage enrollments
- **Unlock Engine** — Day-based scheduling with cohort-wide and per-student overrides
- **Progress Tracking** — Video completion (YouTube + Vimeo), exercise marking, per-block granularity
- **Grading & Feedback** — Submission queue, A/B/C/R grading, redo workflow, GitHub issue integration
- **Role-Based Access** — Student, instructor, and admin roles with appropriate UI and API gates
- **Mobile-First UI** — Responsive design, collapsible sidebar, PWA support
- **Analytics** — PostHog integration for page views and feature flags

## Documentation

| Document | Purpose |
|----------|---------|
| [`docs/PRODUCT_VISION.md`](docs/PRODUCT_VISION.md) | Why this product exists and where it's going |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What to build now, next, and later |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Step-by-step deployment for Render + Netlify |
| [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) | All API endpoints with request/response details |
| [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) | Original architecture and data model design |
| [`docs/FUTURE_IMPROVEMENTS.md`](docs/FUTURE_IMPROVEMENTS.md) | Planned enhancements (GitHub onboarding, etc.) |
| [`docs/SETUP_CHECKLIST.md`](docs/SETUP_CHECKLIST.md) | Post-deploy setup (Search Console, PostHog, PWA) |
| [`api/README.md`](api/README.md) | Backend-specific setup, models, and API overview |
| [`web/README.md`](web/README.md) | Frontend-specific setup, routes, and components |
