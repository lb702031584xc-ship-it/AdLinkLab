# Phase 8.4.9 — Script Integration Admin UX

Admin surfaces for managing **GoogleAdsScriptIntegration** without reviving legacy Task / proxy / cloaking product patterns.

## Auth

| Surface | Credential |
|---------|------------|
| Admin API `/api/v1/admin/script-integrations/*` | **Tenant API Key** (`x-api-key` / Bearer) |
| Script Config / Sync / Generator (runtime) | **Integration Token** (`Authorization: Bearer`) |
| Dashboard read (8.4.7.2) | Integration Token (`ADLINKLAB_INTEGRATION_TOKEN`) |

Integration Token **cannot** create another Integration.

Web Admin uses server-only `ADLINKLAB_API_KEY` (never `NEXT_PUBLIC_*`).

## Admin API

| Method | Path |
|--------|------|
| GET/POST | `/api/v1/admin/script-integrations` |
| GET | `/api/v1/admin/script-integrations/:id` |
| POST | `.../rotate-token` · `.../revoke` · `.../disable` · `.../enable` |
| GET/POST | `.../targets` |
| DELETE | `.../targets/:targetId` |
| POST | `.../generate-script` (body `{ token }` — operator-supplied plaintext) |

Create / rotate responses return **plaintext token once**. GET never returns `token` / `tokenHash` / `tokenKeyId`.

## Targets

Client submits `{ entityType: "AD", entityId }` only. Server derives `googleAdId` from **Ad**. Desired version is always read from **ACTIVE UrlVersion**.

## Generate Script

Reuses `ScriptGeneratorService` / `buildGoogleAdsScriptSource` (8.4.6). Source is **not** persisted. UI warns that source embeds a credential.

## UCR vs Script

| | UCR (UrlChangeRequest) | Script Integration |
|--|------------------------|--------------------|
| Role | Server-side / lab URL change workflow | Google Ads Script apply + report |
| Desired URL | Writes/activates **UrlVersion** | Reads **ACTIVE UrlVersion** |
| Applied | N/A (version status) | `ScriptSyncTarget.appliedVersion` |
| Logs | SyncJob | ScriptSyncLog |

Script does **not** create UCR. UCR does **not** use ScriptSyncLog as URL authority.

## Scheduler

Google Ads Scripts platform controls `main()` cadence. This lab does **not** invent next-execution times, 5-minute task polls, or URL disguise rotators.

## Forbidden

No Task model, apiAuthcode, gettemplate, proxy/UA/Referer spoofing, cloaking, fake traffic.
