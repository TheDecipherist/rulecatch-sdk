#!/bin/bash
# Sync source files from the private monorepo to this public SDK repo.
# Run from the rulecatch-sdk directory before publishing new versions.
#
# Usage: ./sync.sh

set -e

MONOREPO="${HOME}/projects/rulecatch"
SDK_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Syncing from ${MONOREPO} to ${SDK_DIR}..."

# ai-pooler
echo "  ai-pooler..."
rm -rf "${SDK_DIR}/packages/ai-pooler/src" "${SDK_DIR}/packages/ai-pooler/templates" "${SDK_DIR}/packages/ai-pooler/tests"
cp -r "${MONOREPO}/packages/ai-pooler/src" "${SDK_DIR}/packages/ai-pooler/"
cp -r "${MONOREPO}/packages/ai-pooler/templates" "${SDK_DIR}/packages/ai-pooler/"
cp -r "${MONOREPO}/packages/ai-pooler/tests" "${SDK_DIR}/packages/ai-pooler/"
cp "${MONOREPO}/packages/ai-pooler/rollup.config.mjs" "${SDK_DIR}/packages/ai-pooler/"
cp "${MONOREPO}/packages/ai-pooler/tsconfig.json" "${SDK_DIR}/packages/ai-pooler/"
cp "${MONOREPO}/packages/ai-pooler/README.md" "${SDK_DIR}/packages/ai-pooler/"

# mcp-server
echo "  mcp-server..."
rm -rf "${SDK_DIR}/packages/mcp-server/src" "${SDK_DIR}/packages/mcp-server/tests"
cp -r "${MONOREPO}/packages/mcp-server/src" "${SDK_DIR}/packages/mcp-server/"
cp -r "${MONOREPO}/packages/mcp-server/tests" "${SDK_DIR}/packages/mcp-server/"
cp "${MONOREPO}/packages/mcp-server/tsconfig.json" "${SDK_DIR}/packages/mcp-server/"
cp "${MONOREPO}/packages/mcp-server/README.md" "${SDK_DIR}/packages/mcp-server/"

echo ""
echo "Done! Remember to:"
echo "  1. Update version in packages/*/package.json (keep in sync with monorepo)"
echo "  2. Review changes: git diff"
echo "  3. Commit and push: git add -A && git commit -m 'Sync vX.Y.Z' && git push"
