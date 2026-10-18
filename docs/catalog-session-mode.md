# 商品库同步 · 登录态(session)模式说明

> 后端已实现：双模式（官方 API / 登录态）商品库同步 + 筛选评分 + 黑白名单。
> 前端页面不在本次范围。

## 1. ToS 风险提示（必读）

**登录态采集风险提示：使用登录态（Cookie）自动采集商品数据，可能违反
YeahPromos/PartnerBoost 服务条款中关于自动化访问的条款，存在账号被警告、
限流或封禁的风险。请仅采集您自己账号可见的商品数据，不要高频抓取。
如该联盟日后提供官方商品 API，请优先切换为官方 API 模式。
继续即代表您已了解并自行承担该风险。**

补充说明：

- ⚠️ **Amazon Associates（极高）**：Amazon Associates Operating Agreement
  明确禁止自动化抓取/采集行为。使用登录态自动采集 Amazon 商品数据，
  账号被警告、限流或封禁的风险极高，且可能影响佣金结算。
  **强烈建议仅使用官方 Product Advertising API（PA-API），不要启用 session 模式。**
- 其他联盟（Awin / CJ / ShareASale / Rakuten / FlexOffers / Impact / YeahPromos /
  PartnerBoost）：中等级——各联盟 ToS 普遍限制自动化访问，存在警告/限流/封号风险。

合规边界（代码硬约束）：只读采集（仅 GET 商品列表，不提交表单、不模拟点击）、
固定 UA、无代理池/UA 轮换、页间延迟（默认 3 秒）、429 直接降级不重试、
Cookie 只进请求头且绝不记日志。

## 2. 登录态获取指引

1. 在**你自己的浏览器**中登录 YeahPromos / PartnerBoost（或其他联盟）的 publisher 后台。
2. 按 F12 打开开发者工具 → Network 面板 → 刷新商品列表页。
3. 找到任一请求的 Request Headers → 复制 `Cookie` 的**完整值**。
4. 粘贴到商品库设置页的"登录态 Cookie"输入框并保存。
5. 要求：**只要 Cookie，不要账号密码；不要在聊天里发 Cookie**（聊天记录不是安全通道）。

Cookie 以 AES-256-GCM 加密存储（`session_ref`），明文永不记日志、永不返回前端。

## 3. B6 授权申请指引

商品库同步受 §5 管理员授权机制管控（默认关闭）：

1. 打开 `/admin/grants` → 申请授权。
2. capability 选择 **`catalog-sync`**。
3. 白名单填写联盟 kind（精确匹配，禁通配符）：`yeahpromos` / `partnerboost` /
   `awin` / `cj` / `shareasale` / `rakuten` / `flexoffers` / `impact` / `amazon`。
   每个联盟的 session 模式**单独审批、单独白名单、单独上限**。
4. 等待管理员审批（审批人 ≠ 申请人）。无授权时同步/保存登录态/切换模式接口返回 403。

## 4. 使用流程

1. 联盟管理页创建网络（kind 选择如 `yeahpromos`）。
2. 申请并获得 `catalog-sync` 授权（白名单含该 kind）。
3. 如需 session 模式：`PUT /api/v1/networks/:id/sync-mode`
   `{syncMode: "session", confirmTosRisk: true}`（必须显式确认 ToS 风险）。
4. 保存登录态：`POST /api/v1/catalog/session` `{networkId, sessionCookie}`。
5. 同步：`POST /api/v1/catalog/sync` `{networkId}`。
6. 在商品库列表查看/筛选，或按筛选预设自动建 Offer。

## 5. 各联盟 session 模式状态表

| 联盟 | kind | 状态 | 说明 |
|---|---|---|---|
| PartnerBoost | `partnerboost` | ✅ 完整实现（含可配置解析） | 官方 API 线路保留；session 为第二线路，列表路径可配（默认占位，待真实账号确认） |
| YeahPromos | `yeahpromos` | ✅ 完整实现（含可配置解析） | 仅 session 模式（官方商品 API 尚未确认，不硬编码猜测端点）；JSON `data.list` 防御式解析 + HTML 表格最小回退 |
| Awin | `awin` | 🛠 脚手架：待真实账号验证 | 解析模板未验证，结构对不上时抛明确错误并降级 |
| CJ Affiliate | `cj` | 🛠 脚手架：待真实账号验证 | 同上 |
| ShareASale | `shareasale` | 🛠 脚手架：待真实账号验证 | 同上 |
| Rakuten Advertising | `rakuten` | 🛠 脚手架：待真实账号验证 | 同上 |
| FlexOffers | `flexoffers` | 🛠 脚手架：待真实账号验证 | 同上 |
| Impact | `impact` | 🛠 脚手架：待真实账号验证 | 同上 |
| Amazon | `amazon` | 🛠 脚手架：待真实账号验证（⚠️ ToS 极高风险，强烈建议只用 PA-API） | 占位模板实际不可用；Associates 后台无公开商品列表 JSON 接口是已知事实 |

