# 监控指标与告警（P2-3）

## 业务指标（`/metrics`，与 HTTP 指标同一端点）

| 指标 | 类型 | 写入点 |
|---|---|---|
| `adlinklab_clicks_total` | counter | `click-ingestion.ts`：新点击落库时 +1（重放不计） |
| `adlinklab_conversions_total` | counter | `conversion-order.ts`：两条新建转化路径各 +1 |
| `adlinklab_killswitch_fired_total` | counter | `kill-switch-worker.ts`：触发时 +1 |
| `adlinklab_duplicate_click_rate` | gauge 0..1 | `killswitch/engine.ts`：P1-24 条件 (6) 每次评估后写入最新重复率 |

指标为进程内存（重启清零），与 HTTP 指标一致。

## `/metrics` 不对外暴露

Traefik 路由（`deploy.sh` 生成 `infra/traefik/routers.yml`）：

- `api` 路由：`Host(domain) && PathPrefix(`/api`)` → API
- `web` 路由：`Host(domain) || Host(www.domain)` → Web

`/metrics` 不匹配 `/api` 前缀，落到 Web 路由（Next.js 404），**不会到达 API**。
如需在服务器内查看指标，在容器内 curl `http://127.0.0.1:3001/metrics`。

## 告警规则（建议在监控系统中配置，基于 `/metrics` / 告警表）

| 规则 | 条件 | 含义 |
|---|---|---|
| 5xx 告警 | 5xx 占比 > 1%，持续 5 分钟 | 服务异常 |
| AI 失败告警 | AI 调用失败率 > 20%（滚动窗口） | 模型/密钥/配额问题 |
| 备份告警 | > 26 小时无成功备份 | 备份 timer 停了（P0-7） |

备份成功以 `backup:list` 的 VERIFIED 记录为准；26 小时 = 每日一次 + 2 小时宽容。
