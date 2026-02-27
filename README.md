# CSG Learning Platform

The Code School of Guam learning hub — prework, live class, workshops, recordings, and capstone tracking.

## Architecture

| Layer | Tech |
|-------|------|
| Frontend | React 19 + TypeScript + Tailwind v4 + Vite |
| Backend | Rails 8.1 API-only |
| Auth | Clerk (invite-only, role-based) |
| Database | PostgreSQL (Neon) |
| Hosting | Netlify (frontend) + Render Singapore (API) |

## Monorepo Structure

```
csg-learning-platform/
├── api/          Rails 8.1 API
├── web/          React + Vite frontend
├── docs/         Documentation
└── scripts/      Utility scripts
```

## Getting Started

### API
```bash
cd api
bundle install
rails db:create db:migrate db:seed
rails server -p 3001
```

### Web
```bash
cd web
npm install
npm run dev
```

## Environment Variables

See `api/.env.example` and `web/.env.example` for required variables.
