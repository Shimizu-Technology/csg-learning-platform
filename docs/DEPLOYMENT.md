# CSG Learning Platform — Deployment Guide

**Last updated:** 2026-04-07

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Netlify (SPA)  │────>│  Render (API)    │────>│  Neon (DB)  │
│  Frontend       │     │  Singapore       │     │  PostgreSQL │
│  learn.csg.com  │     │  learn-api.csg.  │     │             │
└─────────────────┘     └──────────────────┘     └─────────────┘
         │                       │
         │                       ├──> Clerk (Auth)
         ├──> Clerk (Auth)       ├──> GitHub API (Grading)
         └──> PostHog            └──> Resend (Email)
```

---

## Backend — Render

### Service Configuration

| Setting | Value |
|---------|-------|
| Service type | Web Service |
| Region | Singapore (closest to Guam) |
| Runtime | Docker |
| Branch | `main` |
| Root directory | `api` |
| Health check path | `/up` |

### Environment Variables (Render Dashboard)

```
RAILS_ENV=production
RAILS_MASTER_KEY=<from api/config/master.key>
DATABASE_URL=<Neon connection string>
FRONTEND_URL=https://learn.codeschoolofguam.com
CLERK_ISSUER=https://<your-clerk-app>.clerk.accounts.dev
CLERK_SECRET_KEY=sk_live_...
MAILER_FROM_EMAIL=noreply@codeschoolofguam.com
RESEND_API_KEY=re_...
GITHUB_ORGANIZATION_ADMIN_TOKEN=ghp_...
```

### Deploy Process

1. Push to `main` triggers auto-deploy on Render
2. Docker build runs from `api/Dockerfile`
3. `bin/docker-entrypoint` runs migrations automatically on startup
4. Health check at `/up` confirms the app is ready

### Manual Deploy

```bash
# From the Render dashboard:
# Settings > Manual Deploy > Deploy latest commit
```

### Database Migrations

Migrations run automatically via the Docker entrypoint. For manual runs:

```bash
# Via Render Shell:
cd /rails
bin/rails db:migrate
```

### Rails Console (Production)

Access via Render Shell:
```bash
cd /rails
bin/rails console
```

---

## Frontend — Netlify

### Site Configuration

| Setting | Value |
|---------|-------|
| Build command | `npm run build` |
| Publish directory | `web/dist` |
| Base directory | `web` |
| Node version | 20 (set in Netlify environment) |

### Environment Variables (Netlify Dashboard)

```
VITE_API_URL=https://learn-api.codeschoolofguam.com
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
VITE_PUBLIC_POSTHOG_KEY=phc_...
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

### SPA Routing

The `netlify.toml` includes a catch-all redirect for SPA routing:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Custom Domain

DNS for `learn.codeschoolofguam.com` should point to Netlify (CNAME or Netlify DNS).

### Deploy Process

1. Push to `main` triggers auto-deploy
2. Netlify runs `npm run build` from the `web/` directory
3. TypeScript compilation (`tsc --noEmit`) runs as part of the build
4. Static files from `dist/` are deployed to CDN

---

## Database — Neon

### Connection

The `DATABASE_URL` follows this format:
```
postgresql://user:password@ep-xxx-yyy.us-east-2.aws.neon.tech/dbname?sslmode=require
```

### Branching

Neon supports database branching for testing migrations before production:
1. Create a branch in Neon dashboard
2. Use the branch connection string locally
3. Test migrations
4. Merge to main branch

### Backups

Neon provides point-in-time recovery. Check the Neon dashboard for backup settings.

---

## DNS Configuration

| Domain | Points to | Type |
|--------|-----------|------|
| `learn.codeschoolofguam.com` | Netlify | CNAME |
| `learn-api.codeschoolofguam.com` | Render | CNAME |

---

## Post-Deploy Checklist

After first deployment or major changes:

- [ ] Verify health check: `curl https://learn-api.codeschoolofguam.com/health`
- [ ] Verify frontend loads: `https://learn.codeschoolofguam.com`
- [ ] Verify Clerk auth works (sign in with test account)
- [ ] Run seed data if needed: `bin/rails db:seed` via Render Shell
- [ ] Check PostHog is receiving events
- [ ] Verify CORS is working (frontend can call API)
- [ ] Test student and admin flows end-to-end

---

## Troubleshooting

### API returns 500

1. Check Render logs for stack trace
2. Verify `DATABASE_URL` is correct and Neon is accessible
3. Verify `RAILS_MASTER_KEY` matches `config/master.key`
4. Check if migrations need to run

### Frontend shows blank page

1. Check browser console for errors
2. Verify `VITE_API_URL` points to correct API
3. Verify `VITE_CLERK_PUBLISHABLE_KEY` is set (or intentionally omitted for no-auth mode)
4. Check Netlify deploy logs for build errors

### CORS errors

1. Verify `FRONTEND_URL` on Render matches the actual frontend URL exactly
2. Check for trailing slashes (should not have one)
3. Verify the API's `rack-cors` configuration

### Clerk auth not working

1. Verify `CLERK_ISSUER` matches your Clerk app
2. Check that the JWT contains the expected claims
3. Verify Clerk webhook or session settings haven't changed

### Database connection issues

1. Check Neon dashboard for service status
2. Verify `DATABASE_URL` SSL settings (`sslmode=require`)
3. Check if Neon compute has auto-suspended (free tier) — first request may be slow
