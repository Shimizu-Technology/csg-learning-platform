#!/usr/bin/env bash

set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ignore_script="$script_directory/netlify-ignore-build.sh"
fixture_directory="$(mktemp -d)"

cleanup() {
  rm -rf "$fixture_directory"
}
trap cleanup EXIT

assert_status() {
  local expected_status="$1"
  local description="$2"
  shift 2

  set +e
  "$@" >/dev/null 2>&1
  local actual_status=$?
  set -e

  if [[ "$actual_status" -ne "$expected_status" ]]; then
    echo "FAIL: $description (expected $expected_status, got $actual_status)" >&2
    exit 1
  fi
}

git -C "$fixture_directory" init -q
git -C "$fixture_directory" config user.email "netlify-test@example.com"
git -C "$fixture_directory" config user.name "Netlify Test"
mkdir -p "$fixture_directory/api" "$fixture_directory/web/scripts"
cp "$ignore_script" "$fixture_directory/web/scripts/netlify-ignore-build.sh"
touch "$fixture_directory/.nvmrc" "$fixture_directory/.node-version"
echo '[build]' > "$fixture_directory/netlify.toml"
echo 'frontend' > "$fixture_directory/web/app.txt"
echo 'backend' > "$fixture_directory/api/app.txt"
git -C "$fixture_directory" add .
git -C "$fixture_directory" commit -qm "initial"
initial_commit="$(git -C "$fixture_directory" rev-parse HEAD)"

echo 'backend change' >> "$fixture_directory/api/app.txt"
git -C "$fixture_directory" add api/app.txt
git -C "$fixture_directory" commit -qm "backend only"
backend_commit="$(git -C "$fixture_directory" rev-parse HEAD)"

assert_status 0 "backend-only changes skip the frontend build" \
  env CACHED_COMMIT_REF="$initial_commit" COMMIT_REF="$backend_commit" \
  bash -c "cd '$fixture_directory/web' && bash scripts/netlify-ignore-build.sh"

echo 'frontend change' >> "$fixture_directory/web/app.txt"
git -C "$fixture_directory" add web/app.txt
git -C "$fixture_directory" commit -qm "frontend"
frontend_commit="$(git -C "$fixture_directory" rev-parse HEAD)"

assert_status 1 "frontend changes run the build" \
  env CACHED_COMMIT_REF="$backend_commit" COMMIT_REF="$frontend_commit" \
  bash -c "cd '$fixture_directory/web' && bash scripts/netlify-ignore-build.sh"

echo '# config change' >> "$fixture_directory/netlify.toml"
git -C "$fixture_directory" add netlify.toml
git -C "$fixture_directory" commit -qm "Netlify config"
config_commit="$(git -C "$fixture_directory" rev-parse HEAD)"

assert_status 1 "root Netlify configuration changes run the build" \
  env CACHED_COMMIT_REF="$frontend_commit" COMMIT_REF="$config_commit" \
  bash -c "cd '$fixture_directory/web' && bash scripts/netlify-ignore-build.sh"

assert_status 1 "missing commit metadata fails open" \
  bash -c "cd '$fixture_directory/web' && bash scripts/netlify-ignore-build.sh"

assert_status 1 "an explicitly repeated commit runs the build" \
  env CACHED_COMMIT_REF="$config_commit" COMMIT_REF="$config_commit" \
  bash -c "cd '$fixture_directory/web' && bash scripts/netlify-ignore-build.sh"

echo "Netlify ignore-build checks passed."
