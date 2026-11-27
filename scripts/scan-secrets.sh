#!/usr/bin/env bash
set -euo pipefail

scanner=${GITLEAKS_BIN:-gitleaks}
command -v "$scanner" >/dev/null || { echo "Gitleaks is unavailable." >&2; exit 2; }
cd "$(git rev-parse --show-toplevel)"
snapshot=$(mktemp -d)
trap 'rm -rf "$snapshot"' EXIT

# Include tracked files only. Never scan runner credentials or build caches.
git ls-files -z | tar --null --verbatim-files-from --no-recursion -T - -cf - | tar -xf - -C "$snapshot"
status=0
scan() {
  local label=$1 result=0
  shift
  # Suppress all scanner output, including paths and context around findings.
  "$scanner" "$@" --redact=100 --no-banner --ignore-gitleaks-allow --gitleaks-ignore-path "$snapshot/no-baseline" --config "$snapshot/default.toml" >/dev/null 2>&1 || result=$?
  case "$result" in
    0) echo "$label: passed" ;;
    17) echo "$label: findings detected. Review privately and rotate active secrets." >&2; status=1 ;;
    *) echo "$label: scanner failed (exit $result)." >&2; status=1 ;;
  esac
}
printf '[extend]\nuseDefault = true\n' > "$snapshot/default.toml"
scan "Git history" git --exit-code 17 --log-opts="--all --full-history" .
scan "Tracked tree" dir --exit-code 17 "$snapshot"
exit "$status"
