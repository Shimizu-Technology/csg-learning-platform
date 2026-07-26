#!/usr/bin/env bash
set -euo pipefail

maestro_bin="${MAESTRO_BIN:-$(command -v maestro || true)}"
if [[ -z "${maestro_bin}" && -x "${HOME}/.maestro/bin/maestro" ]]; then
  maestro_bin="${HOME}/.maestro/bin/maestro"
fi

if [[ -z "${maestro_bin}" ]]; then
  echo "Maestro is required. Install it from https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli" >&2
  exit 1
fi

metro_host="${CSG_METRO_HOST:-localhost}"
development_url="exp+csg-connect://expo-development-client/?url=http%3A%2F%2F${metro_host}%3A8081"
device_args=()

if [[ -n "${CSG_IOS_DEVICE:-}" ]]; then
  device_args+=(--udid "$CSG_IOS_DEVICE")
fi

for _attempt in {1..30}; do
  if curl --fail --silent --max-time 1 "http://${metro_host}:8081/status" | grep -q "packager-status:running"; then
    break
  fi
  sleep 1
done

if ! curl --fail --silent --max-time 2 "http://${metro_host}:8081/status" | grep -q "packager-status:running"; then
  echo "Metro is not reachable at http://${metro_host}:8081. Start the Expo development server before running this flow." >&2
  exit 1
fi

for flow in .maestro/ios-smoke.yaml .maestro/ios-routes.yaml; do
  "${maestro_bin}" test \
    "${device_args[@]}" \
    --env "CSG_DEVELOPMENT_URL=${development_url}" \
    --test-output-dir .maestro-artifacts \
    "${flow}"
done
