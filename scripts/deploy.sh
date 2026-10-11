#!/usr/bin/env bash
# Build the Hosting payload and deploy it.
#
# The game is a single self-contained HTML file at the repo root. Hosting wants an
# index.html in a directory of its own, so we copy it in fresh every time -- that
# way a deploy can never ship a stale copy. public/ is generated, not source.
# The cloud telemetry module (live/*.js) is copied beside it and its <script> tag is
# added to public/index.html only; the game file itself is never edited.
# Each deploy is labelled with the game version and the commit ("-dirty" if the tree has uncommitted
# changes), so Firebase console -> Hosting -> Release history shows what went out when.
#
# Usage: scripts/deploy.sh            # deploy hosting + Firestore rules
#        scripts/deploy.sh --serve    # preview on localhost:5002 against local emulators
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf public
mkdir public
cp "PUZZLE PUNCH.html" public/index.html
cp live/*.js public/
VERSION=$(node scripts/inject-telemetry.mjs public/index.html)
LABEL="$VERSION @ $(git describe --always --dirty)"

if [ "${1-}" = "--serve" ]; then
  # the emulators need Java; brew's openjdk is keg-only
  if [ -d /opt/homebrew/opt/openjdk/bin ]; then PATH="/opt/homebrew/opt/openjdk/bin:$PATH"; fi
  exec npx -y firebase-tools emulators:start --only hosting,auth,firestore
fi

echo "deploying: $LABEL"
exec npx -y firebase-tools deploy --only hosting,firestore:rules --message "$LABEL"
