import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { TenantA } from "@adlinklab/database";
import { FIXTURE_API_KEYS } from "./auth/api-keys.js";
import { createAuthContext } from "./auth/tenant.js";

const TENANT_A = TenantA.id;

describe("API Phase 0 / 8.4.9 smoke", () => {
  it("GET /health returns ok with phase 10", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "ok",
      phase: "10",
      persistence: "memory",
      authMode: "disabled",
      queueMode: "off",
      worker: { enabled: false, status: "stopped" },
    });
    await app.close();
  });

  it("lists seeded campaigns for tenant", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/campaigns",
      headers: { "x-tenant-id": TENANT_A },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; items: unknown[] };
    expect(body.total).toBeGreaterThan(0);
    await app.close();
  });

  it("lists url versions with separated url fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/url-versions",
      headers: { "x-tenant-id": TENANT_A },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{
        finalUrl: string;
        trackingTemplate?: string;
        customParameters: Record<string, string>;
      }>;
    };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((i) => i.finalUrl.includes("example.com"))).toBe(true);
    expect(
      body.items.some((i) => i.customParameters._clickid === "abc123")
    ).toBe(true);
    await app.close();
  });

  it("GET google-accounts/:id/status is read-only and tenant-scoped", async () => {
    const app = await buildApp();
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/google-accounts",
      headers: { "x-tenant-id": TENANT_A },
    });
    expect(list.statusCode).toBe(200);
    const accountId = (
      list.json() as { items: Array<{ id: string; tenantId: string }> }
    ).items[0]!.id;
    const tenantId = (
      list.json() as { items: Array<{ tenantId: string }> }
    ).items[0]!.tenantId;

    const ok = await app.inject({
      method: "GET",
      url: `/api/v1/google-accounts/${accountId}/status`,
      headers: { "x-tenant-id": tenantId },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      id: accountId,
      mutationsEnabled: false,
      liveApiEnabled: false,
      oauthCredentialRefPresent: true,
      phase: "2",
    });
    expect(JSON.stringify(ok.json())).not.toMatch(
      /client_secret|refresh_token|access_token/i
    );

    const cross = await app.inject({
      method: "GET",
      url: `/api/v1/google-accounts/${accountId}/status`,
      headers: { "x-tenant-id": "00000000-0000-4000-8000-000000000099" },
    });
    expect(cross.statusCode).toBe(404);
    await app.close();
  });
});

describe("Phase 8.2 auth + public tracking", () => {
  it("rejects management API without tenant when auth disabled", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/campaigns" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "VALIDATION_ERROR" });
    await app.close();
  });

  it("AUTH_MODE=api_key requires API key", async () => {
    const auth = createAuthContext({ AUTH_MODE: "api_key" });
    const app = await buildApp(undefined, auth);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/campaigns",
      headers: { "x-tenant-id": TENANT_A },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "UNAUTHORIZED" });
    await app.close();
  });

  it("AUTH_MODE=api_key accepts fixture key and binds tenant", async () => {
    const auth = createAuthContext({ AUTH_MODE: "api_key" });
    const app = await buildApp(undefined, auth);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/campaigns",
      headers: { "x-api-key": FIXTURE_API_KEYS.tenantA.key },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ tenantId: string }> };
    expect(body.items.every((c) => c.tenantId === TENANT_A)).toBe(true);
    await app.close();
  });

  it("AUTH_MODE=api_key forbids mismatched x-tenant-id", async () => {
    const auth = createAuthContext({ AUTH_MODE: "api_key" });
    const app = await buildApp(undefined, auth);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/campaigns",
      headers: {
        "x-api-key": FIXTURE_API_KEYS.tenantA.key,
        "x-tenant-id": FIXTURE_API_KEYS.tenantB.tenantId,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "FORBIDDEN" });
    await app.close();
  });

  it("GET /api/v1/t/:publicId works without tenant header", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/t/trk_demo_001?gclid=TEST_GCLID_PUBLIC",
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^https?:\/\//);
    await app.close();
  });

  it("jobs and audit-logs are tenant-scoped", async () => {
    const app = await buildApp();
    const jobs = await app.inject({
      method: "GET",
      url: "/api/v1/jobs",
      headers: { "x-tenant-id": TENANT_A },
    });
    expect(jobs.statusCode).toBe(200);
    const jobItems = (jobs.json() as { items: Array<{ tenantId: string }> })
      .items;
    expect(jobItems.every((j) => j.tenantId === TENANT_A)).toBe(true);

    const audits = await app.inject({
      method: "GET",
      url: "/api/v1/audit-logs",
      headers: { "x-tenant-id": TENANT_A },
    });
    expect(audits.statusCode).toBe(200);
    await app.close();
  });
});
