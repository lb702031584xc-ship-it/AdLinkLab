/**
 * DataForSEO 关键词流水线响应解析单测。
 *
 * fixture 按 DataForSEO 官方文档的真实响应形状构造（模拟数据，非真实抓取）：
 * - Labs 系列：tasks[0].result[0].items[]，字段在 item.keyword_data.keyword_info。
 * - Keywords Data google_ads：tasks[0].result 直接是条目数组，且**没有 cpc
 *   字段**（AdWords→Ads 迁移后已删除）——解析结果也不许凭空长出 cpc。
 * - 缺失字段必须解析为 null（未知），不许用 0 冒充。
 */
import { describe, expect, it } from "vitest";
import {
  DataForSeoKeywordsError,
  parseAdsSearchVolumeResponse,
  parseKeywordOverviewCpc,
  parseRelatedKeywordsResponse,
  parseSearchIntentResponse,
} from "./dataforseo-keywords.js";

/** 模拟 fixture：Labs related_keywords/live 响应形状。 */
const RELATED_FIXTURE = {
  status_code: 20000,
  tasks: [
    {
      status_code: 20000,
      status_message: "Ok.",
      result: [
        {
          seed_keyword: "robot vacuum",
          items_count: 5,
          items: [
            {
              keyword_data: {
                keyword: "robot vacuum",
                keyword_info: {
                  search_volume: 550000,
                  cpc: 1.84,
                  competition: 0.92,
                  competition_level: "HIGH",
                },
              },
            },
            {
              keyword_data: {
                keyword: "best robot vacuum for pet hair",
                keyword_info: {
                  search_volume: 33100,
                  cpc: 1.12,
                  competition: 0.64,
                  competition_level: "MEDIUM",
                },
              },
            },
            {
              // 与上一条大小写重复 → 去重
              keyword_data: {
                keyword: "Best Robot Vacuum For Pet Hair",
                keyword_info: { search_volume: 33100, cpc: 9.99 },
              },
            },
            {
              // 无 cpc / 无 competition → null，不冒充 0
              keyword_data: {
                keyword: "robot vacuum with self empty base",
                keyword_info: { search_volume: 8100 },
              },
            },
            {
              // 无 search_volume → null
              keyword_data: {
                keyword: "quiet robot vacuum for apartments",
                keyword_info: { cpc: 0.87, competition: 0.21, competition_level: "LOW" },
              },
            },
          ],
        },
      ],
    },
  ],
};

describe("parseRelatedKeywordsResponse", () => {
  it("解析候选：剔除种子词本身、大小写去重、缺字段为 null", () => {
    const out = parseRelatedKeywordsResponse(RELATED_FIXTURE, "robot vacuum", 100);
    expect(out.map((c) => c.keyword)).toEqual([
      "best robot vacuum for pet hair",
      "robot vacuum with self empty base",
      "quiet robot vacuum for apartments",
    ]);
    expect(out[0]).toEqual({
      keyword: "best robot vacuum for pet hair",
      searchVolume: 33100,
      cpc: 1.12,
      competition: 0.64,
      competitionLevel: "MEDIUM",
    });
    expect(out[1].cpc).toBeNull();
    expect(out[1].competition).toBeNull();
    expect(out[2].searchVolume).toBeNull();
    expect(out[2].competitionLevel).toBe("LOW");
  });

  it("limit 截断候选数（计费阀门在解析层也守住）", () => {
    const out = parseRelatedKeywordsResponse(RELATED_FIXTURE, "robot vacuum", 2);
    expect(out).toHaveLength(2);
  });

  it("任务级 status_code ≥ 40000 → 抛 DataForSeoKeywordsError 并带 status_message", () => {
    const bad = {
      tasks: [
        { status_code: 40501, status_message: "Invalid Field: limit.", result: null },
      ],
    };
    expect(() => parseRelatedKeywordsResponse(bad, "robot vacuum", 100)).toThrow(
      DataForSeoKeywordsError
    );
    try {
      parseRelatedKeywordsResponse(bad, "robot vacuum", 100);
    } catch (e) {
      expect((e as DataForSeoKeywordsError).code).toBe(
        "DATAFORSEO_REQUEST_FAILED"
      );
      expect((e as Error).message).toContain("Invalid Field");
    }
  });

  it("空响应 → 空数组，不抛错", () => {
    expect(parseRelatedKeywordsResponse({}, "robot vacuum", 100)).toEqual([]);
    expect(parseRelatedKeywordsResponse(null, "robot vacuum", 100)).toEqual([]);
  });
});

