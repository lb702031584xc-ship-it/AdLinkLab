/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
/**
 * 商品库相关测试的共享 in-memory fake Prisma（非 .test.ts，不会被 vitest 直接执行）。
 *
 * 支持：create/findUnique/findFirst/findMany/update/upsert/count/delete，
 * where 操作符：in/lt/lte/gt/gte/contains(+mode insensitive)、复合唯一键
 * 与 OR/AND 逻辑组合（递归子 where）。
 * （如 tenantId_channel_entityType_entityId）、update 的 { increment }。
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";

export type Row = Record<string, any>;

const OPERATORS = new Set([
  "in",
  "notIn",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "startsWith",
  "endsWith",
  "mode",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    !(v instanceof Date)
  );
}

function matchesValue(value: any, cond: any): boolean {
  if (cond === null || cond === undefined) {
    return value === null || value === undefined;
  }
  if (cond instanceof Date) {
    const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return t === cond.getTime();
  }
  if (!isPlainObject(cond)) return value === cond;
  const keys = Object.keys(cond);
  if (keys.some((k) => OPERATORS.has(k))) {
    return keys.every((k) => {
      switch (k) {
        case "in":
          return Array.isArray(cond.in) && cond.in.includes(value);
        case "notIn":
          return Array.isArray(cond.notIn) && !cond.notIn.includes(value);
        case "lt":
          return value < (cond.lt as any);
        case "lte":
          return value <= (cond.lte as any);
        case "gt":
          return value > (cond.gt as any);
        case "gte":
          return value >= (cond.gte as any);
        case "contains": {
          const s = String(value ?? "");
          const q = String(cond.contains ?? "");
          return (cond as any).mode === "insensitive"
            ? s.toLowerCase().includes(q.toLowerCase())
            : s.includes(q);
        }
        case "mode":
          return true;
        default:
          return true;
      }
    });
  }
  // 复合唯一键（如 tenantId_channel_entityType_entityId: {...}）
  return keys.every((sk) => matchesValue((value ?? {})[sk], (cond as any)[sk]));
}

export function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    // 逻辑组合子（Prisma OR/AND）：元素为子 where 数组，递归匹配。
    if (key === "OR")
      return (
        Array.isArray(cond) && cond.some((c) => matchesWhere(row, c as Row))
      );
    if (key === "AND")
      return (
        Array.isArray(cond) && cond.every((c) => matchesWhere(row, c as Row))
      );
    if (key in row) return matchesValue(row[key], cond);
    // 复合唯一键：row 上没有该 key，cond 为普通对象 → 逐子键匹配 row。
    if (isPlainObject(cond)) {
      return Object.entries(cond).every(([sk, sv]) => matchesValue(row[sk], sv));
    }
    return false;
  });
}

function applyData(row: Row, data: Row): void {
  for (const [k, v] of Object.entries(data)) {
    if (isPlainObject(v) && "increment" in v) {
      row[k] = (row[k] ?? 0) + (v.increment as number);
    } else {
      row[k] = v;
    }
  }
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of specs.reverse()) {
    const [key, dir] = Object.entries(spec)[0] as [string, string];
    out.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      const at = av instanceof Date ? av.getTime() : av;
      const bt = bv instanceof Date ? bv.getTime() : bv;
      if (at === bt) return 0;
      if (at === null || at === undefined) return 1;
      if (bt === null || bt === undefined) return -1;
      const c = at < bt ? -1 : 1;
      return dir === "desc" ? -c : c;
    });
  }
  return out;
}

export function makeDelegate(store: Row[]) {
  return {
    create: async ({ data }: any) => {
      const row = { id: randomUUID(), ...data };
      store.push(row);
      return { ...row };
    },
    findUnique: async ({ where }: any) =>
      store.find((r) => matchesWhere(r, where)) ?? null,
    findFirst: async ({ where, orderBy }: any) => {
      const rows = sortRows(
        store.filter((r) => matchesWhere(r, where)),
        orderBy
      );
      return rows[0] ?? null;
    },
    findMany: async ({ where, orderBy, skip, take }: any) => {
      let rows = sortRows(
        store.filter((r) => matchesWhere(r, where)),
        orderBy
      );
      if (skip) rows = rows.slice(skip);
      if (take !== undefined) rows = rows.slice(0, take);
      return rows.map((r) => ({ ...r }));
    },
    update: async ({ where, data }: any) => {
      const row = store.find((r) => matchesWhere(r, where));
      if (!row) throw new Error("record not found");
      applyData(row, data);
      return { ...row };
    },
    upsert: async ({ where, create, update }: any) => {
      const row = store.find((r) => matchesWhere(r, where));
      if (row) {
        applyData(row, update);
        return { ...row };
      }
      const nrow = { id: randomUUID(), ...create };
      store.push(nrow);
      return { ...nrow };
    },
    count: async ({ where }: any) =>
      store.filter((r) => matchesWhere(r, where)).length,
    delete: async ({ where }: any) => {
      const idx = store.findIndex((r) => matchesWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      const [row] = store.splice(idx, 1);
      return { ...row };
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (let i = store.length - 1; i >= 0; i--) {
        if (matchesWhere(store[i], where)) {
          store.splice(i, 1);
          count += 1;
        }
      }
      return { count };
    },
  };
}

export interface CatalogFakeCtx {
  affiliateNetwork: Row[];
  adminGrant: Row[];
  adminGrantAudit: Row[];
  networkProduct: Row[];
  brandProfile: Row[];
  catalogBlacklist: Row[];
  catalogWhitelist: Row[];
  catalogScreeningPreset: Row[];
  catalogMerchantPolicy: Row[];
  catalogMerchantSignal: Row[];
  catalogSyncJob: Row[];
  aiSetting: Row[];
  merchant: Row[];
  offer: Row[];
  click: Row[];
  conversion: Row[];
  order: Row[];
  launchArchive: Row[];
}

/** 构造一个覆盖商品库全链路表的 fake PrismaClient。 */
export function makeCatalogFakePrisma(
  overrides: Partial<CatalogFakeCtx> = {}
): { prisma: PrismaClient; ctx: CatalogFakeCtx } {
  const ctx: CatalogFakeCtx = {
    affiliateNetwork: [],
    adminGrant: [],
    adminGrantAudit: [],
    networkProduct: [],
    brandProfile: [],
    catalogBlacklist: [],
    catalogWhitelist: [],
    catalogScreeningPreset: [],
    catalogMerchantPolicy: [],
    catalogMerchantSignal: [],
    catalogSyncJob: [],
    aiSetting: [],
    merchant: [],
    offer: [],
    click: [],
    conversion: [],
    order: [],
    launchArchive: [],
    ...overrides,
  };
  const prisma = Object.fromEntries(
    Object.entries(ctx).map(([k, store]) => [k, makeDelegate(store as Row[])])
  ) as unknown as PrismaClient;
  return { prisma, ctx };
}

