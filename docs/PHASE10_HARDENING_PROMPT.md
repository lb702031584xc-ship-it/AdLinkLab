# Phase 10 — Production Hardening Baseline

你现在执行 AdLinkLab：

# Phase 10 — Production Hardening Baseline

本阶段唯一目标：

消除 Phase 9.7 CLOSED WITH LIMITATIONS 中与**生产边界硬化**相关的缺口，
在不破坏 Phase 8/9 权威链与业务语义的前提下，完成最小可验收硬化。

当前基线：

* Phase 9 CLOSED WITH LIMITATIONS
* ACTIVE UrlVersion = SOLE Desired Authority
* ScriptSyncTarget.desiredVersion 非权威
* Queue Catalog Honesty：urlChange / conversionUpload = IMPLEMENTED；其余 PLANNED
* Production AUTH_MODE 必须显式 api_key（fail-closed）
* Google Ads API mutation 禁止；默认 mock provider
* 生产 migration = prisma migrate deploy

本阶段只实施 **P10 Hardening**。

==================================================
一、严格执行模式
==================================================

必须：

READ → AUDIT → IMPLEMENT → TEST → REPORT

重要：

1. 先 READ-ONLY discovery。discovery 完成前禁止修改文件。
2. 只实施本阶段范围；不要顺手实现 PLANNED Worker。
3. 不要实现 Google Ads API reads/mutations。
4. 不要改变 ACTIVE UrlVersion / UCR / Script Integration protocol。
5. 不要改变 Queue names / BullMQ semantics（除健康暴露与 hardening 相关配置）。
6. 不要创建 Prisma migration；禁止 prisma migrate dev / db push / migrate reset。
7. 不要修改业务数据模型。
8. 不要实现 cloaking / 伪造流量 / 检测规避 / proxy 旋转等禁止机制。

==================================================
二、本阶段必须解决的 Limitations（来自 Phase 9.7）
==================================================

必须处理（代码/配置层）：

L1. CORS `origin: true` → 生产应使用明确 allowlist（可配置）
L2. 无 HTTP rate limiting → 为管理 API 与 Script API 增加最小限流
L3. Traefik `--api.insecure=true` → lab 可用但需 fail-closed / 可关闭 / 文档化；生产默认更安全
L4. Compose API healthcheck 使用 `/health` → 改为 `/health/ready`（或等价 readiness）
L5. Worker container healthcheck 过浅 → 至少验证 worker 进程/入口健康语义，不伪造业务 ready
L6. `/health` 的 `phase` 字段仍为 `8.4.9` → 更新为诚实的 Phase 标记（如 `9.7`/`10`）
L7. 文档滞后 → 最小更新：ARCHITECTURE 或 README 中 Phase 9/10 生产基线说明

可选（环境允许才执行；不可伪造）：

E1. Docker compose config / smoke（daemon 可用时）
E2. 真实 backup restore-test（pg_dump/pg_restore 可用时）

环境不可用时：

报告 LIMITATION，不要伪造 PASS。

==================================================
三、明确不在本阶段
==================================================

禁止：

* 实现 googleAdsSync / clickProcessing / analyticsAggregation Worker
* 把 PLANNED 标成 IMPLEMENTED
* Google Ads live API / mutation
* Desired Authority 重新设计
* UCR FSM 变更
* Script Token/HMAC 协议变更
* Backup 对象存储（S3 等）
* 新业务功能 / Dashboard 大改版
* 无批准 migration

==================================================
四、READ-ONLY DISCOVERY（第一步）
==================================================

搜索并审计：

* apps/api/src/app.ts（cors）
* rate limit 相关依赖与中间件（确认当前不存在）
* docker-compose.yml（traefik、healthcheck、worker）
* apps/api health / ready routes
* observability readiness
* .env.example
* docs/ARCHITECTURE.md / README
* Phase 9.7 已记录 limitations

输出：

| Limitation | Current Evidence | Proposed Minimal Fix | Risk |

discovery 完成前禁止改文件。

==================================================
五、CORS（L1）
==================================================

实现可配置 CORS：

* 环境变量例如：`CORS_ORIGINS`（逗号分隔）
* production：未配置或 `*` 必须 FAIL CLOSED 或拒绝启动（与项目 fail-closed 风格一致）
* test/dev：可保持宽松以兼容现有测试
* 不得默认 `origin: true` 用于 production

增加测试：

