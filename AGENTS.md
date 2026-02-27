# AGENTS.md

## Project Overview
CSG Learning Platform — the Code School of Guam learning hub.
Monorepo: `api/` (Rails 8.1) + `web/` (React 19 + Vite + Tailwind v4)

## Conventions
- **Auth:** Clerk (JWT verification on backend, ClerkProvider on frontend)
- **Icons:** Lucide React only. NO emojis in UI.
- **CSS:** Tailwind v4 only. No CSS modules or styled-components.
- **API:** RESTful JSON. All endpoints namespaced under `/api/v1/`
- **CORS:** Allow frontend origin only
- **Deploy:** Render Singapore (API) + Netlify (frontend) + Neon (DB)
- **Region:** Always Singapore on Render (closest to Guam)

## Design System
- Colors: slate for neutrals, ruby/red for primary accents, green for success
- Rounded corners: rounded-2xl for cards, rounded-lg for buttons
- Font: system-ui (default Tailwind)
- Spacing: consistent py-24 lg:py-32 for sections

## Key Files
- Plan doc: `~/clawd/docs/projects/csg-learning-platform-plan.md`
- Starter guides: `~/clawd/obsidian-vault/starter-app/`
- Frontend design: `~/clawd/obsidian-vault/starter-app/FRONTEND_DESIGN_GUIDE.md`
- Clerk auth: `~/clawd/obsidian-vault/starter-app/CLERK_AUTH_SETUP_GUIDE.md`
- Deployment: `~/clawd/obsidian-vault/starter-app/DEPLOYMENT_GUIDE.md`
