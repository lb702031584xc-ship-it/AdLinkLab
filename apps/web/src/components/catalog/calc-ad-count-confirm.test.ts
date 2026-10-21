/**
 * 广告数付费计算「预估 → 确认」的纯函数口径 + 本批 dict 新键（中英齐全、
 * 占位符完整）。计费组数公式与后端 preview/calc 同一套定义，锁死防漂移。
 */
import { describe, expect, it } from "vitest";
import { en, zh } from "../../i18n/dict/catalog";
import {
  calcAdCountConfirmFacts,
  formatUsdAmount,
  resolveStoredCalcDepth,
  type CalcAdCountPreviewData,
} from "./calc-ad-count-confirm";

const preview = (
  over: Partial<CalcAdCountPreviewData> = {}
): CalcAdCountPreviewData => ({
  allowed: true,
  keySource: "owner",
  groupsTotal: 10,
  groupsFresh: 4,
  groupsStale: 6,
  deadGroupsSkipped: 0,
  ...over,
});

describe("calcAdCountConfirmFacts", () => {
  it("增量模式：计费组数 = groupsStale，缓存跳过 = groupsFresh", () => {
    const f = calcAdCountConfirmFacts(preview(), { force: false, scope: "all" });
    expect(f.billableGroups).toBe(6);
    expect(f.freshSkipped).toBe(4);
    expect(f.deadSkipped).toBe(0);
    expect(f.allowed).toBe(true);
    expect(f.keySource).toBe("owner");
  });

  it("强制模式（全部）：计费组数 = groupsTotal，缓存不再跳过", () => {
    const f = calcAdCountConfirmFacts(preview(), { force: true, scope: "all" });
    expect(f.billableGroups).toBe(10);
    expect(f.freshSkipped).toBe(0);
  });

  it("强制 + 活口径：计费组数 = groupsTotal − deadGroupsSkipped", () => {
    const f = calcAdCountConfirmFacts(preview({ deadGroupsSkipped: 2 }), {
      force: true,
      scope: "alive",
    });
    expect(f.billableGroups).toBe(8);
    expect(f.deadSkipped).toBe(2);
  });

  it("活口径增量：计费组数仍按 groupsStale 口径展示，死组单独带出", () => {
    const f = calcAdCountConfirmFacts(preview({ deadGroupsSkipped: 2 }), {
      force: false,
      scope: "alive",
    });
    expect(f.billableGroups).toBe(6);
    expect(f.deadSkipped).toBe(2);
  });

  it("allowed=false / keySource=null 原样透传（确认框据此禁用确认）", () => {
    const f = calcAdCountConfirmFacts(
      preview({ allowed: false, keySource: null }),
      { force: false, scope: "all" }
    );
    expect(f.allowed).toBe(false);
    expect(f.keySource).toBeNull();
  });

  it("深度：缺省 12；opts 指定优先；preview 回显覆盖 opts（以服务端为准）", () => {
    expect(
      calcAdCountConfirmFacts(preview(), { force: false, scope: "all" }).depth
    ).toBe(12);
    expect(
      calcAdCountConfirmFacts(preview(), {
        force: false,
        scope: "all",
        depth: 4,
      }).depth
    ).toBe(4);
    expect(
      calcAdCountConfirmFacts(preview({ depth: 8 }), {
        force: false,
        scope: "all",
        depth: 4,
      }).depth
    ).toBe(8);
  });

  it("费用预估字段原样透传（前端不算钱）；preview 缺失 → null 不展示", () => {
    const f = calcAdCountConfirmFacts(
      preview({
        expectedQueries: 40,
        worstCaseQueries: 72,
        unitPriceUsd: 0.002,
        estimatedCostUsd: 0.08,
      }),
      { force: false, scope: "all", depth: 12 }
    );
    expect(f.expectedQueries).toBe(40);
    expect(f.worstCaseQueries).toBe(72);
    expect(f.unitPriceUsd).toBe(0.002);
    expect(f.estimatedCostUsd).toBe(0.08);
    const bare = calcAdCountConfirmFacts(preview(), {
      force: false,
      scope: "all",
    });
    expect(bare.expectedQueries).toBeNull();
    expect(bare.worstCaseQueries).toBeNull();
    expect(bare.unitPriceUsd).toBeNull();
    expect(bare.estimatedCostUsd).toBeNull();
  });
});