现实约束：我们没有这些联盟 publisher 后台的真实页面结构可验证（没登录过）。
各脚手架的 baseUrl/列表路径/字段映射均为**可配置模板**，需用户用真实账号验证后微调；
解析失败时走统一降级（`sessionStatus=FAILED` + 审计，不死循环、不伪造数据）。

## 6. 新增联盟 session 模式接入步骤

1. 新建 `apps/api/src/networks/xxx-session-adapter.ts`，`XxxSessionAdapter extends TemplateSessionAdapter`。
2. 实现：`sessionKind`（与官方 kind 一致）、`sessionDisplayName`、
   `defaultSessionBaseUrl`、`defaultSessionListPath`（TODO 占位 + 注释）、
   `listTemplate`（`verified: false` 起步）、`mapSessionItem`（防御式字段映射）。
3. 文件头部带 ToS 风险注释（按该联盟风险等级：Amazon 用红字极高警告）。
4. 注册到 `apps/api/src/networks/index.ts` 的 `SESSION_ADAPTERS`（`getSessionAdapter`）。
5. 官方适配器类加 `supportsModes = ["api", "session"] as const`。
6. 测试：未验证端点抛 `SESSION_TEMPLATE_UNVERIFIED` 明错（mock fetch），
   **不要为猜测的页面结构写"验证通过"的假测试**。
7. 本文档状态表更新。

## 7. 黑白名单机制

统一模块，实体类型 = 商家(merchant) / 账号(network_account) / 商品(product) / Offer(offer)，
渠道 = 返利网(cashback) / 联盟(affiliate) / 亚马逊(amazon)，三渠道各自独立。
（业务白名单与 B6 审批白名单是两套，不要混。）

### 自动识别信号

- **联盟账号**：API 明确 403（账号受限/权限回收）→ 立即进黑名单；
  session 401/登录页过期连续 3 次 → 自动进黑名单。
  之后该账号的同步任务自动跳过（`{skipped: true}` + 审计 `CATALOG_SYNC_SKIPPED_BLACKLIST`）。
- **商品**：某次同步中之前存在但本次目录消失 → 自动进黑名单（`sync_disappeared`）。
- **Offer**：Google Ads 政策拒登 / Preflight 明确 blocked（政策原因）→ 进黑名单。
  接入点：`services/catalog-blacklist.ts` 的 `blacklistOfferForPolicyViolation()`。
  现状：preflight 路由是只读检查，无统一"拒登写入"位置；任何未来记录政策拒登的流程
  （定时拉取 Google Ads 政策状态、人工标记等）都应调用该函数。
  批量建 Offer 前也会检查（`POST /api/v1/catalog/blacklist/check-offer`）。
- **商家**（按渠道独立评估，`POST /api/v1/catalog/merchants/evaluate`，分析自有数据，不要求 B6）：
  - **不付钱**：PENDING 超 `nonPaymentDays`（默认 45 天）未付款，或 CANCELLED/REFUNDED 占比过高 → `non_payment`。
  - **扣量嫌疑**：每 `shavePeriodDays`（默认 7 天）一周期，对比自有转化（归因到该商家的
    Conversion）与网络侧同步订单数；**连续 `shavePeriods`（默认 3）个周期**
    扣量率超 `shaveThresholdPct`（默认 30%）→ `shave_suspected`。
    只做"嫌疑"标记 + 证据展示（两边数字并列存进信号表），单次波动不进。
    现实：当前 Order 写入链路均要求 clickId，无"网络侧同步订单"写入来源，
    因此该检查现阶段记 `insufficient_data`、不做判定；将来接入网络订单同步后自动生效。
  - **跑不正**：`roasDays`（默认 14 天）窗口内广告花费（LaunchArchive.spend 按 offer→merchant
    归因）> 0 且佣金/花费 < `roasThreshold`（默认 0.9）→ `unprofitable_roas`。
  - 每次自动进黑名单写审计（`MERCHANT_BLACKLIST_AUTO_ADDED`，含 channel/merchantId/reason/evidence）。
  - 信号历史：`GET /api/v1/catalog/merchants/signals?merchantId=&channel=`（证据展示）。