/** 模拟 fixture：Labs search_intent/live 响应形状。 */
const INTENT_FIXTURE = {
  tasks: [
    {
      status_code: 20000,
      result: [
        {
          items: [
            {
              keyword: "best robot vacuum for pet hair",
              keyword_intent: { label: "commercial", probability: 0.91 },
            },
            {
              keyword: "how do robot vacuums work",
              keyword_intent: { label: "informational", probability: 0.87 },
            },
            {
              // 兜底形状：search_intent_info.main_intent
              keyword: "buy roborock s8",
              search_intent_info: { main_intent: "transactional", foreign_intent: [] },
            },
            {
              // 无意图字段 → null（未验证）
              keyword: "robot vacuum",
            },
          ],
        },
      ],
    },
  ],
};

describe("parseSearchIntentResponse", () => {
  it("解析意图标签与概率，缺失为 null", () => {
    const out = parseSearchIntentResponse(INTENT_FIXTURE);
    expect(out).toEqual([
      { keyword: "best robot vacuum for pet hair", intent: "commercial", probability: 0.91 },
      { keyword: "how do robot vacuums work", intent: "informational", probability: 0.87 },
      { keyword: "buy roborock s8", intent: "transactional", probability: null },
      { keyword: "robot vacuum", intent: null, probability: null },
    ]);
  });
});

/** 模拟 fixture：Labs keyword_overview/live 响应形状。 */
const OVERVIEW_FIXTURE = {
  tasks: [
    {
      status_code: 20000,
      result: [
        {
          items: [
            {
              keyword_data: {
                keyword: "best robot vacuum for pet hair",
                keyword_info: { search_volume: 33100, cpc: 1.12, competition: 0.64 },
              },
            },
            {
              // 无 cpc → 不进映射（调用方显示未知）
              keyword_data: {
                keyword: "robot vacuum with self empty base",
                keyword_info: { search_volume: 8100 },
              },
            },
          ],
        },
      ],
    },
  ],
};

describe("parseKeywordOverviewCpc", () => {
  it("只收有 cpc 的词，key 归一化小写", () => {
    const map = parseKeywordOverviewCpc(OVERVIEW_FIXTURE);
    expect(map.size).toBe(1);
    expect(map.get("best robot vacuum for pet hair")).toBe(1.12);
    expect(map.has("robot vacuum with self empty base")).toBe(false);
  });
});

/** 模拟 fixture：Keywords Data google_ads/search_volume/live 响应形状（result 直挂条目数组，无 cpc）。 */
const ADS_VOLUME_FIXTURE = {
  tasks: [
    {
      status_code: 20000,
      result: [
        {
          keyword: "best robot vacuum for pet hair",
          search_volume: 33100,
          competition: "MEDIUM",
          competition_index: 64,
          low_top_of_page_bid: 0.92,
          high_top_of_page_bid: 2.31,
          monthly_searches: [
            { year: 2026, month: 9, search_volume: 33100 },
          ],
        },
        {
          keyword: "quiet robot vacuum for apartments",
          search_volume: 1900,
          competition: "LOW",
          competition_index: 18,
          // 无页首出价（该词没人投过）→ null
        },
      ],
    },
  ],
};

describe("parseAdsSearchVolumeResponse", () => {
  it("解析搜索量/竞争指数/页首出价区间；无出价为 null；结果不含 cpc", () => {
    const out = parseAdsSearchVolumeResponse(ADS_VOLUME_FIXTURE);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      keyword: "best robot vacuum for pet hair",
      searchVolume: 33100,
      competition: "MEDIUM",
      competitionIndex: 64,
      lowTopBid: 0.92,
      highTopBid: 2.31,
    });
    expect(out[1].lowTopBid).toBeNull();
    expect(out[1].highTopBid).toBeNull();
    // Keywords Data 已无 cpc 字段——解析类型里根本没有 cpc，不许凭空生成。
    expect(
      Object.prototype.hasOwnProperty.call(out[0], "cpc")
    ).toBe(false);
  });
});
