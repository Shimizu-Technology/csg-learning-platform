# AGENTS.md

## Project Overview

CSG Learning Platform — the all-in-one learning hub for Code School of Guam.

Monorepo: `api/` (Rails 8.1 API-only) + `web/` (React 19 + Vite + Tailwind v4)

## Conventions

- **Auth:** Clerk (JWT verification on backend, ClerkProvider on frontend)
- **Icons:** Lucide React only. NO emojis in UI.
- **CSS:** Tailwind v4 only. No CSS modules or styled-components.
- **API:** RESTful JSON. All endpoints namespaced under `/api/v1/`
- **CORS:** Allow frontend origin only (`FRONTEND_URL` env var)
- **Deploy:** Render Singapore (API) + Netlify (frontend) + Neon (DB)
- **Region:** Always Singapore on Render (closest to Guam)
- **Tests:** Minitest for Rails. TypeScript strict mode (`tsc --noEmit`) for frontend.
- **Linting:** RuboCop (rails-omakase) for Ruby. ESLint for TypeScript.
- **Security:** Brakeman + bundler-audit in CI. DOMPurify for any HTML rendering.

## Design System

- Colors: slate for neutrals, ruby/red for primary accents, green for success
- Rounded corners: `rounded-2xl` for cards, `rounded-lg` for buttons
- Font: system-ui (default Tailwind)
- Spacing: consistent `py-24 lg:py-32` for sections
- Layout: mobile-first, collapsible sidebar, max-width containers

## Roles

| Role | Value | Access |
|------|-------|--------|
| `student` | 0 | Own content, progress, submissions |
| `instructor` | 1 | Staff views: students, grading, cohorts |
| `admin` | 2 | Everything: content management, team, settings |

## Key Documentation

- `docs/PRODUCT_VISION.md` — Product direction and philosophy
- `docs/ROADMAP.md` — Execution plan (phases, priorities)
- `docs/DEPLOYMENT.md` — Deployment runbook (Render + Netlify)
- `docs/API_REFERENCE.md` — All API endpoints
- `docs/BUILD_PLAN.md` — Original architecture design
- `api/README.md` — Backend setup, models, env vars
- `web/README.md` — Frontend setup, routes, components
