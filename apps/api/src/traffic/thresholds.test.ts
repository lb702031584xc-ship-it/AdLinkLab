/**
 * 流量门阈值读写单测：默认合并、非法值回退、保存校验。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import {
  getTrafficThresholds,
  saveTrafficThresholds,
} from "./thresholds.js";
import { DEFAULT_TRAFFIC_THRESHOLDS, type TrafficThresholds } from "./types.js";

function makeFakePrisma(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const aiSetting = {
    findUnique: vi.fn(
      async ({ where }: { where: { key: string } }) => {
        const value = store.get(where.key);
        return value === undefined ? null : { key: where.key, value };
      }
    ),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { key: string };
        create: { key: string; value: string };
        update: { value: string };
      }) => {
        const value = update.value ?? create.value;
        store.set(where.key, value);
        return { key: where.key, value };
      }
    ),
  };
  return {
    store,
    prisma: { aiSetting } as unknown as PrismaClient,
    aiSetting,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTrafficThresholds", () => {
  it("无记录时返回默认值", async () => {
    const { prisma } = makeFakePrisma();
    await expect(getTrafficThresholds(prisma)).resolves.toEqual(
      DEFAULT_TRAFFIC_THRESHOLDS
    );
  });

  it("存储的部分值与默认值合并", async () => {
    const { prisma } = makeFakePrisma({
      "traffic.thresholds": JSON.stringify({ brandInterest: 40 }),
    });
    await expect(getTrafficThresholds(prisma)).resolves.toEqual({
      officialSiteMonthlyVisits: 50000,
      brandInterest: 40,
      keywordInterest: 25,
      organicTrafficMin: 1000,
      paidTrafficWarnRatio: 0.05,
    });
  });

  it("非法数字回退到默认值", async () => {
    const { prisma } = makeFakePrisma({
      "traffic.thresholds": JSON.stringify({
        officialSiteMonthlyVisits: -5,
        brandInterest: 0,
        keywordInterest: 150,
      }),
    });
    await expect(getTrafficThresholds(prisma)).resolves.toEqual(
      DEFAULT_TRAFFIC_THRESHOLDS
    );
  });

  it("JSON 非法 / DB 异常 → 默认值，不抛错", async () => {
    const bad = makeFakePrisma({ "traffic.thresholds": "{not-json" });
    await expect(getTrafficThresholds(bad.prisma)).resolves.toEqual(
      DEFAULT_TRAFFIC_THRESHOLDS
    );
    const throwing = {
      aiSetting: {
        findUnique: vi.fn().mockRejectedValue(new Error("db down")),
        upsert: vi.fn(),
      },
    } as unknown as PrismaClient;
    await expect(getTrafficThresholds(throwing)).resolves.toEqual(
      DEFAULT_TRAFFIC_THRESHOLDS
    );
  });
});

describe("saveTrafficThresholds", () => {
  it("合法阈值写入并返回", async () => {
    const { prisma, store, aiSetting } = makeFakePrisma();
    const saved = await saveTrafficThresholds(prisma, {
      officialSiteMonthlyVisits: 100000,
      brandInterest: 30,
      keywordInterest: 20,
      organicTrafficMin: 2000,
      paidTrafficWarnRatio: 0.1,
    });
    expect(saved).toEqual({
      officialSiteMonthlyVisits: 100000,
      brandInterest: 30,
      keywordInterest: 20,
      organicTrafficMin: 2000,
      paidTrafficWarnRatio: 0.1,
    });
    expect(aiSetting.upsert).toHaveBeenCalled();
    expect(JSON.parse(store.get("traffic.thresholds") ?? "")).toEqual(saved);
  });

  it("非法阈值抛错且不写入", async () => {
    const { prisma, store, aiSetting } = makeFakePrisma();
    const badCases: TrafficThresholds[] = [
      { officialSiteMonthlyVisits: 0, brandInterest: 25, keywordInterest: 25, organicTrafficMin: 1000, paidTrafficWarnRatio: 0.05 },
      { officialSiteMonthlyVisits: -1, brandInterest: 25, keywordInterest: 25, organicTrafficMin: 1000, paidTrafficWarnRatio: 0.05 },
      { officialSiteMonthlyVisits: 50000, brandInterest: 0, keywordInterest: 25, organicTrafficMin: 1000, paidTrafficWarnRatio: 0.05 },
      { officialSiteMonthlyVisits: 50000, brandInterest: 101, keywordInterest: 25, organicTrafficMin: 1000, paidTrafficWarnRatio: 0.05 },
      { officialSiteMonthlyVisits: 50000, brandInterest: 25, keywordInterest: NaN, organicTrafficMin: 1000, paidTrafficWarnRatio: 0.05 },
      { officialSiteMonthlyVisits: 50000, brandInterest: 25, keywordInterest: 25, organicTrafficMin: 0, paidTrafficWarnRatio: 0.05 },
      { officialSiteMonthlyVisits: 50000, brandInterest: 25, keywordInterest: 25, organicTrafficMin: -100, paidTrafficWarnRatio: 0.05 },
      { officialSiteMonthlyVisits: 50000, brandInterest: 25, keywordInterest: 25, organicTrafficMin: 1000, paidTrafficWarnRatio: 0 },
      { officialSiteMonthlyVisits: 50000, brandInterest: 25, keywordInterest: 25, organicTrafficMin: 1000, paidTrafficWarnRatio: 1 },
      { officialSiteMonthlyVisits: 50000, brandInterest: 25, keywordInterest: 25, organicTrafficMin: 1000, paidTrafficWarnRatio: 1.5 },
    ];
    for (const t of badCases) {
      await expect(saveTrafficThresholds(prisma, t)).rejects.toThrow();
    }
    expect(aiSetting.upsert).not.toHaveBeenCalled();
    expect(store.has("traffic.thresholds")).toBe(false);
  });
});
