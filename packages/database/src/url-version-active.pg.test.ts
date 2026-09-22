import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConflictError } from "@adlinklab/shared";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

/**
 * Phase 1.2-R1 PostgreSQL integration — real partial unique index.
 * Skipped when DATABASE_URL is unavailable (do not claim PASS).
 */
describe.skipIf(!hasDatabaseUrl)(
  "Phase 1.2-R1 PostgreSQL UrlVersion ACTIVE unique",
  () => {
    it("rejects second ACTIVE via partial unique index", async () => {
      const { prisma } = await import("./client.js");
      const tenantId = randomUUID();
      const entityId = randomUUID();

      await prisma.tenant.create({
        data: {
          id: tenantId,
          name: `r1-${tenantId.slice(0, 8)}`,
          slug: `r1-${tenantId.slice(0, 8)}`,
          status: "ACTIVE",
        },
      });

      await prisma.urlVersion.create({
        data: {
          id: randomUUID(),
          tenantId,
          entityType: "CAMPAIGN",
          entityId,
          finalUrl: "https://example.com/pg-v1",
          customParameters: {},
          version: 1,
          status: "ACTIVE",
        },
      });

      await expect(
        prisma.urlVersion.create({
          data: {
            id: randomUUID(),
            tenantId,
            entityType: "CAMPAIGN",
            entityId,
            finalUrl: "https://example.com/pg-v2",
            customParameters: {},
            version: 2,
            status: "ACTIVE",
          },
        })
      ).rejects.toSatisfy((err: unknown) => {
        const code =
          err && typeof err === "object" && "code" in err
            ? (err as { code?: string }).code
            : undefined;
        return code === "P2002" || err instanceof ConflictError;
      });

      await prisma.urlVersion.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    });
  }
);

describe.skipIf(hasDatabaseUrl)(
  "Phase 1.2-R1 PostgreSQL availability",
  () => {
    it("reports DATABASE_URL unavailable", () => {
      expect(process.env.DATABASE_URL).toBeFalsy();
      // Explicit marker for Phase 1.2-R1 report:
      // PostgreSQL integration tests: NOT RUN
      // Reason: DATABASE_URL unavailable
    });
  }
);