describe("resolveStoredCalcDepth / formatUsdAmount", () => {
  it("只接受 4/8/12，其余（脏值/缺失）→ null 回默认", () => {
    expect(resolveStoredCalcDepth("4")).toBe(4);
    expect(resolveStoredCalcDepth("8")).toBe(8);
    expect(resolveStoredCalcDepth("12")).toBe(12);
    expect(resolveStoredCalcDepth("5")).toBeNull();
    expect(resolveStoredCalcDepth("abc")).toBeNull();
    expect(resolveStoredCalcDepth("")).toBeNull();
    expect(resolveStoredCalcDepth(null)).toBeNull();
    expect(resolveStoredCalcDepth(undefined)).toBeNull();
  });

  it("金额格式化：最多 4 位小数、至少 2 位（小额不被舍成 0.00）", () => {
    expect(formatUsdAmount(0.004)).toBe("0.004");
    expect(formatUsdAmount(0.002)).toBe("0.002");
    expect(formatUsdAmount(0.08)).toBe("0.08");
    expect(formatUsdAmount(0.324)).toBe("0.324");
    expect(formatUsdAmount(0.3)).toBe("0.30");
    expect(formatUsdAmount(1)).toBe("1.00");
    expect(formatUsdAmount(12.5)).toBe("12.50");
    expect(formatUsdAmount(0)).toBe("0.00");
  });
});

describe("catalog dict 本批新键（calc/toolbar）", () => {
  const stringKeys = [
    "toolbarGroupEveryday",
    "toolbarGroupCompute",
    "calcScopeLabel",
    "calcScopeAll",
    "calcScopeAlive",
    "calcForceLabel",
    "calcForceWarning",
    "calcPreviewing",
    "calcConfirmTitle",
    "calcConfirmScopeAll",
    "calcConfirmScopeAlive",
    "calcConfirmModeForce",
    "calcConfirmModeIncremental",
    "calcBillingOwner",
    "calcBillingTenantOwn",
    "calcBillingPlatform",
    "calcConfirmDenied",
    "calcConfirmSubmit",
    "calcConfirmCancel",
    "calcDepthLabel",
  ] as const;
  const templatedKeys: Array<[string, string]> = [
    ["calcAdCountSkippedDead", "{n}"],
    ["calcConfirmBillable", "{n}"],
    ["calcConfirmFreshSkipped", "{n}"],
    ["calcConfirmDeadSkipped", "{n}"],
    ["calcConfirmBilling", "{path}"],
    ["calcConfirmDepth", "{n}"],
    ["calcConfirmExpectedQueries", "{n}"],
    ["calcConfirmWorstCaseQueries", "{n}"],
    ["calcConfirmEstCost", "{cost}"],
    ["calcConfirmEstCost", "{unit}"],
  ];

  it("zh/en 都有全部新键且为非空字符串", () => {
    for (const dict of [zh, en]) {
      for (const k of stringKeys) {
        expect(typeof dict.products[k]).toBe("string");
        expect(dict.products[k].length).toBeGreaterThan(0);
      }
      for (const [k] of templatedKeys) {
        expect(typeof dict.products[k as keyof typeof dict.products]).toBe(
          "string"
        );
      }
    }
  });

  it("模板键保留占位符（{n}/{path} 不丢）", () => {
    for (const dict of [zh, en]) {
      for (const [k, ph] of templatedKeys) {
        expect(dict.products[k as keyof typeof dict.products]).toContain(ph);
      }
    }
  });
});
