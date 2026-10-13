#!/usr/bin/env bash
# Build the Hosting payload and deploy it.
#
# The game is a single self-contained HTML file at the repo root. Hosting wants an
# index.html in a directory of its own, so we copy it in fresh every time -- that
# way a deploy can never ship a stale copy. public/ is generated, not source.
# The cloud telemetry module (live/*.js) is copied beside it and its <script> tag is
# added to public/index.html only; the game file itself is never edited.
# Each deploy is labelled with the game version and the commit, so Firebase console -> Hosting ->
# Release history shows what went out when. A real deploy refuses to run from a dirty tree or from
# a commit that is not on origin/main, so the label always names code that exists in the repo.
#
# Usage: scripts/deploy.sh            # deploy hosting + Firestore rules and indexes
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
  exec npx firebase emulators:start --only hosting,auth,firestore
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing to deploy: uncommitted changes. Commit (and merge) first." >&2
  exit 1
fi
git fetch --quiet origin main
if ! git merge-base --is-ancestor HEAD origin/main; then
  echo "refusing to deploy: $(git rev-parse --short HEAD) is not on origin/main. Merge the PR, pull main, then deploy." >&2
  exit 1
fi

echo "deploying: $LABEL"
exec npx firebase deploy --only hosting,firestore:rules,firestore:indexes --message "$LABEL"
