#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web (remote) sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# weather-monitor is a static site (plain HTML/JS served by GitHub Pages) with
# no package manager or build step, so there is nothing to install. We just
# confirm the runtimes the project's checks and CI depend on are present:
#   - node:    syntax-checks the JS embedded in the HTML pages (.claude/hooks/check.sh)
#   - python3: used by the FAA refresh workflow to slim/validate the data feed
missing=0
command -v node    >/dev/null 2>&1 || { echo "warning: node not found on PATH"    >&2; missing=1; }
command -v python3 >/dev/null 2>&1 || { echo "warning: python3 not found on PATH" >&2; missing=1; }

if [ "$missing" -eq 0 ]; then
  echo "weather-monitor: static site, no dependencies to install — $(node --version) / $(python3 --version) ready"
fi

exit 0
