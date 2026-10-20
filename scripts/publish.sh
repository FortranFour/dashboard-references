#!/usr/bin/env bash
# Run from this repository on a computer with an authenticated GitHub CLI.
# Creates a NEW public repository; refuses to reuse or overwrite an existing one.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
repo='FortranFour/dashboard-references'
command -v gh >/dev/null || { echo 'GitHub CLI (gh) is required.' >&2; exit 1; }
gh auth status
login="$(gh api user --jq .login)"
if [[ "$login" != 'FortranFour' ]]; then
  echo "Authenticate as FortranFour before publishing; current account is $login." >&2
  exit 1
fi
if gh repo view "$repo" --json nameWithOwner >/dev/null 2>&1; then
  echo "$repo already exists. Inspect it and publish through a reviewed update; this script will not overwrite it." >&2
  exit 1
fi
npm ci
npm run build
npm run check
npx playwright install chromium
npm test
if [[ ! -d .git ]]; then git init -b main; fi
if git remote get-url origin >/dev/null 2>&1; then
  echo 'An origin remote already exists. Inspect it before publishing.' >&2
  exit 1
fi
git add .
if ! git diff --cached --quiet; then git commit -m 'Package Dashboard References for HACS community beta'; fi
gh repo create "$repo" --public --source=. --remote=origin --push --description 'Reuse saved Home Assistant dashboard cards and named entity assignments, with native component editing.'
gh repo edit "$repo" --enable-issues --add-topic home-assistant --add-topic hacs --add-topic lovelace --add-topic custom-cards --add-topic dashboard
version="$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")"
git tag "v$version"
git push origin "v$version"
echo "Published repository: https://github.com/$repo"
echo 'The tag starts the tested GitHub prerelease workflow. Check Actions before announcing the release.'
