#!/bin/bash
# Project checks for this static site (acts as the repo's lint + test):
#   1. the JS embedded in each HTML page parses cleanly (node --check)
#   2. the committed FAA data feed is valid JSON
set -euo pipefail
cd "$(dirname "$0")/../.."

fail=0
# node --check infers module type from the extension, so the temp file needs .js
tmp="$(mktemp --suffix=.js)"
trap 'rm -f "$tmp"' EXIT

for f in index.html winter-pack.html; do
  python3 - "$f" > "$tmp" <<'PY'
import sys, re
html = open(sys.argv[1]).read()
# Inline <script> blocks only (skip those with a src= attribute)
blocks = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S)
sys.stdout.write('\n'.join(blocks))
PY
  if node --check "$tmp"; then
    echo "ok: $f — inline JS parses"
  else
    echo "FAIL: $f — inline JS has a syntax error"; fail=1
  fi
done

if python3 -c "import json; json.load(open('data/faa-events.json'))"; then
  echo "ok: data/faa-events.json — valid JSON"
else
  echo "FAIL: data/faa-events.json — invalid JSON"; fail=1
fi

[ "$fail" -eq 0 ] && echo "All checks passed." || echo "Checks failed."
exit $fail
