import { describe, expect, it } from "vitest";
import { createPrismaClient } from "./client.js";
import {
  createMemoryRepositoryBundle,
  createPrismaRepositoryBundle,
} from "./repository-bundle.js";

describe("Phase 8.1 RepositoryBundle", () => {
  it("memory bundle exposes unitOfWork and persistence=memory", () => {
    const bundle = createMemoryRepositoryBundle();
    expect(bundle.persistence).toBe("memory");
    expect(bundle.unitOfWork).toBeDefined();
    expect(bundle.prisma).toBeUndefined();
    expect(bundle.tenants).toBeDefined();
    expect(bundle.orders).toBeDefined();
    expect(bundle.scriptIntegrations).toBeDefined();
    expect(bundle.scriptSyncTargets).toBeDefined();
    expect(bundle.scriptSyncLogs).toBeDefined();
  });

  it("prisma bundle factory attaches PrismaUnitOfWork", () => {
    // Do not connect — only assert object shape with a client instance.
    const db = createPrismaClient("postgresql://invalid:invalid@127.0.0.1:1/none");
    const bundle = createPrismaRepositoryBundle(db);
    expect(bundle.persistence).toBe("prisma");
    expect(bundle.prisma).toBe(db);
    expect(bundle.unitOfWork).toBeDefined();
    expect(bundle.syncJobs).toBeDefined();
    expect(bundle.scriptIntegrations).toBeDefined();
    expect(bundle.scriptSyncTargets).toBeDefined();
    expect(bundle.scriptSyncLogs).toBeDefined();
  });
});
