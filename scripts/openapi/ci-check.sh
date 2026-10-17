#!/usr/bin/env bash
# P2-4：OpenAPI CI 检查 — 重新生成 openapi.yaml 并与已提交版本 diff。
# 用法：bash scripts/openapi/ci-check.sh（从仓库根目录运行）
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "==> Building API (for printRoutes)..."
(cd apps/api && npx tsc -p tsconfig.json)

echo "==> Regenerating openapi.yaml..."
node scripts/openapi/generate.mjs

echo "==> Diffing against committed openapi.yaml..."
if git diff --exit-code -- openapi.yaml >/dev/null 2>&1; then
  echo "openapi.yaml is up to date."
else
  echo "ERROR: openapi.yaml is out of date. Run: node scripts/openapi/generate.mjs"
  echo "and commit the regenerated file."
  git diff -- openapi.yaml | head -n 60
  exit 1
fi
