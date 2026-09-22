/**
 * Phase 8.4.1 — Script Integration data model (InMemory repository tests).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertGoogleAccountBelongsToTenant,
  assertScriptSyncTargetAdOnly,
} from "@adlinklab/domain";
import { ConflictError, ValidationError } from "@adlinklab/shared";
import { createSeededMemoryRepositories } from "./memory/repositories.js";
import { TenantA, TenantB } from "./fixtures/ids.js";

function hashStub(label: string): string {
  // Deterministic fake hash — not a real token; tests never store plaintext.
  return `hash_${label}_${"0".repeat(48)}`.slice(0, 64);
}

describe("Phase 8.4.1 domain guards", () => {
  it("rejects non-AD ScriptSyncTarget entity types", () => {
    expect(() => assertScriptSyncTargetAdOnly("CAMPAIGN")).toThrow(ValidationError);
    expect(() => assertScriptSyncTargetAdOnly("AD_GROUP")).toThrow(ValidationError);
    expect(() => assertScriptSyncTargetAdOnly("CUSTOMER")).toThrow(ValidationError);
    expect(() => assertScriptSyncTargetAdOnly("AD_GROUP_CRITERION")).toThrow(
      ValidationError
    );
    expect(() => assertScriptSyncTargetAdOnly("AD")).not.toThrow();
  });

  it("rejects GoogleAccount from another tenant", () => {
    expect(() =>
      assertGoogleAccountBelongsToTenant(
        { id: TenantB.account, tenantId: TenantB.id },
        TenantA.id,
        TenantB.account
      )
    ).toThrow(ValidationError);
  });

  it("accepts GoogleAccount matching tenant", () => {
    expect(() =>
      assertGoogleAccountBelongsToTenant(
        { id: TenantA.account, tenantId: TenantA.id },
        TenantA.id,
        TenantA.account
      )
    ).not.toThrow();
  });
});

describe("Phase 8.4.1 GoogleAdsScriptIntegration repository", () => {
  it("creates, reads, updates, and soft-deletes an Integration", async () => {
    const repos = createSeededMemoryRepositories();
    const id = randomUUID();
    const created = await repos.scriptIntegrations.create({
      id,
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Script Integration A",
      status: "ACTIVE",
      tokenKeyId: "key_a1",
      tokenPrefix: "alk_s_aaaa",
      tokenHash: hashStub("a1"),
      configGeneration: 0,
    });
    expect(created.id).toBe(id);
    expect(created.tokenHash).toBe(hashStub("a1"));

    const byTenant = await repos.scriptIntegrations.findByIdForTenant(
      TenantA.id,
      id
    );
    expect(byTenant?.name).toBe("Script Integration A");

    const updated = await repos.scriptIntegrations.update(id, {
      name: "Script Integration A2",
      configGeneration: 1,
    });
    expect(updated.name).toBe("Script Integration A2");
    expect(updated.configGeneration).toBe(1);

    const deleted = await repos.scriptIntegrations.softDelete(id);
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    expect(deleted.status).toBe("DISABLED");
  });

  it("enforces tenant isolation on findByIdForTenant", async () => {
    const repos = createSeededMemoryRepositories();
    const id = randomUUID();
    await repos.scriptIntegrations.create({
      id,
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "A only",
      status: "ACTIVE",
      tokenKeyId: "key_iso",
      tokenPrefix: "alk_s_iso1",
      tokenHash: hashStub("iso1"),
      configGeneration: 0,
    });
    expect(
      await repos.scriptIntegrations.findByIdForTenant(TenantB.id, id)
    ).toBeNull();
    expect(
      await repos.scriptIntegrations.findByIdForTenant(TenantA.id, id)
    ).not.toBeNull();
  });

  it("rejects Integration bound to another tenant GoogleAccount", async () => {
    const repos = createSeededMemoryRepositories();
    await expect(
      repos.scriptIntegrations.create({
        id: randomUUID(),
        tenantId: TenantA.id,
        googleAccountId: TenantB.account,
        name: "cross tenant",
        status: "ACTIVE",
        tokenKeyId: "key_x",
        tokenPrefix: "alk_s_xxxx",
        tokenHash: hashStub("cross"),
        configGeneration: 0,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("finds Integration by tokenHash and never models plaintext token", async () => {
    const repos = createSeededMemoryRepositories();
    const tokenHash = hashStub("lookup");
    await repos.scriptIntegrations.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "hash lookup",
      status: "ACTIVE",
      tokenKeyId: "key_lookup",
      tokenPrefix: "alk_s_look",
      tokenHash,
      configGeneration: 0,
    });
    const found = await repos.scriptIntegrations.findByTokenHash(tokenHash);
    expect(found?.tokenPrefix).toBe("alk_s_look");
    expect(found).not.toHaveProperty("token");
    expect(found).not.toHaveProperty("apiKey");
    expect(found).not.toHaveProperty("secretPlaintext");
  });

  it("allows multiple Integrations on the same GoogleAccount", async () => {
    const repos = createSeededMemoryRepositories();
    const a = await repos.scriptIntegrations.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Int 1",
      status: "ACTIVE",
      tokenKeyId: "k1",
      tokenPrefix: "alk_s_m001",
      tokenHash: hashStub("multi1"),
      configGeneration: 0,
    });
    const b = await repos.scriptIntegrations.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Int 2",
      status: "ACTIVE",
      tokenKeyId: "k2",
      tokenPrefix: "alk_s_m002",
      tokenHash: hashStub("multi2"),
      configGeneration: 0,
    });
    expect(a.googleAccountId).toBe(b.googleAccountId);
    const list = await repos.scriptIntegrations.findByTenant(TenantA.id);
    expect(list.items.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects duplicate tokenHash", async () => {
    const repos = createSeededMemoryRepositories();
    const tokenHash = hashStub("dup");
    await repos.scriptIntegrations.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "first",
      status: "ACTIVE",
      tokenKeyId: "kd1",
      tokenPrefix: "alk_s_dup1",
      tokenHash,
      configGeneration: 0,
    });
    await expect(
      repos.scriptIntegrations.create({
        id: randomUUID(),
        tenantId: TenantA.id,
        googleAccountId: TenantA.account,
        name: "second",
        status: "ACTIVE",
        tokenKeyId: "kd2",
        tokenPrefix: "alk_s_dup2",
        tokenHash,
        configGeneration: 0,
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("Phase 8.4.1 ScriptSyncTarget repository", () => {
  async function createIntegration(
    repos: ReturnType<typeof createSeededMemoryRepositories>,
    tenantId: string,
    googleAccountId: string,
    label: string
  ) {
    return repos.scriptIntegrations.create({
      id: randomUUID(),
      tenantId,
      googleAccountId,
      name: `Int ${label}`,
      status: "ACTIVE",
      tokenKeyId: `key_${label}`,
      tokenPrefix: `alk_s_${label}`.slice(0, 12),
      tokenHash: hashStub(label),
      configGeneration: 0,
    });
  }

  it("creates AD target and denormalizes Google / hierarchy ids from Ad authority", async () => {
    const repos = createSeededMemoryRepositories();
    const integration = await createIntegration(
      repos,
      TenantA.id,
      TenantA.account,
      "tgt1"
    );
    const target = await repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      syncState: "NEVER_APPLIED",
      connectionHealth: "STALE",
    });
    expect(target.googleAdId).toBeTruthy();
    expect(target.adGroupId).toBe(TenantA.adGroupA1);
    expect(target.campaignId).toBe(TenantA.campaignA);
    expect(target.syncState).toBe("NEVER_APPLIED");
    expect(target.connectionHealth).toBe("STALE");
    expect(target.lastExecution).toBeUndefined();
  });

  it("rejects CAMPAIGN / AD_GROUP / CUSTOMER / CRITERION targets", async () => {
    const repos = createSeededMemoryRepositories();
    const integration = await createIntegration(
      repos,
      TenantA.id,
      TenantA.account,
      "rej"
    );
    for (const entityType of [
      "CAMPAIGN",
      "AD_GROUP",
      "CUSTOMER",
      "AD_GROUP_CRITERION",
    ] as const) {
      await expect(
        repos.scriptSyncTargets.create({
          id: randomUUID(),
          tenantId: TenantA.id,
          integrationId: integration.id,
          entityType,
          entityId: TenantA.campaignA,
          syncState: "NEVER_APPLIED",
          connectionHealth: "STALE",
        })
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("enforces target tenant isolation", async () => {
    const repos = createSeededMemoryRepositories();
    const integration = await createIntegration(
      repos,
      TenantA.id,
      TenantA.account,
      "tiso"
    );
    const target = await repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      syncState: "NEVER_APPLIED",
      connectionHealth: "STALE",
    });
    expect(
      await repos.scriptSyncTargets.findByIdForTenant(TenantB.id, target.id)
    ).toBeNull();
  });

  it("allows multiple AD targets on one Integration", async () => {
    const repos = createSeededMemoryRepositories();
    const integration = await createIntegration(
      repos,
      TenantA.id,
      TenantA.account,
      "mt"
    );
    await repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      syncState: "NEVER_APPLIED",
      connectionHealth: "STALE",
    });
    await repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      entityType: "AD",
      entityId: TenantA.adA2,
      syncState: "NEVER_APPLIED",
      connectionHealth: "STALE",
    });
    const listed = await repos.scriptSyncTargets.findByIntegration(
      TenantA.id,
      integration.id
    );
    expect(listed.items).toHaveLength(2);
  });

  it("allows same Ad on two Integrations (applied state is target-scoped)", async () => {
    const repos = createSeededMemoryRepositories();
    const i1 = await createIntegration(repos, TenantA.id, TenantA.account, "sa1");
    const i2 = await createIntegration(repos, TenantA.id, TenantA.account, "sa2");
    const t1 = await repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: i1.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      desiredVersion: 2,
      appliedVersion: 1,
      syncState: "OUT_OF_SYNC",
      connectionHealth: "CONNECTED",
    });
    const t2 = await repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: i2.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      desiredVersion: 2,
      appliedVersion: 2,
      syncState: "SYNCED",
      connectionHealth: "CONNECTED",
      lastExecution: "SUCCESS",
    });
    expect(t1.entityId).toBe(t2.entityId);
    expect(t1.appliedVersion).not.toBe(t2.appliedVersion);
  });

  it("updates sync health dimensions independently", async () => {
    const repos = createSeededMemoryRepositories();
    const integration = await createIntegration(
      repos,
      TenantA.id,
      TenantA.account,
      "hlth"
    );
    const target = await repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      syncState: "NEVER_APPLIED",
      connectionHealth: "STALE",
    });
    const updated = await repos.scriptSyncTargets.update(target.id, {
      syncState: "OUT_OF_SYNC",
      connectionHealth: "CONNECTED",
      lastExecution: "FAILED",
      desiredVersion: 5,
      appliedVersion: 4,
    });
    expect(updated.syncState).toBe("OUT_OF_SYNC");
    expect(updated.connectionHealth).toBe("CONNECTED");
    expect(updated.lastExecution).toBe("FAILED");
  });
});

describe("Phase 8.4.1 ScriptSyncLog repository", () => {
  async function seedTarget(
    repos: ReturnType<typeof createSeededMemoryRepositories>
  ) {
    const integration = await repos.scriptIntegrations.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "log int",
      status: "ACTIVE",
      tokenKeyId: "key_log",
      tokenPrefix: "alk_s_log1",
      tokenHash: hashStub(`log_${randomUUID()}`),
      configGeneration: 0,
    });
    const target = await repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      syncState: "NEVER_APPLIED",
      connectionHealth: "STALE",
    });
    return { integration, target };
  }

  it("creates and reads append-only logs", async () => {
    const repos = createSeededMemoryRepositories();
    const { integration, target } = await seedTarget(repos);
    const log = await repos.scriptSyncLogs.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      targetId: target.id,
      desiredVersion: 3,
      reportedAppliedVersion: 3,
      result: "SUCCESS",
      idempotencyScope: "SCRIPT_SYNC_RESULT",
      idempotencyKey: "exec-1",
    });
    expect(log.result).toBe("SUCCESS");
    const found = await repos.scriptSyncLogs.findByIdForTenant(
      TenantA.id,
      log.id
    );
    expect(found?.idempotencyKey).toBe("exec-1");
    expect(
      await repos.scriptSyncLogs.findByIdForTenant(TenantB.id, log.id)
    ).toBeNull();
    // Append-only: no update/delete on repository interface
    expect(
      "update" in (repos.scriptSyncLogs as object) &&
        typeof (repos.scriptSyncLogs as { update?: unknown }).update ===
          "function"
    ).toBe(false);
    expect(
      "delete" in (repos.scriptSyncLogs as object) &&
        typeof (repos.scriptSyncLogs as { delete?: unknown }).delete ===
          "function"
    ).toBe(false);
  });

  it("enforces tenant-scoped idempotency uniqueness", async () => {
    const repos = createSeededMemoryRepositories();
    const { integration, target } = await seedTarget(repos);
    await repos.scriptSyncLogs.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      targetId: target.id,
      desiredVersion: 1,
      result: "NO_CHANGE",
      idempotencyScope: "SCRIPT_SYNC_RESULT",
      idempotencyKey: "same-key",
    });
    await expect(
      repos.scriptSyncLogs.create({
        id: randomUUID(),
        tenantId: TenantA.id,
        integrationId: integration.id,
        targetId: target.id,
        desiredVersion: 1,
        result: "SUCCESS",
        idempotencyScope: "SCRIPT_SYNC_RESULT",
        idempotencyKey: "same-key",
      })
    ).rejects.toBeInstanceOf(ConflictError);

    const existing = await repos.scriptSyncLogs.findByIdempotencyKey(
      TenantA.id,
      "SCRIPT_SYNC_RESULT",
      "same-key"
    );
    expect(existing?.result).toBe("NO_CHANGE");
  });

  it("allows the same idempotency key across tenants", async () => {
    const repos = createSeededMemoryRepositories();
    const intA = await repos.scriptIntegrations.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "A",
      status: "ACTIVE",
      tokenKeyId: "ka",
      tokenPrefix: "alk_s_cta1",
      tokenHash: hashStub("cta"),
      configGeneration: 0,
    });
    const intB = await repos.scriptIntegrations.create({
      id: randomUUID(),
      tenantId: TenantB.id,
      googleAccountId: TenantB.account,
      name: "B",
      status: "ACTIVE",
      tokenKeyId: "kb",
      tokenPrefix: "alk_s_ctb1",
      tokenHash: hashStub("ctb"),
      configGeneration: 0,
    });
    const tgtA = await repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: intA.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      syncState: "NEVER_APPLIED",
      connectionHealth: "STALE",
    });
    const tgtB = await repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantB.id,
      integrationId: intB.id,
      entityType: "AD",
      entityId: TenantB.ad,
      syncState: "NEVER_APPLIED",
      connectionHealth: "STALE",
    });
    await repos.scriptSyncLogs.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: intA.id,
      targetId: tgtA.id,
      desiredVersion: 1,
      result: "SUCCESS",
      idempotencyScope: "SCRIPT_SYNC_RESULT",
      idempotencyKey: "K1",
    });
    const logB = await repos.scriptSyncLogs.create({
      id: randomUUID(),
      tenantId: TenantB.id,
      integrationId: intB.id,
      targetId: tgtB.id,
      desiredVersion: 1,
      result: "FAILED",
      errorCode: "TEST",
      errorMessage: "simulated failure without secrets",
      idempotencyScope: "SCRIPT_SYNC_RESULT",
      idempotencyKey: "K1",
    });
    expect(logB.idempotencyKey).toBe("K1");
    expect(logB.tenantId).toBe(TenantB.id);
  });
});
