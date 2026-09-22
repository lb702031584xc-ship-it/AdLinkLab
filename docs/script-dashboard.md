# Phase 8.4.7.1 — Script Dashboard Read API

Read-only Dashboard query APIs for Google Ads Script Integrations.

**Authentication:** `Authorization: Bearer <integration-token>`

Do not put real tokens in docs or logs. Integration Token plaintext is only available at create/rotate.

All endpoints are scoped to the authenticated Integration (tenant + integration isolation). Path `integrationId` must match the token context or the API returns **403**.

## Endpoints

### GET `/api/v1/dashboard/integrations`

Returns a list containing only the authenticated Integration summary.

### GET `/api/v1/dashboard/integrations/:integrationId`

Integration detail + aggregated health + target counts.

### GET `/api/v1/dashboard/integrations/:integrationId/targets`

Script sync targets with ACTIVE UrlVersion desired URL fields (AD authority for Google IDs).

### GET `/api/v1/dashboard/integrations/:integrationId/logs`

Append-only sync logs (paginated).

Query:

| Param | Default | Rules |
|-------|---------|-------|
| `page` | `1` | integer ≥ 1 |
| `pageSize` | `20` | integer 1–100 |

Response includes `items`, `page`, `pageSize`, `total`, `hasNext`.

### GET `/api/v1/dashboard/summary`

Compact summary + up to 10 recent logs.

## Secrets never returned

- `token` / `tokenHash` / `tokenPrefix` / `tokenKeyId`
- `pepper`
- `oauthCredentialRef` / OAuth tokens
- Authorization headers / Bearer values
- raw sync payloads

## Read-only

GET Dashboard APIs do not mutate UrlVersion, appliedVersion, ScriptSyncLog, SyncJob, or UCR.
(Integration auth may still update `lastSeenAt`.)

## Phase 8.4.7.2 — Web UI

Route: `/dashboard`

Server-side env (never `NEXT_PUBLIC_*` for secrets):

- `NEXT_PUBLIC_API_BASE_URL` — API origin
- `ADLINKLAB_INTEGRATION_TOKEN` — server-only Bearer token for Dashboard GET

The browser never receives the Integration Token (Server Components + Server Actions).
