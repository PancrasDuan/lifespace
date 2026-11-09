#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

printf '\n配置 LifeSpace 本地任务来源\n\n'
printf '请打开 Supabase 项目设置的 API Keys 页面，复制已有的服务端 secret key 或 legacy service_role。\n'
printf '密钥只写入本项目的 .dev.vars，不会发送到 GitHub 或打印到终端。\n'
printf '页面：https://supabase.com/dashboard/project/zvdcjzjfhkjasikchceo/settings/api-keys\n\n'
printf '粘贴密钥（输入隐藏）：'
IFS= read -r -s supabase_key
printf '\n'
trap 'unset supabase_key' EXIT
if [[ ! "$supabase_key" =~ ^(sb_secret_|eyJ)[A-Za-z0-9._-]+$ ]]; then
  printf '输入不是服务端密钥，未修改配置。\n' >&2
  exit 1
fi
printf '%s' "$supabase_key" | python3 -c '
from pathlib import Path
import sys, os
p = Path(".dev.vars")
lines = p.read_text().splitlines() if p.exists() else []
lines = [line for line in lines if not line.startswith("SUPABASE_SECRET_KEY=")]
lines.append("SUPABASE_SECRET_KEY=" + sys.stdin.read())
p.write_text("\n".join(lines) + "\n")
os.chmod(p, 0o600)
'
printf '已保存 .dev.vars。请重新启动 npm run dev，并刷新今日待办。\n'
