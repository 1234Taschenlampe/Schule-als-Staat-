#!/usr/bin/env bash
set -euo pipefail

scanner=${GITLEAKS_BIN:-gitleaks}
command -v "$scanner" >/dev/null || { echo "Gitleaks is unavailable." >&2; exit 2; }
cd "$(git rev-parse --show-toplevel)"
snapshot=$(mktemp -d)
trap 'rm -rf "$snapshot"' EXIT

# Include tracked files only. Never scan runner credentials or build caches.
git ls-files -z | tar --null --verbatim-files-from --no-recursion -T - -cf - | tar -xf - -C "$snapshot"
reports=$(mktemp -d)
chmod 700 "$reports"
trap 'rm -rf "$snapshot" "$reports"' EXIT
status=0
scan() {
  local label=$1 result=0
  shift
  # Suppress all scanner output, including paths and context around findings.
  "$scanner" "$@" --redact=100 --no-banner --ignore-gitleaks-allow --gitleaks-ignore-path "$snapshot/no-baseline" --config "$reports/scan.toml" --report-format json --report-path "$reports/findings.json" >/dev/null 2>&1 || result=$?
  case "$result" in
    0) echo "$label: passed" ;;
    17) echo "$label: findings detected. Review privately and rotate active secrets." >&2; python3 -c 'import json,sys,re,collections; data=json.load(open(sys.argv[1])); counts=collections.Counter(x.get("RuleID","") for x in data); print("Redacted rule counts:",json.dumps({k:v for k,v in counts.items() if re.fullmatch(r"[a-z0-9_-]{1,80}",k)})); print("Tracked finding locations:",json.dumps([{"file":p,"line":x.get("StartLine")} for x in data for p in [x.get("File","").removeprefix(sys.argv[2]+"/")] if re.fullmatch(r"(?:[a-zA-Z0-9_.-]+/)*[a-zA-Z0-9_.-]+",p) and len(p)<180 and isinstance(x.get("StartLine"),int)]))' "$reports/findings.json" "$snapshot" || true; status=1 ;;
    *) echo "$label: scanner failed (exit $result)." >&2; status=1 ;;
  esac
  rm -f "$reports/findings.json"
}
cp .gitleaks.toml "$reports/scan.toml"
scan "Git history" git --exit-code 17 --log-opts="--all --full-history" .
scan "Tracked tree" dir --exit-code 17 "$snapshot"
exit "$status"