### 自动跳过

- 同步引擎跳过黑名单账号；筛选引擎排除黑名单商品（`scoreProduct` 前过滤）；
  黑名单商家的商品不参与推荐、不自动建 Offer；
  批量建 Offer 跳过黑名单商品并返回 `skippedBlacklist` 清单。

### 白名单

- 手动管理为主：`POST /api/v1/catalog/whitelist` 添加，`DELETE /:id` 移除，
  `POST /:id/confirm` 确认建议。
- 自动建议：同步完成后，对"连续 3 期同步正常出现"的商品生成 `source="suggested"`
  的建议条目——**只建议，不自动加入**，需用户确认。有出单数据的以后再接（TODO）。
- 筛选/排序：白名单商品推荐排序时置顶（score 不变，加 `whitelisted` 标记）；
  自动建 Offer 时优先从白名单取 Top-N。

### 移除 + 观察期

- `DELETE /api/v1/catalog/blacklist/:id`：**仅管理员**，Body `reason` 必填；
  软删除（`status="removed"`），`observationUntil = now + observationDays`（默认 30 天）。
- 观察期内：中性对待（不拉黑、不加白，数据重新累计，不直接恢复白名单）；
  商品推荐排序时观察期商家的商品不置顶。
- 手动复检：`POST /api/v1/catalog/blacklist/:id/recheck`（返回验证结果，不自动移除）。

## 佣金门槛（$8）：两道门共用同一常量

单次转化佣金低于 $8 的 offer/商品判定为"不值得测试"（保本 CPC 没有操作空间）。
阈值定义在 `packages/shared/src/commission-gate.ts` 的 `MIN_COMMISSION_USD`（默认 8），
三处共用同一常量 + 同一 AI 设置覆盖项（`ai_settings.minCommissionUsd`，无配置时用默认）：

1. **第一道 · 商品库入库过滤**（`catalog-sync.ts` §5）：同步拉取的商品在入库前先过门槛——
   固定佣金取实报金额（reported），百分比佣金按"价格 × 佣金率"估算（estimated），
   算不出金额的按"未知"处理**不拦截**，只拦"明确低于 $8"的。被拦的商品不入库、
   只计数（`skippedLowCommission`），明细不进库，审计日志记总数与来源分布。
2. **第二道 · 库内筛选预设**（`catalog-screening.ts` P1-30）：`DEFAULT_PRESET.minCommissionAmount`
   默认引用同一常量（租户可在商品库设置页覆盖）。入库时已拦掉 <$8 的，库内默认不再更严。

另两处判定同样引用该常量（经济性 stop，与政策禁止区分）：
- 一键推演综合决策（`blueprint.ts` §7）：payout < 门槛 → verdict `stop`；
- 工作表盈利腿（`pipeline.ts` `synthesizeDecision`）：commission < 门槛 → 最弱档 `DO_NOT_RUN`。

## 登录账号（session 模式）

每个 session 模式的联盟账号可配置登录账号：`session_username`（明文可显示）、
`session_password_ref`（AES-256-GCM 加密，复用 `network-crypto`，绝不明文落库/日志）、
`session_valid_days`（有效期天数，默认 30，可配 1–365）。

- `last_login_at` 记录上次保存账号/登录态的时间；
  `sessionExpiresAt = lastLoginAt + sessionValidDays`（计算得出，不存库）。
- 同步引擎在 session 模式下先校验有效期：**过期 → 直接跳过该账号同步**，
  红色提示"登录态已过期，请重新登录刷新"，写审计（`CATALOG_SYNC_SKIPPED_EXPIRED`），
  不用过期 session 去撞对方服务器。
- API：`POST /api/v1/catalog/session-credentials`（B6 授权；密码只写不读）；
  `GET /api/v1/networks` 只返回 `sessionUsername` / `sessionPasswordSet`（布尔）/
  `sessionValidDays` / `lastLoginAt` / `sessionExpiresAt`，**永不返回密码及任何可逆字段**。
- Cookie 粘贴方式保留：已有账号密码的用户也可只用 Cookie，不强制二选一。
