/**
 * 长尾流水线标记与筛选口径单测：
 * - 已购用户风险：整 token / 固定短语命中，"apple" 不得误伤 "app"
 * - 型号特征：字母+数字相邻的启发式，纯数字（年份）不算
 * - outcome 分类：先量后竞争，未知不误杀；意图并入只动 pass、未知保持
 * - 型号词稳定前置、勾选跨批次保留
 * - 本批 dict 新键中英齐全、占位符完整
 */
import { describe, expect, it } from "vitest";
import { en, zh } from "../../i18n/dict/keyword-starter";
import {
  applyIntentOutcomes,
  classifyLocalOutcomes,
  countLocalSurvivors,
  countOutcome,
  hasModelToken,
  isOwnedUserRisk,
  keepSelectionWithin,
  modelFirstStable,
  type FilterOutcome,
} from "./keyword-marks";
import type { DfsCandidate } from "@/lib/api/keyword-dataforseo-actions";

const cand = (over: Partial<DfsCandidate> = {}): DfsCandidate => ({
  keyword: "robot vacuum",
  searchVolume: 1000,
  cpc: 1,
  competition: 0.2,
  competitionLevel: "LOW",
  ...over,
});

describe("isOwnedUserRisk", () => {
  it("命中单 token：app / login / support / manual / setup / connect / download", () => {
    for (const kw of [
      "roborock app",
      "roborock login",
      "roborock customer support",
      "roborock s8 manual",
      "roborock setup guide",
      "roborock wont connect to wifi",
      "roborock app download",
      "roborock troubleshooting",
      "roborock pairing",
    ]) {
      expect(isOwnedUserRisk(kw), kw).toBe(true);
    }
  });

  it("命中固定短语：sign in / customer service / how to / set up", () => {
    for (const kw of [
      "sign in roborock account",
      "roborock customer service phone",
      "how to clean roborock filter",
      "set up roborock s8",
    ]) {
      expect(isOwnedUserRisk(kw), kw).toBe(true);
    }
  });

  it("不误伤：apple / application 等含 app 子串的正常词", () => {
    for (const kw of [
      "apple robot vacuum",
      "best vacuum application",
      "pineapple scented mop pads",
      "robot vacuum",
      "roborock s8 pro ultra",
      "best robot vacuum for pet hair",
    ]) {
      expect(isOwnedUserRisk(kw), kw).toBe(false);
    }
  });
});

describe("hasModelToken", () => {
  it("字母+数字相邻 → 型号特征", () => {
    for (const kw of [
      "roborock s8",
      "roborock s8 pro ultra",
      "roborock q7 max",
      "dreame x40 ultra",
      "roomba j7",
      "shark av2501s",
    ]) {
      expect(hasModelToken(kw), kw).toBe(true);
    }
  });

  it("纯数字（年份）与纯字母词不算", () => {
    for (const kw of [
      "best robot vacuum 2024",
      "robot vacuum",
      "robot vacuum and mop",
      "self emptying robot vacuum",
    ]) {
      expect(hasModelToken(kw), kw).toBe(false);
    }
  });
});

describe("classifyLocalOutcomes", () => {
  it("先量后竞争：量不过 = out-volume（即使竞争也不过）", () => {
    const map = classifyLocalOutcomes(
      [
        cand({ keyword: "a", searchVolume: 10, competitionLevel: "HIGH" }),
        cand({ keyword: "b", searchVolume: 500, competitionLevel: "HIGH" }),
        cand({ keyword: "c", searchVolume: 500, competitionLevel: "MEDIUM" }),
      ],
      { minVolume: 100, competitionMode: "lowPlusMedium" }
    );
    expect(map.get("a")).toBe("out-volume");
    expect(map.get("b")).toBe("out-competition");
    expect(map.get("c")).toBe("pass");
  });

  it("未知不误杀：量/竞争为 null 照样 pass", () => {
    const map = classifyLocalOutcomes(
      [cand({ keyword: "x", searchVolume: null, competition: null, competitionLevel: null })],
      { minVolume: 100, competitionMode: "lowOnly" }
    );
    expect(map.get("x")).toBe("pass");
  });

  it("competition 数值分档与原文等级都认", () => {
    const map = classifyLocalOutcomes(
      [
        cand({ keyword: "n1", competition: 0.9, competitionLevel: null }),
        cand({ keyword: "n2", competition: 0.9, competitionLevel: "LOW" }),
      ],
      { minVolume: 0, competitionMode: "lowOnly" }
    );
    expect(map.get("n1")).toBe("out-competition");
    expect(map.get("n2")).toBe("pass"); // 原文等级优先
  });
});

