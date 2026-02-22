#!/usr/bin/env bash
#
# Publish @opentabs-dev platform packages to npm (private).
#
# Requires:
#   - ~/.npmrc with a token that has read+write access to @opentabs-dev packages.
#
# Setup (one-time):
#   1. Create a granular access token at https://www.npmjs.com/settings/tokens/create
#      - Permissions: Read and Write, Packages: @opentabs-dev/*, Bypass 2FA enabled
#   2. Save it: echo '//registry.npmjs.org/:_authToken=<TOKEN>' > ~/.npmrc
#
# Usage:
#   ./scripts/publish.sh <version>
#   ./scripts/publish.sh 0.0.3
#
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/publish.sh <version>"
  echo "Example: ./scripts/publish.sh 0.0.3"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Warning: git working directory has uncommitted changes."
  read -p "Continue anyway? [y/N] " confirm
  [[ "$confirm" == [yY] ]] || exit 1
fi

echo "==> Verifying npm authentication..."
NPM_USER=$(npm whoami 2>&1) || {
  echo "Error: npm authentication failed."
  echo ""
  echo "Ensure ~/.npmrc has a valid token with read+write access."
  echo "Run 'npm login --scope=@opentabs-dev' or add a granular token to ~/.npmrc."
  exit 1
}
echo "  Authenticated as: $NPM_USER"

echo ""
echo "==> Bumping versions to $VERSION..."
for pkg in platform/shared platform/plugin-sdk platform/plugin-tools platform/cli; do
  sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$pkg/package.json" && rm "$pkg/package.json.bak"
  echo "  $pkg/package.json → $VERSION"
done

# Update cross-references to new version
for pkg in platform/plugin-sdk platform/plugin-tools platform/cli; do
  sed -i.bak "s/\"@opentabs-dev\/shared\": \"\\^[^\"]*\"/\"@opentabs-dev\/shared\": \"^$VERSION\"/" "$pkg/package.json" && rm "$pkg/package.json.bak"
done
for pkg in platform/plugin-tools platform/cli; do
  sed -i.bak "s/\"@opentabs-dev\/plugin-sdk\": \"\\^[^\"]*\"/\"@opentabs-dev\/plugin-sdk\": \"^$VERSION\"/" "$pkg/package.json" && rm "$pkg/package.json.bak"
done
sed -i.bak "s/\"@opentabs-dev\/plugin-tools\": \"\\^[^\"]*\"/\"@opentabs-dev\/plugin-tools\": \"^$VERSION\"/" platform/cli/package.json && rm platform/cli/package.json.bak

echo ""
echo "==> Rebuilding with new versions..."
bun run build

echo ""
echo "==> Publishing packages (dependency order)..."
echo ""

echo "  Publishing @opentabs-dev/shared@$VERSION..."
npm publish --access restricted -w platform/shared

echo "  Publishing @opentabs-dev/plugin-sdk@$VERSION..."
npm publish --access restricted -w platform/plugin-sdk

echo "  Publishing @opentabs-dev/plugin-tools@$VERSION..."
npm publish --access restricted -w platform/plugin-tools

echo "  Publishing @opentabs-dev/cli@$VERSION..."
npm publish --access restricted -w platform/cli

echo ""
echo "==> Published all packages at v$VERSION"

echo ""
echo "==> Generating changelog..."

PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$PREV_TAG" ]; then
  RANGE="$PREV_TAG..HEAD"
else
  RANGE=""
fi

# Collect commit subjects (hash stripped) since last tag
COMMITS=$(git log ${RANGE:+"$RANGE"} --no-merges --pretty=format:"%s")

if [ -z "$COMMITS" ]; then
  echo "  No commits found — skipping changelog."
