#!/usr/bin/env bash
# Local manual refresh: fetch latest scores, rebuild stats, commit and push.
# Usage: scripts/update.sh            # fetch + build + commit + push
#        scripts/update.sh --no-push  # fetch + build only (preview locally)
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-python3}"
"$PY" scripts/fetch.py
"$PY" scripts/build.py

if [[ "${1:-}" == "--no-push" ]]; then
  echo "Built docs/data. Preview with: python3 -m http.server -d docs 8000"
  exit 0
fi

ASOF=$("$PY" -c 'import json;print(json.load(open("docs/data/stats.json"))["as_of_et"])')
git add docs/data
if git diff --cached --quiet; then
  echo "No data changes to commit."
  exit 0
fi
git commit -m "Update data (as of ${ASOF})"
git pull --rebase --quiet
git push
echo "Pushed. The site redeploys in about a minute."
