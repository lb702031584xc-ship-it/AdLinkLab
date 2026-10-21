/**
 * 广告数付费计算「预估 → 确认」的纯函数口径 + 本批 dict 新键（中英齐全、
 * 占位符完整）。计费组数公式与后端 preview/calc 同一套定义，锁死防漂移。
 */
import { describe, expect, it } from "vitest";
import { en, zh } from "../../i18n/dict/catalog";
import {
  calcAdCountConfirmFacts,
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
  ] as const;
  const templatedKeys: Array<[string, string]> = [
    ["calcAdCountSkippedDead", "{n}"],
    ["calcConfirmBillable", "{n}"],
    ["calcConfirmFreshSkipped", "{n}"],
    ["calcConfirmDeadSkipped", "{n}"],
    ["calcConfirmBilling", "{path}"],
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
