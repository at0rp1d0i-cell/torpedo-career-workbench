#!/usr/bin/env bash
# 仓库验证入口。命令集来自 AGENTS.md §8；改完代码跑 `bash scripts/verify.sh`。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0

echo "== node --check =="
for f in \
  scripts/workbench.mjs \
  scripts/workbench-data.mjs \
  scripts/interview-process.mjs \
  scripts/dashboard.mjs \
  scripts/calendar.mjs \
  scripts/jd-intake.mjs \
  scripts/retro.mjs \
  scripts/debrief-workflow.mjs
do
  node --check "$f" || fail=1
done

echo "== node --test =="
node --test scripts/workbench.test.mjs || fail=1

echo "== workbench validate =="
node scripts/workbench.mjs validate || fail=1

exit "$fail"