export const TEST_TENANT = "11111111-1111-4111-8111-111111111111";
export const TEST_USER = "22222222-2222-4222-8222-222222222222";
export const TEST_NETWORK = "33333333-3333-4333-8333-333333333333";

/** 一条有效的 catalog-sync 授权（白名单含 kind）。 */
export function activeGrant(kind: string, extra: Partial<Row> = {}): Row {
  return {
    id: randomUUID(),
    tenantId: TEST_TENANT,
    capability: "catalog-sync",
    applicationId: null,
    applicantId: TEST_USER,
    approverId: "99999999-9999-4999-8999-999999999999",
    whitelist: [kind],
    usageLimit: {},
    usageCount: 0,
    status: "active",
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 30 * 86400 * 1000),
    revokedReason: null,
    createdAt: new Date(),
    ...extra,
  };
}

export function testNetwork(overrides: Partial<Row> = {}): Row {
  return {
    id: TEST_NETWORK,
    tenantId: TEST_TENANT,
    name: "Test Network",
    kind: "yeahpromos",
    website: null,
    apiConfigured: false,
    apiKeyRef: null,
    apiBaseUrl: null,
    apiProductsPath: null,
    syncMode: "session",
    sessionRef: null,
    sessionStatus: "NEVER",
    sessionUpdatedAt: null,
    sessionError: null,
    sessionListPath: null,
    sessionExpireStrikes: 0,
    lastPullAt: null,
    pullStatus: "NEVER",
    pullError: null,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}
