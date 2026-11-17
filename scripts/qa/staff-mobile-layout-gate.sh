#!/usr/bin/env bash
# Web-only W7 PR 7.6b gate for the secret-free ASUS runner.
set -euo pipefail
export CI=true
# asus-test excludes .git; Vite indexes tracked brand assets.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git init -q; fi
git add -- web/brand-public
cd web
npm ci --no-audit --no-fund
npm run typecheck
npm run lint
npm test -- --maxWorkers=2
npm run test:netlify
npm run build
npm run test:bundle
npm run api:check
