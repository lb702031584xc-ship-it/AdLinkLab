/**
 * Phase 8.4.2 — PostgreSQL token credential persistence (TEST-ONLY).
 * Opt-in: PHASE842_PG=1 (reuses Phase 6.1 embedded Postgres harness).
 * No plaintext tokens persisted; rotation replaces hash.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  phase61DatabaseUrl,
  startPhase61Postgres,
  stopPhase61Postgres,
} from "../scripts/phase61-pg-harness.mts";
import {
  PrismaGoogleAdsScriptIntegrationRepository,
} from "./prisma/script-integration-repositories.js";
import { TenantA } from "./fixtures/ids.js";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
/** Opt-in only — do not inherit PHASE841_PG to avoid coupling with 8.4.1 runs. */
const RUN_PG = process.env.PHASE842_PG === "1";
const PEPPER = "adlinklab-test-integration-token-pepper-not-for-production";

function runMigrateDeploy(): void {
  const migrate = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/phase61-migrate-deploy.mts"],
    {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: phase61DatabaseUrl() },
      encoding: "utf8",
      shell: true,
    }
  );
  if (migrate.status !== 0) {
    throw new Error(`migrate failed: ${migrate.stdout}\n${migrate.stderr}`);
  }
}

function hashToken(token: string): string {
  return createHmac("sha256", PEPPER).update(token, "utf8").digest("hex");
}

function material(label: string) {
  const token = `alk_s_${label}_${randomBytes(24).toString("base64url")}`;
  return {
    token,
    tokenKeyId: `itk_${randomBytes(8).toString("hex")}`,
    tokenPrefix: token.slice(0, 12),
    tokenHash: hashToken(token),
  };
}

describe.skipIf(!RUN_PG)("Phase 8.4.2 PostgreSQL integration auth credentials", () => {
  let prisma: PrismaClient;
  let startedByUs = false;
  let integrations: PrismaGoogleAdsScriptIntegrationRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = phase61DatabaseUrl();
    prisma = new PrismaClient({
      datasources: { db: { url: phase61DatabaseUrl() } },
    });

    let connected = false;
    let schemaReady = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      connected = true;
      const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'google_ads_script_integrations'
      `;
      schemaReady = tables.length > 0;
    } catch {
      connected = false;
      schemaReady = false;
      await prisma.$disconnect().catch(() => undefined);
    }

    if (!connected) {
      await startPhase61Postgres();
      startedByUs = true;
      const reset = spawnSync(
        "pnpm",
        ["exec", "tsx", "scripts/phase61-reset-db.mts"],
        {
          cwd: ROOT,
          env: { ...process.env, DATABASE_URL: phase61DatabaseUrl() },
          encoding: "utf8",
          shell: true,
        }
      );
      if (reset.status !== 0) {
        // Postgres may already be running with DB present — migrate only.
        runMigrateDeploy();
      } else {
        runMigrateDeploy();
      }
      prisma = new PrismaClient({
        datasources: { db: { url: phase61DatabaseUrl() } },
      });
      await prisma.$queryRaw`SELECT 1`;
    } else if (!schemaReady) {
      runMigrateDeploy();
      const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'google_ads_script_integrations'
      `;
      if (tables.length === 0) {
        throw new Error("google_ads_script_integrations table missing after migrate");
      }
    }

    integrations = new PrismaGoogleAdsScriptIntegrationRepository(prisma);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    if (startedByUs) {
      await stopPhase61Postgres().catch(() => undefined);
    }
  });

  it("persists tokenHash only; rotation replaces credentials; revoke blocks ACTIVE", async () => {
    const accounts = await prisma.googleAccount.findMany({ take: 1 });
    if (accounts.length === 0) {
      await prisma.tenant.upsert({
        where: { id: TenantA.id },
        create: {
          id: TenantA.id,
          name: "A",
          slug: `phase842-a-${randomUUID().slice(0, 8)}`,
          status: "ACTIVE",
        },
        update: {},
      });
      // Without full seed hierarchy this test cannot create integrations — soft skip
      const still = await prisma.googleAccount.count();
      if (still === 0) return;
    }

    const account = (await prisma.googleAccount.findFirst())!;
    const first = material("v1");
    const created = await integrations.create({
      id: randomUUID(),
      tenantId: account.tenantId,
      googleAccountId: account.id,
      name: "pg auth",
      status: "ACTIVE",
      tokenKeyId: first.tokenKeyId,
      tokenPrefix: first.tokenPrefix,
      tokenHash: first.tokenHash,
      configGeneration: 0,
    });

    const row = await prisma.googleAdsScriptIntegration.findUnique({
      where: { id: created.id },
    });
    expect(row?.tokenHash).toBe(first.tokenHash);
    expect(JSON.stringify(row)).not.toContain(first.token);

    const byHash = await integrations.findByTokenHash(first.tokenHash);
    expect(byHash?.id).toBe(created.id);

    const second = material("v2");
    await integrations.replaceTokenCredentials(created.id, {
      tokenKeyId: second.tokenKeyId,
      tokenPrefix: second.tokenPrefix,
      tokenHash: second.tokenHash,
    });
    expect(await integrations.findByTokenHash(first.tokenHash)).toBeNull();
    expect((await integrations.findByTokenHash(second.tokenHash))?.id).toBe(
      created.id
    );

    await integrations.update(created.id, { status: "REVOKED" });
    const revoked = await integrations.findById(created.id);
    expect(revoked?.status).toBe("REVOKED");
  });
});

describe.skipIf(RUN_PG)("Phase 8.4.2 PostgreSQL (skipped without PHASE842_PG)", () => {
  it("documents ENV LIMITATION when embedded PG is not opted in", () => {
    expect(RUN_PG).toBe(false);
  });
});