* production + missing CORS_ORIGINS → fail closed（或项目选定的安全默认）
* allowlist 匹配 / 不匹配

==================================================
六、Rate Limiting（L2）
==================================================

最小限流（优先复用现有 Fastify 生态，如 @fastify/rate-limit）：

至少区分：

* 管理 API（api_key）
* Script endpoints（`/api/v1/script/*`）

要求：

* 可通过环境变量配置阈值
* 超限返回明确 429
* 不在响应/日志中泄露 secrets
* 测试覆盖：超限 → 429；正常请求不受破坏性影响

不要引入复杂 WAF / 分布式限流平台（除非已有）。

==================================================
七、Traefik / Compose（L3–L5）
==================================================

L3 Traefik：

* 生产更安全的默认：避免无必要的 insecure dashboard 暴露
* 若 lab 仍需本地 dashboard：限制为 loopback + 明确 env 开关（例如 `TRAEFIK_DASHBOARD=1`）
* 更新 .env.example 说明

L4 API healthcheck：

* 将 compose api healthcheck 从 `/health` 改为 `/health/ready`
* 确认 readiness 在 prisma+redis 生产配置下有意义

L5 Worker healthcheck：

* 在不新增复杂 HTTP server 的前提下，增强可验证性
* 允许：检查 dist/worker 入口存在 + 进程存活；或最小本地就绪标记
* 禁止：伪造 “queues healthy” 若 Worker 未真正注册

不要为了 healthcheck 重写整个 worker 架构。

==================================================
八、Health phase stamp（L6）
==================================================

更新 API health 响应中的 phase 字段，使其反映当前生产基线（建议 `10` 或 `9.7+10` 中与项目风格一致的单一字符串）。

同步相关测试断言。

==================================================
九、文档（L7）
==================================================

最小文档更新（不要写长篇重写）：

* README 或 docs/ARCHITECTURE.md 增加 Phase 9/10 生产基线小节：
  - AUTH fail-closed
  - ACTIVE UrlVersion authority
  - Queue Catalog IMPLEMENTED vs PLANNED
  - Backup/restore safety
  - CORS / rate limit env
  - compose healthcheck 使用 ready

==================================================
十、架构保护（必须）
==================================================

确认不变：

* ACTIVE UrlVersion sole Desired Authority
* ScriptSyncTarget.desiredVersion 非权威
* UCR FSM
* Script Integration auth
* Queue names
* IMPLEMENTED queues 仅 urlChange + conversionUpload
* Google Ads mutation forbidden
* Backup restore safety gates
* Tenant isolation
* No new Desired State entity

==================================================
十一、测试要求
==================================================

至少：

1. CORS production fail-closed / allowlist
2. Rate limit 429
3. Health phase stamp
4. Compose 文件断言：api healthcheck 使用 ready；traefik insecure 受开关约束
5. 现有 Phase 8.4.x / 9.2 / 9.3 / 9.4 / 9.5 / 9.6 回归不破坏
6. typecheck / lint / build

环境：

* Docker 可用 → `docker compose config`（只读验证）；可选 smoke
* Docker 不可用 → 报告 NOT RUN，不伪造
* pg tools 不可用 → backup live restore NOT RUN

==================================================
十二、禁止事项
==================================================

* 不要为了变绿删除/弱化测试
* 不要新增 PLANNED Worker
* 不要 migration
* 不要改 Desired Authority
* 不要 Google Ads mutation
* 不要大重构 / 无关格式化全库

==================================================
十三、FINAL REPORT 格式
==================================================

# Phase 10 Production Hardening

## 1. Status
PASS / PASS WITH ENVIRONMENT LIMITATION / FAIL

## 2. Limitations Addressed
逐项 L1–L7：FIXED / DEFERRED（原因）

## 3. Files Modified

## 4. CORS

## 5. Rate Limiting

## 6. Compose / Traefik / Healthchecks

## 7. Documentation

## 8. Tests
精确数字：API / database / domain / typecheck / lint / build / Docker

## 9. Architecture Preservation

## 10. Deferred Findings

## 11. Phase 10 Status
COMPLETE / NOT COMPLETE

==================================================
十四、开始命令
==================================================

现在开始。

第一步：READ-ONLY discovery。

不要修改文件。

审计 CORS / rate limit / compose healthchecks / traefik / health phase / docs。

然后只实施 Phase 10 Hardening。

不要进入 Worker 实现阶段。
不要实现 Google Ads API。
