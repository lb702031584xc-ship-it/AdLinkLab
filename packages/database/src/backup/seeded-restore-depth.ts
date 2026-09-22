/**
 * Phase 12.2-A — Seeded restore depth assertions (Phase 1.3 fixture contract).
 *
 * Operates only against an explicitly supplied target (queryFn or connectionString).
 * Does not read DATABASE_URL, seed, migrate, restore, or mutate databases.
 *
 * Layer 4 only — must NOT be conflated with restoreVerify `dataVerification: "passed"`
 * (which remains shallow: tenantCount > 0).
 */
import { Client } from "pg";
import { TenantA, TenantB } from "../fixtures/ids.js";
import { BackupError } from "./types.js";
import { redactConnectionString } from "./safety.js";

/** Fixture contract version — ACTIVE UrlVersion count === 3 is fixture-specific. */
export const SEEDED_RESTORE_DEPTH_FIXTURE_VERSION = "phase-1.3" as const;

export const EXPECTED_TRACKING_PUBLIC_IDS_TENANT_A = [
  "trk_demo_001",
  "trk_demo_002",
  "trk_demo_003",
] as const;

/** Phase 1.3 fixture: exactly three ACTIVE UrlVersions in the seeded dataset. */
export const EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3 = 3;

export type SeededDepthAssertionId =
  | "D1"
  | "D2"
  | "D3"
  | "D4"
  | "D5"
  | "D6"
  | "D7"
  | "D8"
  | "D9"
  | "D10"
  | "D11";

export type SeededDepthAssertionStatus = "passed" | "failed";

export interface SeededDepthAssertionResult {
  id: SeededDepthAssertionId;
  status: SeededDepthAssertionStatus;
  expected: unknown;
  actual: unknown;
  message?: string;
}

export interface SeededRestoreDepthResult {
  status: "passed" | "failed";
  fixtureVersion: typeof SEEDED_RESTORE_DEPTH_FIXTURE_VERSION;
  assertions: SeededDepthAssertionResult[];
  passedCount: number;
  failedCount: number;
}

export interface Order001ChainSnapshot {
  orderId: string;
  tenantId: string;
  clickId: string;
  trackingPublicId: string;
}

/**
 * Structured depth snapshot — enough for D1–D11; no large dumps / secrets.
 */
export interface SeededRestoreDepthSnapshot {
  tenantCount: number;
  tenantIds: string[];
  campaignCountTenantA: number;
  trackingPublicIdsTenantA: string[];
  /** Null when ORDER-001 JOIN chain is missing. */
  order001: Order001ChainSnapshot | null;
  order001TenantId: string | null;
  order001TrackingPublicId: string | null;
  tenantBClickCount: number;
  /**
   * Fixture-specific: Phase 1.3 seed yields exactly 3 ACTIVE UrlVersions.
   * Not a general production business rule.
   */
  activeUrlVersionCount: number;
  activeUrlVersionUniquenessViolations: number;
}

export type SeededDepthQueryFn = (
  sql: string,
  params?: unknown[]
) => Promise<Record<string, unknown>[]>;

export interface SnapshotSeededRestoreDepthOptions {
  /**
   * Explicit query function against the target DB.
   * Prefer this in unit tests.
   */
  queryFn?: SeededDepthQueryFn;
  /**
   * Explicit connection string for the target DB only.
   * Must be supplied by the caller — never read from process.env.DATABASE_URL.
   */
  connectionString?: string;
}

function pass(
  id: SeededDepthAssertionId,
  expected: unknown,
  actual: unknown
): SeededDepthAssertionResult {
  return { id, status: "passed", expected, actual };
}

function fail(
  id: SeededDepthAssertionId,
  expected: unknown,
  actual: unknown,
  message: string
): SeededDepthAssertionResult {
  return { id, status: "failed", expected, actual, message };
}

function summarize(assertions: SeededDepthAssertionResult[]): SeededRestoreDepthResult {
  const passedCount = assertions.filter((a) => a.status === "passed").length;
  const failedCount = assertions.filter((a) => a.status === "failed").length;
  return {
    status: failedCount === 0 ? "passed" : "failed",
    fixtureVersion: SEEDED_RESTORE_DEPTH_FIXTURE_VERSION,
    assertions,
    passedCount,
    failedCount,
  };
}

