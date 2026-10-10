#!/usr/bin/env bash
# Build the Hosting payload and deploy it.
#
# The game is a single self-contained HTML file at the repo root. Hosting wants an
# index.html in a directory of its own, so we copy it in fresh every time -- that
# way a deploy can never ship a stale copy. public/ is generated, not source.
#
# Usage: scripts/deploy.sh            # deploy
#        scripts/deploy.sh --serve    # preview on localhost instead
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf public
mkdir public
cp "PUZZLE PUNCH.html" public/index.html

if [ "${1-}" = "--serve" ]; then
  exec npx -y firebase-tools serve --only hosting
fi

exec npx -y firebase-tools deploy --only hosting
