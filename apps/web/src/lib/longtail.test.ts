import { describe, expect, it } from "vitest";
import { mergeLongtailCandidates } from "./longtail";

describe("mergeLongtailCandidates", () => {
  it("单单词种子：包含种子词且更长的才入选，种子本身排除", () => {
    const out = mergeLongtailCandidates({
      seed: "roborock",
      snapshotRows: [
        { keyword: "roborock s8 maxv ultra", volume: "5400" },
        { keyword: "roborock", volume: "100000" },
      ],
      serverCandidates: [
        { keyword: "roborock vacuum", volume: null, source: "autocomplete" },
        { keyword: "irobot roomba", volume: 9000, source: "autocomplete" },
      ],
      planKeywords: [],
    });
    const kws = out.map((c) => c.keyword);
    expect(kws).toContain("roborock s8 maxv ultra");
    expect(kws).toContain("roborock vacuum");
    expect(kws).not.toContain("roborock");
    expect(kws).not.toContain("irobot roomba");
  });

  it("多单词种子：必须包含全部单词且词数更多", () => {
    const out = mergeLongtailCandidates({
      seed: "robot vacuum",
      snapshotRows: [],
      serverCandidates: [
        { keyword: "best robot vacuum", volume: null, source: "autocomplete" },
        { keyword: "robot vacuum cleaner", volume: 1200, source: "dataforseo" },
        { keyword: "robot mop", volume: 5000, source: "dataforseo" },
        { keyword: "robot vacuum", volume: 8000, source: "dataforseo" },
      ],
      planKeywords: [],
    });
    const kws = out.map((c) => c.keyword);
    expect(kws).toEqual(["robot vacuum cleaner", "best robot vacuum"]);
  });

  it("去重：同词保留带搜索量的；排除已在计划里的词；按搜索量降序，无量排最后", () => {
    const out = mergeLongtailCandidates({
      seed: "roborock",
      snapshotRows: [{ keyword: "roborock s8 maxv ultra", volume: "5400" }],
      serverCandidates: [
        { keyword: "roborock s8 maxv ultra", volume: 5400, source: "dataforseo" },
        { keyword: "roborock saros 10r", volume: 2900, source: "dataforseo" },
        { keyword: "roborock vacuum", volume: null, source: "autocomplete" },
        { keyword: "roborock q7", volume: 800, source: "dataforseo" },
      ],
      planKeywords: ["roborock q7"],
    });
    expect(out.map((c) => c.keyword)).toEqual([
      "roborock s8 maxv ultra",
      "roborock saros 10r",
      "roborock vacuum",
    ]);
    expect(out[0].source).toBe("snapshot");
    expect(out[0].volume).toBe(5400);
    expect(out[2].volume).toBeNull();
  });

  it("#17 minVolume：默认 10，低于的被过滤；volume 为 null 不被杀", () => {
    const out = mergeLongtailCandidates({
      seed: "roborock",
      snapshotRows: [
        { keyword: "roborock s8 maxv ultra", volume: "5400" },
        { keyword: "roborock q7 max", volume: "5" },
      ],
      serverCandidates: [
        { keyword: "roborock vacuum mop", volume: null, source: "autocomplete" },
        { keyword: "roborock dock plus", volume: 10, source: "dataforseo" },
      ],
      planKeywords: [],
    });
    const kws = out.map((c) => c.keyword);
    expect(kws).toContain("roborock s8 maxv ultra");
    expect(kws).toContain("roborock dock plus"); // 恰好 10 不过滤（低于才过滤）
    expect(kws).toContain("roborock vacuum mop"); // 无搜索量不杀
    expect(kws).not.toContain("roborock q7 max");
  });

  it("#17 minVolume 可调：传 0 时低量候选保留", () => {
    const out = mergeLongtailCandidates({
      seed: "roborock",
      snapshotRows: [{ keyword: "roborock q7 max", volume: "5" }],
      serverCandidates: [],
      planKeywords: [],
      filters: { minVolume: 0 },
    });
    expect(out.map((c) => c.keyword)).toEqual(["roborock q7 max"]);
  });

  it("#17 CPC 比例：候选 CPC > 品牌 CPC × 0.6 被过滤；缺数据不杀", () => {
    const out = mergeLongtailCandidates({
      seed: "roborock",
      snapshotRows: [],
      serverCandidates: [
        { keyword: "roborock s8 ultra", volume: 1000, source: "dataforseo", cpc: 0.5 },
        { keyword: "roborock s8 pro", volume: 900, source: "dataforseo", cpc: 0.7 },
        { keyword: "roborock s8 lite", volume: 800, source: "dataforseo" },
      ],
      planKeywords: [],
      filters: { brandCpc: 1.0 },
    });
    const kws = out.map((c) => c.keyword);
    expect(kws).toContain("roborock s8 ultra"); // 0.5 ≤ 1.0×0.6
    expect(kws).not.toContain("roborock s8 pro"); // 0.7 > 0.6
    expect(kws).toContain("roborock s8 lite"); // 无 CPC 数据不杀
  });

  it("#17 CPC 比例：未给 brandCpc 时整条过滤跳过", () => {
    const out = mergeLongtailCandidates({
      seed: "roborock",
      snapshotRows: [],
      serverCandidates: [
        { keyword: "roborock s8 pro", volume: 900, source: "dataforseo", cpc: 99 },
      ],
      planKeywords: [],
      filters: {},
    });
    expect(out.map((c) => c.keyword)).toEqual(["roborock s8 pro"]);
  });

  it("#17 竞争度过滤：开启时仅 Low/Medium；无竞争度数据保留；默认关闭不过滤", () => {
    const base = {
      seed: "roborock",
      snapshotRows: [],
      serverCandidates: [
        { keyword: "roborock s8 ultra", volume: 1000, source: "dataforseo" as const, competition: "Low" },
        { keyword: "roborock s8 pro", volume: 900, source: "dataforseo" as const, competition: "High" },
        { keyword: "roborock s8 mid", volume: 850, source: "dataforseo" as const, competition: "medium" },
        { keyword: "roborock s8 lite", volume: 800, source: "dataforseo" as const },
      ],
      planKeywords: [],
    };
    const on = mergeLongtailCandidates({ ...base, filters: { competitionFilter: true } });
    expect(on.map((c) => c.keyword)).toEqual([
      "roborock s8 ultra",
      "roborock s8 mid",
      "roborock s8 lite",
    ]);
    const off = mergeLongtailCandidates(base);
    expect(off.map((c) => c.keyword)).toContain("roborock s8 pro");
  });
});
