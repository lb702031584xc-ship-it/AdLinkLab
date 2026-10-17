# 备份自动化（P0-7）

定时自动备份 + 异地拷贝，只交付脚本与文档；不在脚本里写任何真实主机 / IP / 密钥。

## 脚本

| 文件 | 用途 |
|---|---|
| `infra/backup/backup-auto.sh` | 定时入口：`backup:create` → `backup:verify` → `backup:cleanup`（现有 retention）→ 若 `BACKUP_RSYNC_DEST` 非空则 `rsync` 异地拷贝 |
| `infra/backup/adlinklab-backup.service` | systemd service（`Type=oneshot`） |
| `infra/backup/adlinklab-backup.timer` | systemd timer（每日一次，`OnCalendar=daily`，`Persistent=true`） |

脚本全程带时间戳日志；任一步失败（包括 rsync 失败）都非零退出并写日志。
异地拷贝只追加/同步备份文件，不用 `--delete`（不让异地副本反向删除本地）。

## 在 VPS 上启用 timer

```bash
# 1) 把仓库里的单元文件复制到 systemd 目录，并把 ExecStart 里的
#    /opt/adlinklab 改成服务器上的实际仓库检出路径
sudo cp infra/backup/adlinklab-backup.{service,timer} /etc/systemd/system/
sudo nano /etc/systemd/system/adlinklab-backup.service   # 改 ExecStart 路径

# 2) 环境变量文件（不存在时忽略；切勿把密钥写进单元文件）
sudo mkdir -p /etc/adlinklab
sudo nano /etc/adlinklab/backup.env
# 内容示例（按需填写，值全部由部署方提供）：
# DATABASE_URL=...
# ADLINKLAB_BACKUP_DIR=/opt/adlinklab/packages/database/backups
# ADLINKLAB_BACKUP_KEEP=5
# BACKUP_RSYNC_DEST=user@backup-host:/srv/adlinklab-backups
#   （或本地挂载路径，如 /mnt/offsite/adlinklab-backups）

# 3) 启用并立即试跑一次
sudo systemctl daemon-reload
sudo systemctl enable --now adlinklab-backup.timer
sudo systemctl start adlinklab-backup.service
sudo systemctl status adlinklab-backup.service
sudo journalctl -u adlinklab-backup.service -n 100
sudo systemctl list-timers adlinklab-backup.timer

# 4) 验证首跑成功：日志应含 step=create ok / step=verify ok / step=cleanup ok，
#    且备份目录出现新的 VERIFIED 备份（状态可用 backup:list 查看）：
#    pnpm --filter @adlinklab/database backup:list
```

> 注意：`DATABASE_URL` 由 `backup.env` 提供，与仓库现有 backup CLI（`packages/database/scripts/backup.mts`）的读取方式一致。备份目录口径与 `packages/database/src/backup/paths.ts` 一致：`ADLINKLAB_BACKUP_DIR` 优先，否则为 `packages/database/backups`。

## 配置 BACKUP_RSYNC_DEST

- 留空：跳过异地拷贝，只做本地备份 + 校验 + retention 清理。
- 设为 `user@host:/path`：通过 SSH 做异地拷贝。目标主机需预先配置好免密登录（部署方自行配置，脚本不处理密钥）。
- 设为本地挂载路径（如对象存储挂载目录 / 另一块盘）：直接 rsync 到该目录。
- rsync 失败 → 脚本非零退出，timer 单元标记 failed，可在 service 上配 `OnFailure=` 接告警。

## cron 备选（不用 systemd 时）

```cron
# 每日 03:00 跑一次；路径按实际检出位置修改
0 3 * * * /usr/bin/bash /opt/adlinklab/infra/backup/backup-auto.sh >> /var/log/adlinklab-backup.log 2>&1
```

## 保留策略（沿用现有 retention）

`backup:cleanup` → `cleanupRetention()`（`packages/database/src/backup/retention.ts`）：

- 只清理状态为 `VERIFIED` 的备份，默认保留最近 **5** 个（`ADLINKLAB_BACKUP_KEEP` 可改，最小为 1）。
- 永不删到零个 `VERIFIED` 备份：若总数 ≤ 保留数则不删。

## 每月恢复演练（复用 restore-verify）

每月一次，验证备份真的能恢复。演练必须恢复到**空的演练库**，绝不指向生产库（`restoreVerify` 内置生产库保护，见 `packages/database/src/backup/restore-verify.ts`）。

```bash
# 1) 选一个最近的已校验备份
ls -t packages/database/backups/*.json | head -5

# 2) 准备一个空的演练数据库（示例名仅为示意，由演练方提供连接串）
#    演练库连接串放在 ADLINKLAB_BACKUP_RESTORE_DATABASE_URL

# 3) 恢复演练（底层即 restoreVerify：pg_restore 到演练库 + 核心表行数校验）
ADLINKLAB_BACKUP_RESTORE_DATABASE_URL='<演练库连接串>' \
  pnpm --filter @adlinklab/database backup:restore-test '<backupId>'

# 4) 演练通过后删除演练库，并把结果（备份 ID、日期、结论）记入运维记录
```

演练失败 → 备份链不可信：立即排查（先看 `backup:verify <backupId>` 与最近的 timer 日志），在修好之前不要删除任何旧备份。