describe("applyIntentOutcomes", () => {
  const base = (): Map<string, FilterOutcome> =>
    new Map<string, FilterOutcome>([
      ["keep-buy", "pass"],
      ["info-word", "pass"],
      ["unknown-word", "pass"],
      ["already-out", "out-volume"],
    ]);

  it("明确非购买向 → out-intent；commercial/transactional 保持 pass", () => {
    const { outcomes, hasUnverified } = applyIntentOutcomes(
      base(),
      new Map([
        ["keep-buy", "transactional"],
        ["info-word", "informational"],
        ["unknown-word", null],
        ["already-out", "informational"],
      ])
    );
    expect(outcomes.get("keep-buy")).toBe("pass");
    expect(outcomes.get("info-word")).toBe("out-intent");
    expect(hasUnverified).toBe(true);
  });

  it("意图未知保持 pass 且标未验证；已出局的行不被意图改动、不入参污染", () => {
    const input = base();
    const { outcomes } = applyIntentOutcomes(
      input,
      new Map([
        ["keep-buy", "commercial"],
        ["info-word", "commercial"],
        ["unknown-word", null],
        ["already-out", "transactional"],
      ])
    );
    expect(outcomes.get("unknown-word")).toBe("pass");
    expect(outcomes.get("already-out")).toBe("out-volume");
    expect(input.get("already-out")).toBe("out-volume");
    expect(outcomes).not.toBe(input);
  });

  it("计数口径：本地幸存 = pass + out-intent", () => {
    const { outcomes } = applyIntentOutcomes(
      base(),
      new Map([
        ["keep-buy", "commercial"],
        ["info-word", "navigational"],
        ["unknown-word", "transactional"],
      ])
    );
    expect(countLocalSurvivors(outcomes)).toBe(3);
    expect(countOutcome(outcomes, "pass")).toBe(2);
    expect(countOutcome(outcomes, "out-intent")).toBe(1);
  });
});

describe("modelFirstStable / keepSelectionWithin", () => {
  it("型号词前置且组内保序，无型号词相对顺序不变", () => {
    const rows = [
      { keyword: "robot vacuum" },
      { keyword: "roborock s8" },
      { keyword: "robot mop" },
      { keyword: "dreame x40" },
    ];
    expect(modelFirstStable(rows).map((r) => r.keyword)).toEqual([
      "roborock s8",
      "dreame x40",
      "robot vacuum",
      "robot mop",
    ]);
  });

  it("勾选保留只留下仍在候选内的词（大小写不敏感）", () => {
    const prev = new Set(["roborock s8", "gone word", "robot vacuum"]);
    const next = keepSelectionWithin(prev, ["Roborock S8", "Robot Vacuum"]);
    expect([...next].sort()).toEqual(["roborock s8", "robot vacuum"]);
  });
});

describe("dict 新键（dfs）", () => {
  it("中英齐全且非空", () => {
    for (const d of [zh.dfs, en.dfs]) {
      expect(d.expandCacheNote.length).toBeGreaterThan(10);
      expect(d.showFiltered).toContain("{k}");
      expect(d.hideFiltered.length).toBeGreaterThan(0);
      expect(d.keptBadge.length).toBeGreaterThan(0);
      expect(d.ownedRiskBadge.length).toBeGreaterThan(0);
      expect(d.modelBadge.length).toBeGreaterThan(0);
      expect(d.marksNote.length).toBeGreaterThan(10);
      expect(d.outcomeReasons["out-volume"].length).toBeGreaterThan(0);
      expect(d.outcomeReasons["out-competition"].length).toBeGreaterThan(0);
      expect(d.outcomeReasons["out-intent"].length).toBeGreaterThan(0);
    }
  });

  it("filterLine 占位符 {x}/{y}/{k} 中英完整", () => {
    for (const line of [zh.dfs.filterLine, en.dfs.filterLine]) {
      expect(line).toContain("{x}");
      expect(line).toContain("{y}");
      expect(line).toContain("{k}");
    }
  });

  it("缓存说明写明 14 天（中英）", () => {
    expect(zh.dfs.expandCacheNote).toContain("14");
    expect(en.dfs.expandCacheNote).toContain("14");
  });
});
