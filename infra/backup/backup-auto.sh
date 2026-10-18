#!/usr/bin/env bash
# P0-7 — AdLinkLab 自动备份 + 异地拷贝（定时任务入口）。
#
# 流程：backup:create → backup:verify → backup:cleanup（现有 retention）
#       → 若 BACKUP_RSYNC_DEST 非空，rsync 备份目录到该目标（异地拷贝）。
#
# 不在脚本里写任何真实主机 / IP / 密钥。异地目标只从环境变量
# BACKUP_RSYNC_DEST 读取（例如 user@backup-host:/srv/adlinklab-backups，
# 或本地挂载路径 /mnt/offsite/adlinklab-backups），由部署方在
# EnvironmentFile（/etc/adlinklab/backup.env）或 timer 单元里配置。
#
# 失败语义：任一步失败 → 非零退出并写日志（systemd timer 会记录失败，
# 配合 OnFailure 告警更佳）。rsync 失败同样非零退出。
#
# cron 备选（注释形式，见 docs/backup-automation.md）：
#   0 3 * * * /usr/bin/bash /opt/adlinklab/infra/backup/backup-auto.sh >> /var/log/adlinklab-backup.log 2>&1
set -euo pipefail

log() {
  printf '%s [backup-auto] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
# P0-7 加固：systemd 下 PATH 通常不含 nvm/corepack 路径；pnpm 不在 PATH 时
# 依次尝试 corepack pnpm / npx pnpm，仍找不到才报错（不静默跳过备份）。
if [ -n "${PNPM:-}" ]; then
  PNPM_BIN="${PNPM}"
elif command -v pnpm >/dev/null 2>&1; then
  PNPM_BIN="pnpm"
elif command -v corepack >/dev/null 2>&1; then
  PNPM_BIN="corepack pnpm"
elif command -v npx >/dev/null 2>&1; then
  PNPM_BIN="npx --yes pnpm"
else
  PNPM_BIN=""
fi
[ -n "${PNPM_BIN}" ] || fail "pnpm not found (tried pnpm / corepack pnpm / npx pnpm). Set PNPM env or install pnpm, e.g. corepack enable && corepack prepare pnpm@latest --activate"
PNPM="${PNPM_BIN}"

# 备份目录口径与 packages/database/src/backup/paths.ts 一致：
# ADLINKLAB_BACKUP_DIR 优先，否则为 packages/database/backups。
BACKUP_DIR="${ADLINKLAB_BACKUP_DIR:-${REPO_ROOT}/packages/database/backups}"

log "start repo=${REPO_ROOT} backupDir=${BACKUP_DIR}"

cd "${REPO_ROOT}"

# --- 1) 创建备份 -----------------------------------------------------------
log "step=create"
CREATE_OUT="$("${PNPM}" --filter @adlinklab/database backup:create 2>&1)" \
  || fail "backup:create failed: ${CREATE_OUT}"

# create 输出为 JSON { ok, metadata: { backupId, ... } }；用 node 解析，不依赖 jq。
BACKUP_ID="$(printf '%s' "${CREATE_OUT}" | node -e '
let s = "";
process.stdin.on("data", (c) => { s += c; });
process.stdin.on("end", () => {
  try {
    // pnpm run 会在 JSON 前打印 "> pkg@version script path" 横幅行，且
    // backup:create 输出的是多行 pretty-print JSON，不能对整段 JSON.parse：
    // 从第一个 { 到最后一个 } 截取 JSON 再解析（同时容忍首尾杂行）。
    const j = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
    const id = j?.metadata?.backupId ?? j?.backupId;
    if (typeof id !== "string" || !id) process.exit(2);
    process.stdout.write(id);
  } catch { process.exit(2); }
});')" || fail "cannot parse backupId from backup:create output: ${CREATE_OUT}"
log "step=create ok backupId=${BACKUP_ID}"

# --- 2) 校验备份 -----------------------------------------------------------
log "step=verify backupId=${BACKUP_ID}"
"${PNPM}" --filter @adlinklab/database backup:verify "${BACKUP_ID}" \
  || fail "backup:verify failed for ${BACKUP_ID}"
log "step=verify ok backupId=${BACKUP_ID}"

# --- 3) 按现有 retention 清理 ----------------------------------------------
log "step=cleanup (retention: keep ADLINKLAB_BACKUP_KEEP or default 5 VERIFIED)"
"${PNPM}" --filter @adlinklab/database backup:cleanup \
  || fail "backup:cleanup failed"
log "step=cleanup ok"

# --- 4) 异地拷贝（可选） -----------------------------------------------------
if [ -n "${BACKUP_RSYNC_DEST:-}" ]; then
  command -v rsync >/dev/null 2>&1 || fail "rsync not found but BACKUP_RSYNC_DEST is set"
  [ -d "${BACKUP_DIR}" ] || fail "backup dir missing: ${BACKUP_DIR}"
  log "step=rsync dest=[redacted-destination] (BACKUP_RSYNC_DEST is set)"
  # 只追加/同步备份文件，不用 --delete：异地副本缺失文件不反向删除本地。
  # 目的端路径来自环境变量，脚本本身不写任何真实主机/IP/密钥。
  rsync -a --timeout=600 "${BACKUP_DIR}/" "${BACKUP_RSYNC_DEST}/" \
    || fail "rsync to BACKUP_RSYNC_DEST failed"
  log "step=rsync ok"
else
  log "step=rsync skipped (BACKUP_RSYNC_DEST empty)"
fi

log "done backupId=${BACKUP_ID}"