function mapDepthErrorCode(
  failed: SeededDepthAssertionResult[]
): string {
  const ids = new Set(failed.map((f) => f.id));
  if (ids.has("D2") || (ids.has("D1") && failed.some((f) => f.id === "D1"))) {
    const d2 = failed.find((f) => f.id === "D2");
    if (d2) return "DEPTH_FIXTURES_MISSING";
  }
  if (ids.has("D2")) return "DEPTH_FIXTURES_MISSING";
  if (ids.has("D6") || ids.has("D3") || ids.has("D8")) return "DEPTH_TENANT_MISMATCH";
  if (ids.has("D5") || ids.has("D7")) return "DEPTH_ATTRIBUTION_MISMATCH";
  if (ids.has("D9") || ids.has("D10")) return "DEPTH_URL_VERSION_MISMATCH";
  return "DEPTH_ASSERTION_FAILED";
}

/**
 * Evaluate D1–D10 against a snapshot (no DB access).
 */
export function evaluateSeededRestoreDepth(
  snapshot: SeededRestoreDepthSnapshot
): SeededRestoreDepthResult {
  const assertions: SeededDepthAssertionResult[] = [];

  // D1
  assertions.push(
    snapshot.tenantCount === 2
      ? pass("D1", 2, snapshot.tenantCount)
      : fail("D1", 2, snapshot.tenantCount, "tenantCount must be 2 for Phase 1.3 fixtures")
  );

  // D2
  const hasA = snapshot.tenantIds.includes(TenantA.id);
  const hasB = snapshot.tenantIds.includes(TenantB.id);
  assertions.push(
    hasA && hasB
      ? pass("D2", [TenantA.id, TenantB.id], snapshot.tenantIds)
      : fail(
          "D2",
          [TenantA.id, TenantB.id],
          snapshot.tenantIds,
          "fixture Tenant A and Tenant B IDs must both be present"
        )
  );

  // D3
  assertions.push(
    snapshot.campaignCountTenantA === 2
      ? pass("D3", 2, snapshot.campaignCountTenantA)
      : fail(
          "D3",
          2,
          snapshot.campaignCountTenantA,
          "Tenant A campaign count must be 2"
        )
  );

  // D4
  const expectedLinks = [...EXPECTED_TRACKING_PUBLIC_IDS_TENANT_A];
  const linksOk =
    snapshot.trackingPublicIdsTenantA.length === expectedLinks.length &&
    expectedLinks.every((id, i) => snapshot.trackingPublicIdsTenantA[i] === id);
  assertions.push(
    linksOk
      ? pass("D4", expectedLinks, snapshot.trackingPublicIdsTenantA)
      : fail(
          "D4",
          expectedLinks,
          snapshot.trackingPublicIdsTenantA,
          "Tenant A tracking publicIds must exactly match Phase 1.3 fixtures"
        )
  );

  // D5
  assertions.push(
    snapshot.order001 !== null && snapshot.order001.orderId === "ORDER-001"
      ? pass("D5", "ORDER-001 chain", snapshot.order001)
      : fail("D5", "ORDER-001 chain", snapshot.order001, "ORDER-001 attribution JOIN chain missing")
  );

  // D6
  assertions.push(
    snapshot.order001TenantId === TenantA.id
      ? pass("D6", TenantA.id, snapshot.order001TenantId)
      : fail(
          "D6",
          TenantA.id,
          snapshot.order001TenantId,
          "ORDER-001 must belong to Tenant A"
        )
  );

  // D7 — explicit publicId (not merely JOIN existence)
  assertions.push(
    snapshot.order001TrackingPublicId === "trk_demo_001"
      ? pass("D7", "trk_demo_001", snapshot.order001TrackingPublicId)
      : fail(
          "D7",
          "trk_demo_001",
          snapshot.order001TrackingPublicId,
          "ORDER-001 chain must resolve to tracking publicId trk_demo_001"
        )
  );

  // D8
  assertions.push(
    snapshot.tenantBClickCount >= 1
      ? pass("D8", ">=1", snapshot.tenantBClickCount)
      : fail("D8", ">=1", snapshot.tenantBClickCount, "Tenant B must have at least one click")
  );

  // D9
  assertions.push(
    snapshot.activeUrlVersionUniquenessViolations === 0
      ? pass("D9", 0, snapshot.activeUrlVersionUniquenessViolations)
      : fail(
          "D9",
          0,
          snapshot.activeUrlVersionUniquenessViolations,
          "ACTIVE UrlVersion uniqueness violations must be 0"
        )
  );

  // D10 — Phase 1.3 fixture contract only (not a production business rule)
  assertions.push(
    snapshot.activeUrlVersionCount === EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3
      ? pass(
          "D10",
          EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3,
          snapshot.activeUrlVersionCount
        )
      : fail(
          "D10",
          EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3,
          snapshot.activeUrlVersionCount,
          "Phase 1.3 fixture contract: ACTIVE UrlVersion count must be exactly 3"
        )
  );

  return summarize(assertions);
}

