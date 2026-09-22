/**
 * Phase 12.2-A — Unit tests for seeded restore depth module (no live Postgres required).
 */
import { describe, expect, it } from "vitest";
import { TenantA, TenantB } from "../fixtures/ids.js";
import { BackupError } from "./types.js";
import {
  assertSeededRestoreDepth,
  buildPassingSeededRestoreDepthSnapshot,
  compareSeededRestoreDepthSnapshots,
  evaluateSeededRestoreDepth,
  evaluateSeededRestoreDepthWithSourceCompare,
  EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3,
  EXPECTED_TRACKING_PUBLIC_IDS_TENANT_A,
  SEEDED_RESTORE_DEPTH_FIXTURE_VERSION,
  snapshotSeededRestoreDepth,
  type SeededRestoreDepthSnapshot,
} from "./seeded-restore-depth.js";

describe("Phase 12.2-A seeded restore depth", () => {
  it("1. complete Phase 1.3 fixture snapshot passes", () => {
    const snap = buildPassingSeededRestoreDepthSnapshot();
    const result = evaluateSeededRestoreDepth(snap);
    expect(result.status).toBe("passed");
    expect(result.fixtureVersion).toBe(SEEDED_RESTORE_DEPTH_FIXTURE_VERSION);
    expect(result.failedCount).toBe(0);
  });

  it("2. all D1–D10 pass on complete snapshot", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot()
    );
    const ids = result.assertions.map((a) => a.id);
    expect(ids).toEqual([
      "D1",
      "D2",
      "D3",
      "D4",
      "D5",
      "D6",
      "D7",
      "D8",
      "D9",
      "D10",
    ]);
    expect(result.assertions.every((a) => a.status === "passed")).toBe(true);
  });

  it("3. Tenant A missing → D2 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        tenantIds: [TenantB.id],
        tenantCount: 1,
      })
    );
    expect(result.assertions.find((a) => a.id === "D2")?.status).toBe("failed");
  });

  it("4. Tenant B missing → D2 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        tenantIds: [TenantA.id],
        tenantCount: 1,
      })
    );
    expect(result.assertions.find((a) => a.id === "D2")?.status).toBe("failed");
  });

  it("5. tenant count incorrect → D1 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({ tenantCount: 3 })
    );
    expect(result.assertions.find((a) => a.id === "D1")?.status).toBe("failed");
  });

  it("6. Tenant A campaign count incorrect → D3 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({ campaignCountTenantA: 1 })
    );
    expect(result.assertions.find((a) => a.id === "D3")?.status).toBe("failed");
  });

  it("7. tracking publicId missing → D4 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        trackingPublicIdsTenantA: ["trk_demo_001", "trk_demo_002"],
      })
    );
    expect(result.assertions.find((a) => a.id === "D4")?.status).toBe("failed");
  });

  it("8. ORDER-001 missing → D5 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        order001: null,
        order001TenantId: null,
        order001TrackingPublicId: null,
      })
    );
    expect(result.assertions.find((a) => a.id === "D5")?.status).toBe("failed");
  });

  it("9. ORDER-001 wrong tenant → D6 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        order001: {
          orderId: "ORDER-001",
          tenantId: TenantB.id,
          clickId: TenantA.click1,
          trackingPublicId: "trk_demo_001",
        },
        order001TenantId: TenantB.id,
        order001TrackingPublicId: "trk_demo_001",
      })
    );
    expect(result.assertions.find((a) => a.id === "D6")?.status).toBe("failed");
  });

  it("10. wrong tracking publicId → D7 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        order001: {
          orderId: "ORDER-001",
          tenantId: TenantA.id,
          clickId: TenantA.click1,
          trackingPublicId: "trk_demo_002",
        },
        order001TenantId: TenantA.id,
        order001TrackingPublicId: "trk_demo_002",
      })
    );
    expect(result.assertions.find((a) => a.id === "D7")?.status).toBe("failed");
    expect(result.assertions.find((a) => a.id === "D7")?.expected).toBe(
      "trk_demo_001"
    );
  });

  it("11. Tenant B has no click → D8 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({ tenantBClickCount: 0 })
    );
    expect(result.assertions.find((a) => a.id === "D8")?.status).toBe("failed");
  });

  it("12. ACTIVE UrlVersion uniqueness violation → D9 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        activeUrlVersionUniquenessViolations: 1,
      })
    );
    expect(result.assertions.find((a) => a.id === "D9")?.status).toBe("failed");
  });

  it("13. ACTIVE UrlVersion count not equal to 3 → D10 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({ activeUrlVersionCount: 1 })
    );
    const d10 = result.assertions.find((a) => a.id === "D10");
    expect(d10?.status).toBe("failed");
    expect(d10?.expected).toBe(EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3);
  });

  it("14. fixture IDs absent → D2 fail and assert throws DEPTH_FIXTURES_MISSING", () => {
    const snap = buildPassingSeededRestoreDepthSnapshot({
      tenantIds: ["not-a-fixture"],
      tenantCount: 1,
    });
    expect(evaluateSeededRestoreDepth(snap).assertions.find((a) => a.id === "D2")
      ?.status).toBe("failed");
    try {
      assertSeededRestoreDepth(snap);
      expect.unreachable("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(BackupError);
      expect((error as BackupError).code).toBe("DEPTH_FIXTURES_MISSING");
    }
  });

  it("15. identical source/restore depth snapshots pass D11", () => {
    const a = buildPassingSeededRestoreDepthSnapshot();
    const b = buildPassingSeededRestoreDepthSnapshot();
    const d11 = compareSeededRestoreDepthSnapshots(a, b);
    expect(d11.status).toBe("passed");
    const full = evaluateSeededRestoreDepthWithSourceCompare(a, b);
    expect(full.status).toBe("passed");
    expect(full.assertions.some((x) => x.id === "D11")).toBe(true);
  });

  it("16. relevant source field changed → D11 failure", () => {
    const source = buildPassingSeededRestoreDepthSnapshot();
    const changed = buildPassingSeededRestoreDepthSnapshot({
      campaignCountTenantA: 99,
    });
    const d11 = compareSeededRestoreDepthSnapshots(source, changed);
    expect(d11.status).toBe("failed");
    expect(d11.actual).toMatchObject({
      mismatchedKeys: expect.arrayContaining(["campaignCountTenantA"]),
    });
  });

  it("17-18. failure messages do not contain password or credential URL", () => {
    const secretUrl =
      "postgresql://adlinklab:SuperSecretPassword99@127.0.0.1:5432/adlinklab";
    const snap = buildPassingSeededRestoreDepthSnapshot({
      order001TrackingPublicId: secretUrl,
      order001: {
        orderId: "ORDER-001",
        tenantId: TenantA.id,
        clickId: TenantA.click1,
        trackingPublicId: secretUrl,
      },
    });
    try {
      assertSeededRestoreDepth(snap);
      expect.unreachable("should throw");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      expect(msg).not.toMatch(/SuperSecretPassword99/);
      expect(msg).not.toMatch(/postgresql:\/\/adlinklab:SuperSecretPassword99@/i);
      // redaction may leave host/db; password must be gone
      expect((error as BackupError).code).toMatch(/^DEPTH_/);
    }
  });

  it("snapshotSeededRestoreDepth requires explicit target", async () => {
    await expect(snapshotSeededRestoreDepth({})).rejects.toMatchObject({
      code: "DEPTH_TARGET_REQUIRED",
    });
  });

  it("snapshotSeededRestoreDepth works with injectable queryFn", async () => {
    const snap = await snapshotSeededRestoreDepth({
      queryFn: async (sql, params = []) => {
        if (sql.includes("FROM tenants")) {
          return [{ id: TenantA.id }, { id: TenantB.id }];
        }
        if (sql.includes("FROM campaigns")) {
          expect(params[0]).toBe(TenantA.id);
          return [{ n: 2 }];
        }
        if (sql.includes("FROM tracking_links")) {
          return EXPECTED_TRACKING_PUBLIC_IDS_TENANT_A.map((public_id) => ({
            public_id,
          }));
        }
        if (sql.includes("ORDER-001")) {
          return [
            {
              order_id: "ORDER-001",
              tenant_id: TenantA.id,
              click_id: TenantA.click1,
              public_id: "trk_demo_001",
            },
          ];
        }
        if (sql.includes("HAVING count")) return [];
        if (sql.includes("FROM url_versions WHERE status")) {
          return [{ n: 3 }];
        }
        if (sql.includes("FROM clicks")) {
          expect(params[0]).toBe(TenantB.id);
          return [{ n: 1 }];
        }
        return [];
      },
    });
    expect(evaluateSeededRestoreDepth(snap).status).toBe("passed");
  });

  it("assertSeededRestoreDepth returns result when passing", () => {
    const result = assertSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot()
    );
    expect(result.status).toBe("passed");
    expect(result.passedCount).toBe(10);
  });

  it("export helper keeps expected tracking ids stable", () => {
    expect(EXPECTED_TRACKING_PUBLIC_IDS_TENANT_A).toEqual([
      "trk_demo_001",
      "trk_demo_002",
      "trk_demo_003",
    ]);
  });
});

describe("Phase 12.2-A does not alter shallow dataVerification contract", () => {
  it("documents that depth result is separate from dataVerification passed", () => {
    // Structural guard: SeededRestoreDepthResult uses `status`, not dataVerification.
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot()
    );
    expect(result).toHaveProperty("status", "passed");
    expect(result).not.toHaveProperty("dataVerification");
    const snap: SeededRestoreDepthSnapshot =
      buildPassingSeededRestoreDepthSnapshot();
    expect(snap.activeUrlVersionCount).toBe(3);
  });
});
