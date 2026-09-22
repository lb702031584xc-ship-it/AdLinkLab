import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConflictError } from "@adlinklab/shared";
import { createSeededMemoryRepositories } from "./memory/repositories.js";

const tenantA = "00000000-0000-4000-8000-000000000001";
const tenantB = "00000000-0000-4000-8000-000000000099";
const entityA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const entityB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * Phase 1.2-R1 — ACTIVE partial unique + version/activation concurrency (InMemory).
 * PostgreSQL integration lives in url-version-active.pg.test.ts (skipped without DATABASE_URL).
 */
describe("Phase 1.2-R1 UrlVersion ACTIVE constraint", () => {
  it("rejects second ACTIVE for same tenant+entity", async () => {
    const repos = createSeededMemoryRepositories();
    await repos.urlVersions.create({
      id: randomUUID(),
      tenantId: tenantA,
      entityType: "CAMPAIGN",
      entityId: entityA,
      finalUrl: "https://example.com/v1",
      customParameters: {},
      version: 1,
      status: "ACTIVE",
    });

    await expect(
      repos.urlVersions.create({
        id: randomUUID(),
        tenantId: tenantA,
        entityType: "CAMPAIGN",
        entityId: entityA,
        finalUrl: "https://example.com/v2",
        customParameters: {},
        version: 2,
        status: "ACTIVE",
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("allows ACTIVE on different entities", async () => {
    const repos = createSeededMemoryRepositories();
    await repos.urlVersions.create({
      id: randomUUID(),
      tenantId: tenantA,
      entityType: "CAMPAIGN",
      entityId: entityA,
      finalUrl: "https://example.com/a",
      customParameters: {},
      version: 1,
      status: "ACTIVE",
    });
    await expect(
      repos.urlVersions.create({
        id: randomUUID(),
        tenantId: tenantA,
        entityType: "CAMPAIGN",
        entityId: entityB,
        finalUrl: "https://example.com/b",
        customParameters: {},
        version: 1,
        status: "ACTIVE",
      })
    ).resolves.toMatchObject({ status: "ACTIVE", entityId: entityB });
  });

  it("allows ACTIVE on same entityId across tenants", async () => {
    const repos = createSeededMemoryRepositories();
    await repos.urlVersions.create({
      id: randomUUID(),
      tenantId: tenantA,
      entityType: "CAMPAIGN",
      entityId: entityA,
      finalUrl: "https://example.com/a",
      customParameters: {},
      version: 1,
      status: "ACTIVE",
    });
    await expect(
      repos.urlVersions.create({
        id: randomUUID(),
        tenantId: tenantB,
        entityType: "CAMPAIGN",
        entityId: entityA,
        finalUrl: "https://example.com/b",
        customParameters: {},
        version: 1,
        status: "ACTIVE",
      })
    ).resolves.toMatchObject({ tenantId: tenantB, status: "ACTIVE" });
  });

  it("concurrent activation leaves exactly one ACTIVE", async () => {
    const repos = createSeededMemoryRepositories();
    const v2 = await repos.urlVersions.create({
      id: randomUUID(),
      tenantId: tenantA,
      entityType: "CAMPAIGN",
      entityId: entityA,
      finalUrl: "https://example.com/v2",
      customParameters: {},
      version: 10,
      status: "DRAFT",
    });
    const v3 = await repos.urlVersions.create({
      id: randomUUID(),
      tenantId: tenantA,
      entityType: "CAMPAIGN",
      entityId: entityA,
      finalUrl: "https://example.com/v3",
      customParameters: {},
      version: 11,
      status: "DRAFT",
    });

    const activate = async (versionId: string) => {
      await repos.unitOfWork.transaction(async (ctx) => {
        const target = await ctx.urlVersions.findById(versionId);
        if (!target) throw new Error("missing");
        const active = await ctx.urlVersions.findActiveByEntity(
          target.entityType,
          target.entityId
        );
        if (active && active.id !== target.id) {
          await ctx.urlVersions.updateStatus(active.id, {
            status: "SUPERSEDED",
          });
        }
        if (target.status !== "ACTIVE") {
          await ctx.urlVersions.updateStatus(target.id, {
            status: "ACTIVE",
            effectiveAt: new Date(),
          });
        }
      });
    };

    const results = await Promise.allSettled([
      activate(v2.id),
      activate(v3.id),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);

    const versions = await repos.urlVersions.listByEntity("CAMPAIGN", entityA);
    const actives = versions.filter((v) => v.status === "ACTIVE");
    expect(actives).toHaveLength(1);
  });

  it("version race does not produce duplicate version numbers", async () => {
    const repos = createSeededMemoryRepositories();
    const entityId = randomUUID();

    const createOnce = () =>
      repos.unitOfWork.transaction(async (ctx) => {
        let lastError: unknown;
        for (let i = 0; i < 8; i++) {
          try {
            const version = await ctx.urlVersions.getNextVersion(
              "CAMPAIGN",
              entityId
            );
            return await ctx.urlVersions.create({
              id: randomUUID(),
              tenantId: tenantA,
              entityType: "CAMPAIGN",
              entityId,
              finalUrl: `https://example.com/v${version}`,
              customParameters: {},
              version,
              status: "DRAFT",
            });
          } catch (error) {
            lastError = error;
            if (!(error instanceof ConflictError)) throw error;
          }
        }
        throw lastError;
      });

    const created = await Promise.all([
      createOnce(),
      createOnce(),
      createOnce(),
      createOnce(),
    ]);

    const versions = created.map((v) => v.version).sort((a, b) => a - b);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toEqual([1, 2, 3, 4]);
  });
});
