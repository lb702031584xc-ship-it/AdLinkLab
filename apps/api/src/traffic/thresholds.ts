/**
 * 流量门阈值管理。
 *
 * - 存储：AiSetting 全局键 `traffic.thresholds`，明文 JSON（非 secret，无需加密），
 *   与 amazon.paapiEnc 一致不做 tenant 隔离。
 * - getTrafficThresholds：存储值与 DEFAULT_TRAFFIC_THRESHOLDS 合并，
 *   非法数字回退到默认值；永不抛错。
 * - saveTrafficThresholds：全量写入；先校验三项阈值合法（访问量阈值 >0，
 *   热度阈值 (0,100]），非法抛错。
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  DEFAULT_TRAFFIC_THRESHOLDS,
  type TrafficThresholds,
} from "./types.js";

export const TRAFFIC_THRESHOLDS_KEY = "traffic.thresholds";

function isPositiveNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** 热度阈值合法性：(0, 100]（Trends 口径为 0-100 相对值）。 */
function isHeatThreshold(v: unknown): v is number {
  return isPositiveNumber(v) && (v as number) <= 100;
}

/** 比例阈值合法性：(0, 1)。 */
function isRatioThreshold(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1;
}

/** 存储值与默认值合并：非法/缺失字段回退到默认值。 */
function sanitize(raw: unknown): TrafficThresholds {
  const o = (raw ?? {}) as Partial<Record<keyof TrafficThresholds, unknown>>;
  return {
    officialSiteMonthlyVisits: isPositiveNumber(o.officialSiteMonthlyVisits)
      ? o.officialSiteMonthlyVisits
      : DEFAULT_TRAFFIC_THRESHOLDS.officialSiteMonthlyVisits,
    brandInterest: isHeatThreshold(o.brandInterest)
      ? o.brandInterest
      : DEFAULT_TRAFFIC_THRESHOLDS.brandInterest,
    keywordInterest: isHeatThreshold(o.keywordInterest)
      ? o.keywordInterest
      : DEFAULT_TRAFFIC_THRESHOLDS.keywordInterest,
    organicTrafficMin: isPositiveNumber(o.organicTrafficMin)
      ? o.organicTrafficMin
      : DEFAULT_TRAFFIC_THRESHOLDS.organicTrafficMin,
    paidTrafficWarnRatio: isRatioThreshold(o.paidTrafficWarnRatio)
      ? o.paidTrafficWarnRatio
      : DEFAULT_TRAFFIC_THRESHOLDS.paidTrafficWarnRatio,
  };
}

/** 读取阈值：存储值与默认值合并；读不到/非法时返回默认值。永不抛错。 */
export async function getTrafficThresholds(
  prisma: PrismaClient
): Promise<TrafficThresholds> {
  try {
    const row = await prisma.aiSetting.findUnique({
      where: { key: TRAFFIC_THRESHOLDS_KEY },
      select: { value: true },
    });
    if (row?.value) {
      try {
        return sanitize(JSON.parse(row.value));
      } catch {
        // JSON 非法 → 默认值
      }
    }
  } catch {
    // DB 不可用 → 默认值
  }
  return { ...DEFAULT_TRAFFIC_THRESHOLDS };
}

/** 保存阈值（全量覆盖）。阈值非法时抛错，不写入。 */
export async function saveTrafficThresholds(
  prisma: PrismaClient,
  t: TrafficThresholds
): Promise<TrafficThresholds> {
  if (!isPositiveNumber(t?.officialSiteMonthlyVisits)) {
    throw new Error("officialSiteMonthlyVisits 必须为正数");
  }
  if (!isHeatThreshold(t?.brandInterest)) {
    throw new Error("brandInterest 必须在 (0, 100] 之间");
  }
  if (!isHeatThreshold(t?.keywordInterest)) {
    throw new Error("keywordInterest 必须在 (0, 100] 之间");
  }
  if (!isPositiveNumber(t?.organicTrafficMin)) {
    throw new Error("organicTrafficMin 必须为正数");
  }
  if (!isRatioThreshold(t?.paidTrafficWarnRatio)) {
    throw new Error("paidTrafficWarnRatio 必须在 (0, 1) 之间");
  }
  const clean: TrafficThresholds = {
    officialSiteMonthlyVisits: t.officialSiteMonthlyVisits,
    brandInterest: t.brandInterest,
    keywordInterest: t.keywordInterest,
    organicTrafficMin: t.organicTrafficMin,
    paidTrafficWarnRatio: t.paidTrafficWarnRatio,
  };
  const value = JSON.stringify(clean);
  await prisma.aiSetting.upsert({
    where: { key: TRAFFIC_THRESHOLDS_KEY },
    update: { value },
    create: { key: TRAFFIC_THRESHOLDS_KEY, value },
  });
  return clean;
}
