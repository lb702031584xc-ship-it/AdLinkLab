import { describe, expect, it } from "vitest";
import {
  createAppRepositoryBundle,
  resolvePersistenceMode,
} from "./persistence.js";
import { createServices, buildApp } from "./app.js";

describe("Phase 8.1 persistence resolution", () => {
  it("defaults to memory under Vitest", () => {
    expect(
      resolvePersistenceMode({
        env: { VITEST: "true", DATABASE_URL: "postgresql://x" },
      })
    ).toBe("memory");
  });

  it("honors PERSISTENCE=memory even with DATABASE_URL outside production", () => {
    expect(
      resolvePersistenceMode({
        env: {
          PERSISTENCE: "memory",
          DATABASE_URL: "postgresql://x",
          NODE_ENV: "development",
        },
      })
    ).toBe("memory");
  });

  it("selects prisma when DATABASE_URL set outside tests (non-production)", () => {
    expect(
      resolvePersistenceMode({
        env: {
          DATABASE_URL: "postgresql://adlinklab@localhost/adlinklab",
          NODE_ENV: "development",
        },
      })
    ).toBe("prisma");
  });

  it("production requires explicit PERSISTENCE=prisma and DATABASE_URL", () => {
    expect(
      resolvePersistenceMode({
        env: {
          PERSISTENCE: "prisma",
          DATABASE_URL: "postgresql://adlinklab@localhost/adlinklab",
          NODE_ENV: "production",
        },
      })
    ).toBe("prisma");
  });

  it("PERSISTENCE=prisma without DATABASE_URL throws", () => {
    expect(() =>
      createAppRepositoryBundle({
        persistence: "prisma",
        env: { PERSISTENCE: "prisma" },
      })
    ).toThrow(/DATABASE_URL/);
  });

  it("createServices defaults to memory in test and exposes dispose", async () => {
    const services = createServices();
    expect(services.persistence).toBe("memory");
    await services.dispose();
  });

  it("health reports phase 10, persistence=memory, queueMode=off, worker stopped", async () => {
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
});