/**
 * Assert D1–D10; throws BackupError when any assertion fails.
 * Returns the structured result when all pass.
 */
export function assertSeededRestoreDepth(
  snapshot: SeededRestoreDepthSnapshot
): SeededRestoreDepthResult {
  const result = evaluateSeededRestoreDepth(snapshot);
  if (result.status === "passed") return result;

  const failed = result.assertions.filter((a) => a.status === "failed");
  const code = mapDepthErrorCode(failed);
  const detail = failed
    .map(
      (f) =>
        `${f.id}: expected=${JSON.stringify(f.expected)} actual=${JSON.stringify(f.actual)}`
    )
    .join("; ");
  throw new BackupError(
    code,
    redactConnectionString(
      `Seeded restore depth failed (${failed.map((f) => f.id).join(",")}): ${detail}`
    )
  );
}

/** Depth fields compared for D11 (source unchanged). */
const D11_COMPARE_KEYS: (keyof SeededRestoreDepthSnapshot)[] = [
  "tenantCount",
  "tenantIds",
  "campaignCountTenantA",
  "trackingPublicIdsTenantA",
  "order001",
  "order001TenantId",
  "order001TrackingPublicId",
  "tenantBClickCount",
  "activeUrlVersionCount",
  "activeUrlVersionUniquenessViolations",
];

/**
 * D11 — compare two snapshots supplied by the caller (no implicit DB access).
 */
export function compareSeededRestoreDepthSnapshots(
  sourceSnapshot: SeededRestoreDepthSnapshot,
  restoreOrPostSourceSnapshot: SeededRestoreDepthSnapshot
): SeededDepthAssertionResult {
  const mismatches: string[] = [];
  for (const key of D11_COMPARE_KEYS) {
    const a = JSON.stringify(sourceSnapshot[key]);
    const b = JSON.stringify(restoreOrPostSourceSnapshot[key]);
    if (a !== b) mismatches.push(key);
  }
  if (mismatches.length === 0) {
    return pass("D11", "unchanged", "unchanged");
  }
  return fail(
    "D11",
    "identical depth fields",
    { mismatchedKeys: mismatches },
    `source depth snapshot differs on: ${mismatches.join(", ")}`
  );
}

/**
 * Evaluate D11 and merge into a full D1–D11 result using the restore snapshot for D1–D10.
 */
export function evaluateSeededRestoreDepthWithSourceCompare(
  sourceSnapshot: SeededRestoreDepthSnapshot,
  restoreSnapshot: SeededRestoreDepthSnapshot
): SeededRestoreDepthResult {
  const base = evaluateSeededRestoreDepth(restoreSnapshot);
  const d11 = compareSeededRestoreDepthSnapshots(
    sourceSnapshot,
    restoreSnapshot
  );
  return summarize([...base.assertions, d11]);
}

/**
 * Load a depth snapshot from an explicitly supplied target.
 * Caller must pass queryFn or connectionString — never reads DATABASE_URL.
 */
