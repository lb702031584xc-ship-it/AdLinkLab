# 管理员授权机制（§5，B 级 B1–B6）

> 默认关闭。没有任何能力是默认启用的；启用只能来自一条 active 授权。
> 本机制不是绕过白名单的后门：所有强制执行都走授权记录 + 审计；
> 管理员也不能绕过白名单 / 上限 / 过期来强制放行。

## 能力清单

| 能力 | 状态 |
|---|---|
| `tracking-link-resolve`（P2-7 只读解析） | 已实现强制执行（B2） |
| `catalog-sync`（P2-11 商品库同步） | 仅授权记录，**无执行代码** |
| `direct-api-write`（P1-13 直连 API 写入） | 仅授权记录，**无执行代码** |

## 流程

1. **申请**（任何已登录用户）：能力 + 用途 + 白名单 + 证据 + 有效期 + 上限。
   普通用户只有申请入口，没有启用按钮。
2. **审批**（owner / admin，且审批人 ≠ 申请人）：逐项确认（能力、用途、白名单逐个、
   证据完整性、上限、有效期），通过后生成授权。
3. **使用**：每次使用都校验授权有效（active + 未过期 + 未超限 + 白名单包含该值）。
4. **过期**：到期 → expired，不自动续期；到期前 3 天提醒（待实现：通知）。
5. **超限**：自动停用 + 审计 + 管理员通知；重新申请才可恢复，不自动恢复。
6. **吊销**：管理员手动吊销，或违规自动吊销（见下）。

## 硬规则

- **白名单逐个确认**：每个条目必须是具体值；通配符（`*`、`*.example.com`）、
  “全部网站”/“全部”永不匹配、永不通过校验。
- **有效期**：7–90 天，默认 30 天；**无永久授权**。
- **审批人 ≠ 申请人**：自己不能批自己的申请（另一位管理员/owner 审批）。
- **超限**：`usageLimit.maxCalls` 达到 → 自动停用（`stopped_limit`）+ 审计。
- **违规吊销**：超白名单使用 / 平台警告 / 限流 / 封号风险 / 绕过尝试 /
  证据伪造或过期 / 政策收紧 → 自动吊销 + 通知管理员与申请人，能力回到默认关闭。
- **重新申请封锁**：被吊销者 90 天内不得就同一能力重新申请（owner 可例外缩短）。
- **审计**：申请、审批、拒绝、吊销、自动停用、违规吊销全部写 `admin_grant_audits`，
  追加式，成员不可删除。

## §5.3 证据清单（按能力）

申请时 `evidence` 为 JSON 数组，每项至少 `{type, url|text}`：

| 能力 | 证据要求 |
|---|---|
| `tracking-link-resolve` | 域名归属证明（域名管理后台截图/链接）或联盟授权证明；待解析域名在白名单内 |
| `catalog-sync` | 自有授权账号证明 + 联盟官方 API 授权证明（账号归属截图、联盟授权链接）；白名单 = 联盟域名/站点域名 |
| `direct-api-write` | MCC 归属证明 + Google Ads Developer Token 证明（TEST/正式）+ 阶段一演练记录链接 |

证据不完整 → 审批应拒绝；证据过期/伪造 → 自动吊销。

## 强制执行点

- P2-7 只读解析：`requireActiveGrant(prisma, {capability: "tracking-link-resolve", whitelistValue: domain})`
  —— 自有域名（AI 设置 `ownedDomains`）或有效授权白名单，二者居其一；否则 403。
- 未来新增执行代码时，必须同样走 `requireActiveGrant`，不得自行放行。

## API

- `POST /api/v1/admin/grants/apply` — 申请
- `GET /api/v1/admin/grants/applications/mine` — 我的申请
- `GET /api/v1/admin/grants/applications` — 管理员：全部申请
- `GET /api/v1/admin/grants` — 管理员：全部授权
- `POST /api/v1/admin/grants/applications/:id/approve` — 审批通过
- `POST /api/v1/admin/grants/applications/:id/reject` — 拒绝
- `POST /api/v1/admin/grants/:id/revoke` — 吊销（需 reason）
- `GET /api/v1/admin/grants/audits` — 管理员：审计列表

页面：`/admin/grants`。
