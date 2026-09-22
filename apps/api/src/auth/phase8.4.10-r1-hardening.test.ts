/**
 * Phase 8.4.10-R1 — Production fail-closed hardening (R1 / R2 / R3).
 * Memory-only unit tests — no PG required.
 */
import { describe, expect, it } from "vitest";
import {
  FIXTURE_API_KEYS,
  loadApiKeyRegistry,
  resolveAuthMode,
} from "./api-keys.js";
import {
  createAppRepositoryBundle,
  resolvePersistenceMode,
} from "../persistence.js";

const PROD_DB = "postgresql://adlinklab:adlinklab@localhost:5432/adlinklab";

describe("Phase 8.4.10-R1 production fail-closed hardening", () => {
  describe("R1 — fixture API keys", () => {
    it("1. production does not load fixture API keys", () => {
      const registry = loadApiKeyRegistry({
        NODE_ENV: "production",
        ADLINKLAB_API_KEYS: "",
      });
      expect(registry).toHaveLength(0);
      expect(
        registry.some((r) => r.keyId.startsWith("fixture:"))
      ).toBe(false);
    });

    it("1b. production loads only explicit ADLINKLAB_API_KEYS (no fixtures)", () => {
      const registry = loadApiKeyRegistry({
        NODE_ENV: "production",
        ADLINKLAB_API_KEYS: `ops_key:${FIXTURE_API_KEYS.tenantA.tenantId}`,
      });
      expect(registry).toHaveLength(1);
      expect(registry[0]?.keyId.startsWith("env:")).toBe(true);
      expect(
        registry.some((r) => r.keyId.startsWith("fixture:"))
      ).toBe(false);
    });

    it("2. development keeps fixture behavior", () => {
      const registry = loadApiKeyRegistry({
        NODE_ENV: "development",
      });
      expect(registry.length).toBeGreaterThanOrEqual(2);
      expect(
        registry.some((r) => r.keyId === `fixture:${FIXTURE_API_KEYS.tenantA.key}`)
      ).toBe(true);
      expect(
        registry.some((r) => r.keyId === `fixture:${FIXTURE_API_KEYS.tenantB.key}`)
      ).toBe(true);
    });

    it("3. test keeps fixture behavior", () => {
      const registry = loadApiKeyRegistry({
        NODE_ENV: "test",
        VITEST: "true",
      });
      expect(
        registry.some((r) => r.keyId === `fixture:${FIXTURE_API_KEYS.tenantA.key}`)
      ).toBe(true);
    });

    it("4. ADLINKLAB_API_KEYS_NO_FIXTURES=1 still suppresses fixtures", () => {
      const registry = loadApiKeyRegistry({
        NODE_ENV: "development",
        ADLINKLAB_API_KEYS_NO_FIXTURES: "1",
      });
      expect(
        registry.some((r) => r.keyId.startsWith("fixture:"))
      ).toBe(false);
    });
  });

  describe("R2 — production persistence fail closed", () => {
    it("5. production + DATABASE_URL missing → throw", () => {
      expect(() =>
        resolvePersistenceMode({
          env: {
            NODE_ENV: "production",
            PERSISTENCE: "prisma",
          },
        })
      ).toThrow(/Production requires PERSISTENCE=prisma and DATABASE_URL/);
    });

    it("5b. production + PERSISTENCE omitted + DATABASE_URL → throw", () => {
      expect(() =>
        resolvePersistenceMode({
          env: {
            NODE_ENV: "production",
            DATABASE_URL: PROD_DB,
          },
        })
      ).toThrow(/Production requires PERSISTENCE=prisma and DATABASE_URL/);
    });

    it("6. production + PERSISTENCE=memory → throw", () => {
      expect(() =>
        resolvePersistenceMode({
          env: {
            NODE_ENV: "production",
            PERSISTENCE: "memory",
            DATABASE_URL: PROD_DB,
          },
        })
      ).toThrow(/Production requires PERSISTENCE=prisma and DATABASE_URL/);
    });

    it("6b. production + createAppRepositoryBundle(memory) → throw", () => {
      expect(() =>
        createAppRepositoryBundle({
          persistence: "memory",
          env: {
            NODE_ENV: "production",
            DATABASE_URL: PROD_DB,
            PERSISTENCE: "prisma",
          },
        })
      ).toThrow(/Production requires PERSISTENCE=prisma and DATABASE_URL/);
    });

    it("7. production + PERSISTENCE=prisma + DATABASE_URL → prisma", () => {
      expect(
        resolvePersistenceMode({
          env: {
            NODE_ENV: "production",
            PERSISTENCE: "prisma",
            DATABASE_URL: PROD_DB,
          },
        })
      ).toBe("prisma");
    });

    it("8. test + no DATABASE_URL → memory (existing behavior)", () => {
      expect(
        resolvePersistenceMode({
          env: { VITEST: "true", NODE_ENV: "test" },
        })
      ).toBe("memory");
    });
  });

  describe("R3 — AUTH_MODE fail closed defaults", () => {
    it("9. production + AUTH_MODE omitted → throw (Phase 9.2)", () => {
      expect(() => resolveAuthMode({ NODE_ENV: "production" })).toThrow(
        /Production requires AUTH_MODE=api_key/
      );
    });

    it("10. staging/non-production + AUTH_MODE omitted → api_key", () => {
      expect(resolveAuthMode({ NODE_ENV: "development" })).toBe("api_key");
      expect(resolveAuthMode({ NODE_ENV: "staging" })).toBe("api_key");
      expect(resolveAuthMode({})).toBe("api_key");
    });

    it("11. explicit AUTH_MODE=disabled — production throws; development allows", () => {
      expect(() =>
        resolveAuthMode({ NODE_ENV: "production", AUTH_MODE: "disabled" })
      ).toThrow(/Production requires AUTH_MODE=api_key/);
      expect(
        resolveAuthMode({ NODE_ENV: "development", AUTH_MODE: "disabled" })
      ).toBe("disabled");
    });

    it("12. explicit AUTH_MODE=api_key → api_key", () => {
      expect(
        resolveAuthMode({ NODE_ENV: "development", AUTH_MODE: "api_key" })
      ).toBe("api_key");
      expect(
        resolveAuthMode({ NODE_ENV: "production", AUTH_MODE: "api_key" })
      ).toBe("api_key");
    });

    it("13. test behavior remains disabled when AUTH_MODE omitted", () => {
      expect(resolveAuthMode({ NODE_ENV: "test" })).toBe("disabled");
      expect(resolveAuthMode({ VITEST: "true" })).toBe("disabled");
    });
  });
});