export async function snapshotSeededRestoreDepth(
  options: SnapshotSeededRestoreDepthOptions
): Promise<SeededRestoreDepthSnapshot> {
  if (options.queryFn) {
    return loadSnapshot(options.queryFn);
  }
  if (!options.connectionString?.trim()) {
    throw new BackupError(
      "DEPTH_TARGET_REQUIRED",
      "snapshotSeededRestoreDepth requires explicit queryFn or connectionString (never reads DATABASE_URL)"
    );
  }
  const client = new Client({
    connectionString: options.connectionString.trim(),
  });
  await client.connect();
  try {
    const query: SeededDepthQueryFn = async (sql, params = []) => {
      const res = await client.query(sql, params);
      return res.rows as Record<string, unknown>[];
    };
    return await loadSnapshot(query);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function loadSnapshot(
  query: SeededDepthQueryFn
): Promise<SeededRestoreDepthSnapshot> {
  const tenants = await query(`SELECT id FROM tenants ORDER BY id`);
  const campaignsA = await query(
    `SELECT count(*)::int AS n FROM campaigns WHERE tenant_id = $1`,
    [TenantA.id]
  );
  const tracking = await query(
    `SELECT public_id FROM tracking_links WHERE tenant_id = $1 ORDER BY public_id`,
    [TenantA.id]
  );
  const orderRows = await query(
    `SELECT o.order_id AS order_id, o.tenant_id AS tenant_id, c.id AS click_id, t.public_id AS public_id
     FROM orders o
     JOIN conversions cv ON cv.id = o.conversion_id
     JOIN clicks c ON c.id = cv.click_id
     JOIN tracking_links t ON t.id = c.tracking_link_id
     WHERE o.order_id = 'ORDER-001'`
  );
  const activeViolations = await query(
    `SELECT tenant_id, entity_type, entity_id, count(*)::int AS n
     FROM url_versions WHERE status = 'ACTIVE'
     GROUP BY 1, 2, 3 HAVING count(*) <> 1`
  );
  const activeCount = await query(
    `SELECT count(*)::int AS n FROM url_versions WHERE status = 'ACTIVE'`
  );
  const clicksB = await query(
    `SELECT count(*)::int AS n FROM clicks WHERE tenant_id = $1`,
    [TenantB.id]
  );

  const orderRow = orderRows[0];
  const order001: Order001ChainSnapshot | null = orderRow
    ? {
        orderId: String(orderRow.order_id),
        tenantId: String(orderRow.tenant_id),
        clickId: String(orderRow.click_id),
        trackingPublicId: String(orderRow.public_id),
      }
    : null;

  return {
    tenantCount: tenants.length,
    tenantIds: tenants.map((t) => String(t.id)),
    campaignCountTenantA: Number(campaignsA[0]?.n ?? 0),
    trackingPublicIdsTenantA: tracking.map((t) => String(t.public_id)),
    order001,
    order001TenantId: order001?.tenantId ?? null,
    order001TrackingPublicId: order001?.trackingPublicId ?? null,
    tenantBClickCount: Number(clicksB[0]?.n ?? 0),
    activeUrlVersionCount: Number(activeCount[0]?.n ?? 0),
    activeUrlVersionUniquenessViolations: activeViolations.length,
  };
}

/** Build a valid Phase 1.3-shaped snapshot for unit tests. */
export function buildPassingSeededRestoreDepthSnapshot(
  overrides: Partial<SeededRestoreDepthSnapshot> = {}
): SeededRestoreDepthSnapshot {
  return {
    tenantCount: 2,
    tenantIds: [TenantA.id, TenantB.id],
    campaignCountTenantA: 2,
    trackingPublicIdsTenantA: [...EXPECTED_TRACKING_PUBLIC_IDS_TENANT_A],
    order001: {
      orderId: "ORDER-001",
      tenantId: TenantA.id,
      clickId: TenantA.click1,
      trackingPublicId: "trk_demo_001",
    },
    order001TenantId: TenantA.id,
    order001TrackingPublicId: "trk_demo_001",
    tenantBClickCount: 1,
    activeUrlVersionCount: EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3,
    activeUrlVersionUniquenessViolations: 0,
    ...overrides,
  };
}
