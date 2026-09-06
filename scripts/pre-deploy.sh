#!/usr/bin/env bash
# 发版闸门包装：调 Python 脚本（主逻辑在 .py 里）。这样避免 bash 的字符串编码坑。
# 用法：git push 前执行；或挂到 git pre-push hook 自动跑。
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 scripts/pre-deploy.py
