/**
 * Offer 测试优先分单测：
 * - computeTestPriority：初筛/广告/佣金三腿全分支 + reasons 内容与排序
 * - deriveCommissionPerSaleUsd：各 commissionType 写入方口径实证
 *   （fixed/percent 值即金额；percentage/% 需 ×均价；未知不猜）
 * - parseCatalogIdempotencyKey：格式边界
 * - attachTestPriorities：fake prisma 批量关联（一次查询、租户隔离、中性口径）
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import {
  attachTestPriorities,
  computeTestPriority,
  deriveCommissionPerSaleUsd,
  parseCatalogIdempotencyKey,
  type OfferForPriority,
} from "./offer-priority.js";

const base = {
  prescreenVerdict: null as string | null,
  commissionPerSaleUsd: null as number | null,
  adCount: null as number | null,
  lastAdCount: null as number | null,
  hasProductLink: false,
};

describe("computeTestPriority 初筛腿", () => {
  it("go=30 / caution=18 / unknown=8 / stop=0 / 未筛=5", () => {
    expect(computeTestPriority({ ...base, prescreenVerdict: "go" }).score).toBe(30 + 12 + 8);
    expect(computeTestPriority({ ...base, prescreenVerdict: "caution" }).score).toBe(18 + 12 + 8);
    expect(computeTestPriority({ ...base, prescreenVerdict: "unknown" }).score).toBe(8 + 12 + 8);
    expect(computeTestPriority({ ...base, prescreenVerdict: "stop" }).score).toBe(0 + 12 + 8);
    expect(computeTestPriority({ ...base, prescreenVerdict: null }).score).toBe(5 + 12 + 8);
  });

  it("标签与结论一致", () => {
    expect(computeTestPriority({ ...base, prescreenVerdict: "go" }).reasons).toContain("初筛通过");
    expect(computeTestPriority({ ...base, prescreenVerdict: "caution" }).reasons).toContain("初筛谨慎");
    expect(computeTestPriority({ ...base, prescreenVerdict: "stop" }).reasons).toContain("初筛不建议投放");
    expect(computeTestPriority({ ...base }).reasons).toContain("未做初筛");
  });
});

describe("computeTestPriority 广告腿", () => {
  it("无关联商品 → 中性 12；关联但未计算 → 中性 12（标签不同）", () => {
    const noLink = computeTestPriority({ ...base, hasProductLink: false, adCount: 10 });
    expect(noLink.score).toBe(5 + 12 + 8);
    expect(noLink.reasons).toContain("未关联商品，广告数中性");
    const uncomputed = computeTestPriority({ ...base, hasProductLink: true, adCount: null });
    expect(uncomputed.score).toBe(5 + 12 + 8);
    expect(uncomputed.reasons).toContain("广告数未计算");
  });

  it("分档：sweet=40 / small=30 / hot=28 / redocean=14 / none=4", () => {
    const linked = { ...base, hasProductLink: true };
    expect(computeTestPriority({ ...linked, adCount: 10, lastAdCount: null }).score).toBe(5 + 40 + 8);
    expect(computeTestPriority({ ...linked, adCount: 3, lastAdCount: null }).score).toBe(5 + 30 + 8);
    expect(computeTestPriority({ ...linked, adCount: 30, lastAdCount: null }).score).toBe(5 + 28 + 8);
    expect(computeTestPriority({ ...linked, adCount: 60, lastAdCount: null }).score).toBe(5 + 14 + 8);
    expect(computeTestPriority({ ...linked, adCount: 0, lastAdCount: null }).score).toBe(5 + 4 + 8);
  });

  it("趋势：new +3、active +2（封顶 40）；stopped 封顶 4 并换标签", () => {
    const linked = { ...base, hasProductLink: true };
    // small 30 + new 3 = 33
    const nw = computeTestPriority({ ...linked, adCount: 3, lastAdCount: 0 });
    expect(nw.score).toBe(5 + 33 + 8);
    expect(nw.reasons).toContain("广告新投放");
    // small 30 + active 2 = 32
    const act = computeTestPriority({ ...linked, adCount: 3, lastAdCount: 2 });
    expect(act.score).toBe(5 + 32 + 8);
    expect(act.reasons).toContain("广告持续在投");
    // sweet 40 + active 2 → 封顶 40
    expect(computeTestPriority({ ...linked, adCount: 10, lastAdCount: 9 }).score).toBe(5 + 40 + 8);
    // stopped：上次 6、本次 0 → 广告分封顶 4，标签=疑似停投（非"暂无广告在投"）
    const stopped = computeTestPriority({ ...linked, adCount: 0, lastAdCount: 6 });
    expect(stopped.score).toBe(5 + 4 + 8);
    expect(stopped.reasons).toContain("疑似停投");
    expect(stopped.reasons).not.toContain("暂无广告在投");
  });
});

describe("computeTestPriority 佣金腿与 reasons 排序", () => {
  it("分档：≥50→30 / ≥25→24 / ≥8→16 / >0→8 / =0→0 / 未知→8", () => {
    expect(computeTestPriority({ ...base, commissionPerSaleUsd: 50 }).score).toBe(5 + 12 + 30);
    expect(computeTestPriority({ ...base, commissionPerSaleUsd: 25 }).score).toBe(5 + 12 + 24);
    expect(computeTestPriority({ ...base, commissionPerSaleUsd: 8 }).score).toBe(5 + 12 + 16);
    expect(computeTestPriority({ ...base, commissionPerSaleUsd: 7.99 }).score).toBe(5 + 12 + 8);
    expect(computeTestPriority({ ...base, commissionPerSaleUsd: 0 }).score).toBe(5 + 12 + 0);
    expect(computeTestPriority({ ...base, commissionPerSaleUsd: null }).score).toBe(5 + 12 + 8);
    expect(computeTestPriority({ ...base, commissionPerSaleUsd: 116.87 }).reasons).toContain("单笔佣金 $116.87");
    expect(computeTestPriority({ ...base }).reasons).toContain("佣金未知");
  });

  it("满分组合 = 100；reasons 按贡献从大到小、最多 4 条", () => {
    const r = computeTestPriority({
      prescreenVerdict: "go",
      commissionPerSaleUsd: 60,
      adCount: 10,
      lastAdCount: 0,
      hasProductLink: true,
    });
    expect(r.score).toBe(100);
    expect(r.reasons.length).toBeLessThanOrEqual(4);
    expect(r.reasons[0]).toBe("广告稳定投放（甜蜜点）");
    expect(r.reasons).toContain("初筛通过");
    expect(r.reasons).toContain("单笔佣金 $60.00");
    expect(r.reasons).toContain("广告新投放");
  });

  it("低把握组合：stop + 停投 + 低佣金，扣分标签齐全", () => {
    const r = computeTestPriority({
      prescreenVerdict: "stop",
      commissionPerSaleUsd: 5,
      adCount: 0,
      lastAdCount: 5,
      hasProductLink: true,
    });
    expect(r.score).toBe(0 + 4 + 8);
    expect(r.reasons).toContain("初筛不建议投放");
    expect(r.reasons).toContain("疑似停投");
    expect(r.reasons).toContain("单笔佣金 $5.00");
  });
});

describe("deriveCommissionPerSaleUsd", () => {
  it("fixed：值即金额（大小写不敏感）", () => {
    expect(deriveCommissionPerSaleUsd({ commissionValue: 116.87, commissionType: "fixed" })).toBe(116.87);
    expect(deriveCommissionPerSaleUsd({ commissionValue: 20, commissionType: "FIXED" })).toBe(20);
  });

  it("percent（catalog-sync 口径）：值已是换算后金额，绝不再乘均价", () => {
    // catalog-sync 存入：commissionValue = 价格×佣金率÷100 = 899×13÷100 = 116.87，avgPrice=899。
    // 若误按费率再算一次会得到 1050.66（编造），必须直接取 116.87。
    expect(
      deriveCommissionPerSaleUsd({ commissionValue: 116.87, commissionType: "PERCENT", avgPrice: 899 })
    ).toBe(116.87);
    expect(
      deriveCommissionPerSaleUsd({ commissionValue: 116.87, commissionType: "percent", avgPrice: 899 })
    ).toBe(116.87);
  });

  it("percentage / %（表单口径）：值是百分比，需 ×均价；缺均价 → null", () => {
    expect(deriveCommissionPerSaleUsd({ commissionValue: 13, commissionType: "percentage", avgPrice: 899 })).toBe(116.87);
    expect(deriveCommissionPerSaleUsd({ commissionValue: 13, commissionType: "%", avgPrice: 200 })).toBe(26);
    expect(deriveCommissionPerSaleUsd({ commissionValue: 13, commissionType: "percentage", avgPrice: null })).toBeNull();
  });

  it("未知类型 / 缺值 → null（不猜）", () => {
    expect(deriveCommissionPerSaleUsd({ commissionValue: 50, commissionType: "cpa" })).toBeNull();
    expect(deriveCommissionPerSaleUsd({ commissionValue: 50, commissionType: null })).toBeNull();
    expect(deriveCommissionPerSaleUsd({ commissionValue: null, commissionType: "fixed" })).toBeNull();
    expect(deriveCommissionPerSaleUsd({ commissionValue: 0, commissionType: "fixed" })).toBe(0);
  });

  it("Decimal-like / 字符串数值可转", () => {
    expect(
      deriveCommissionPerSaleUsd({ commissionValue: { toNumber: () => 42.5 }, commissionType: "fixed" })
    ).toBe(42.5);
    expect(deriveCommissionPerSaleUsd({ commissionValue: "25.5", commissionType: "fixed" })).toBe(25.5);
  });
});

describe("parseCatalogIdempotencyKey", () => {
  it("标准格式与含冒号的 externalId", () => {
    expect(parseCatalogIdempotencyKey("catalog:net-1:ext-9")).toEqual({ networkId: "net-1", externalId: "ext-9" });
    expect(parseCatalogIdempotencyKey("catalog:net-1:ASIN:B0X")).toEqual({ networkId: "net-1", externalId: "ASIN:B0X" });
  });
  it("不合格式 → null", () => {
    expect(parseCatalogIdempotencyKey(null)).toBeNull();
    expect(parseCatalogIdempotencyKey(undefined)).toBeNull();
    expect(parseCatalogIdempotencyKey("")).toBeNull();
    expect(parseCatalogIdempotencyKey("manual:key")).toBeNull();
    expect(parseCatalogIdempotencyKey("catalog:")).toBeNull();
    expect(parseCatalogIdempotencyKey("catalog:net")).toBeNull();
    expect(parseCatalogIdempotencyKey("catalog::ext")).toBeNull();
    expect(parseCatalogIdempotencyKey("catalog:net:")).toBeNull();
  });
});

describe("attachTestPriorities", () => {
  const T = "tenant-x";
  interface ProductRow {
    tenantId: string;
    networkId: string;
    externalId: string;
    adCount: number | null;
    lastAdCount: number | null;
  }
  function makeFakePrisma(pool: ProductRow[]) {
    const findMany = vi.fn(
      async (args: {
        where: {
          tenantId: string;
          OR: Array<{ networkId: string; externalId: string }>;
        };
      }) =>
        pool
          .filter(
            (r) =>
              r.tenantId === args.where.tenantId &&
              args.where.OR.some(
                (p) => p.networkId === r.networkId && p.externalId === r.externalId
              )
          )
          .map((r) => ({
            networkId: r.networkId,
            externalId: r.externalId,
            adCount: r.adCount,
            lastAdCount: r.lastAdCount,
          }))
    );
    return {
      findMany,
      prisma: { networkProduct: { findMany } } as unknown as PrismaClient,
    };
  }

  it("批量关联：一次查询、广告数据生效、手动 Offer 中性、跨租户不串", async () => {
    const pool: ProductRow[] = [
      { tenantId: T, networkId: "net-1", externalId: "ext-sweet", adCount: 10, lastAdCount: 8 },
      // 同键但属于别的租户：不得被本租户的 Offer 命中
      { tenantId: "tenant-other", networkId: "net-1", externalId: "ext-foreign", adCount: 99, lastAdCount: 99 },
      { tenantId: T, networkId: "net-1", externalId: "ext-uncomputed", adCount: null, lastAdCount: null },
    ];
    const { prisma, findMany } = makeFakePrisma(pool);
    const offers: OfferForPriority[] = [
      { id: "o-sweet", prescreenVerdict: "go", commissionValue: 60, commissionType: "fixed", idempotencyKey: "catalog:net-1:ext-sweet" },
      { id: "o-manual", prescreenVerdict: null, commissionValue: 60, commissionType: "fixed", idempotencyKey: null },
      { id: "o-foreign", prescreenVerdict: null, commissionValue: 60, commissionType: "fixed", idempotencyKey: "catalog:net-1:ext-foreign" },
      { id: "o-uncomputed", prescreenVerdict: null, commissionValue: 60, commissionType: "fixed", idempotencyKey: "catalog:net-1:ext-uncomputed" },
    ];
    const out = await attachTestPriorities(prisma, T, offers);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.tenantId).toBe(T);

    const byId = new Map(out.map((o) => [o.id, o.testPriority]));
    // sweet 40（active +2 封顶）+ go 30 + 佣金 30 = 100
    expect(byId.get("o-sweet")?.score).toBe(100);
    // 手动 Offer：5 + 中性 12 + 30 = 47
    expect(byId.get("o-manual")?.score).toBe(47);
    expect(byId.get("o-manual")?.reasons).toContain("未关联商品，广告数中性");
    // 跨租户商品不得命中 → 同手动中性
    expect(byId.get("o-foreign")?.score).toBe(47);
    // 关联到商品但广告数未计算：12 中性，标签是"广告数未计算"
    expect(byId.get("o-uncomputed")?.score).toBe(47);
    expect(byId.get("o-uncomputed")?.reasons).toContain("广告数未计算");
  });

  it("prisma 缺失（memory 模式）→ 全部中性、不查库", async () => {
    const offers: OfferForPriority[] = [
      { id: "o1", prescreenVerdict: "go", commissionValue: 10, commissionType: "fixed", idempotencyKey: "catalog:net-1:ext-1" },
    ];
    const out = await attachTestPriorities(null, T, offers);
    expect(out[0].testPriority.score).toBe(30 + 12 + 16);
    expect(out[0].testPriority.reasons).toContain("未关联商品，广告数中性");
  });
});