else
  # Group commits by conventional commit type prefix (feat, fix, etc.)
  # Uses separate variables per group (compatible with bash 3.2 on macOS)
  GRP_FEAT="" GRP_FIX="" GRP_PERF="" GRP_REFACTOR="" GRP_BUILD="" GRP_CI=""
  GRP_TEST="" GRP_DOCS="" GRP_STYLE="" GRP_CHORE="" GRP_OTHER="" UNGROUPED=""

  while IFS= read -r line; do
    if [[ "$line" =~ ^([a-z]+)(\(.+\))?:\ (.+)$ ]]; then
      TYPE="${BASH_REMATCH[1]}"
      MSG="${BASH_REMATCH[3]}"
      case "$TYPE" in
        feat)     GRP_FEAT="${GRP_FEAT}- ${MSG}"$'\n' ;;
        fix)      GRP_FIX="${GRP_FIX}- ${MSG}"$'\n' ;;
        refactor) GRP_REFACTOR="${GRP_REFACTOR}- ${MSG}"$'\n' ;;
        docs)     GRP_DOCS="${GRP_DOCS}- ${MSG}"$'\n' ;;
        test)     GRP_TEST="${GRP_TEST}- ${MSG}"$'\n' ;;
        chore)    GRP_CHORE="${GRP_CHORE}- ${MSG}"$'\n' ;;
        perf)     GRP_PERF="${GRP_PERF}- ${MSG}"$'\n' ;;
        ci)       GRP_CI="${GRP_CI}- ${MSG}"$'\n' ;;
        style)    GRP_STYLE="${GRP_STYLE}- ${MSG}"$'\n' ;;
        build)    GRP_BUILD="${GRP_BUILD}- ${MSG}"$'\n' ;;
        release)  ;; # Skip release commits
        *)        GRP_OTHER="${GRP_OTHER}- ${MSG}"$'\n' ;;
      esac
    else
      UNGROUPED="${UNGROUPED}- ${line}"$'\n'
    fi
  done <<< "$COMMITS"

  # Build the changelog entry by appending each non-empty group
  ENTRY="## v${VERSION}"$'\n'$'\n'
  HAS_GROUPS=false

  append_group() {
    local label="$1" items="$2"
    if [ -n "$items" ]; then
      HAS_GROUPS=true
      ENTRY+="### ${label}"$'\n'$'\n'"${items}"$'\n'
    fi
  }

  append_group "Features" "$GRP_FEAT"
  append_group "Bug Fixes" "$GRP_FIX"
  append_group "Performance" "$GRP_PERF"
  append_group "Refactoring" "$GRP_REFACTOR"
  append_group "Build" "$GRP_BUILD"
  append_group "CI" "$GRP_CI"
  append_group "Tests" "$GRP_TEST"
  append_group "Documentation" "$GRP_DOCS"
  append_group "Style" "$GRP_STYLE"
  append_group "Chores" "$GRP_CHORE"
  append_group "Other" "$GRP_OTHER"

  if [ -n "$UNGROUPED" ]; then
    if [ "$HAS_GROUPS" = true ]; then
      ENTRY+="### Other"$'\n'$'\n'
    fi
    ENTRY+="${UNGROUPED}"$'\n'
  fi

  # Prepend to CHANGELOG.md
  if [ -f CHANGELOG.md ]; then
    EXISTING=$(cat CHANGELOG.md)
    printf '%s\n%s\n' "$ENTRY" "$EXISTING" > CHANGELOG.md
  else
    printf '# Changelog\n\n%s\n' "$ENTRY" > CHANGELOG.md
  fi

  echo "  Generated changelog for v$VERSION"
fi

echo ""
echo "==> Creating release commit and tag..."
git add platform/shared/package.json platform/plugin-sdk/package.json platform/plugin-tools/package.json platform/cli/package.json
if [ -f CHANGELOG.md ]; then
  git add CHANGELOG.md
fi
git commit -m "release: v$VERSION"
git tag "v$VERSION"

echo ""
echo "==> Release v$VERSION committed and tagged."
echo ""
echo "Next steps:"
echo "  1. git push && git push --tags"
echo "  2. Update plugin dependencies: sed -i.bak 's/\"\\^[0-9.]*\"/\"^$VERSION\"/' plugins/*/package.json && rm plugins/*/package.json.bak"
echo "  3. Rebuild plugins: cd plugins/<name> && bun install && bun run build"
