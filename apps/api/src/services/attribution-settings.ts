/**
 * P1-11：归因设置读取（默认兜底；无记录时返回默认值，不建行）。
 *
 * - attributionWindowDays：点击 → 订单的归因窗口（默认 30 天；超出则不归因）。
 * - gclidDedupeMinutes：同一 gclid 在该分钟内重复出现视为重复点击（默认 30 分钟，与 K9 一致）。
 * - duplicateClicksCountAsConversion：重复点击是否计为转化（默认 false = 不计）。
 */
import type { PrismaClient } from "@adlinklab/database";

export interface AttributionSettings {
  attributionWindowDays: number;
  gclidDedupeMinutes: number;
  duplicateClicksCountAsConversion: boolean;
}

export const DEFAULT_ATTRIBUTION_SETTINGS: AttributionSettings = {
  attributionWindowDays: 30,
  gclidDedupeMinutes: 30,
  duplicateClicksCountAsConversion: false,
};

export async function getAttributionSettings(
  prisma: PrismaClient,
  tenantId: string
): Promise<AttributionSettings> {
  const row = await prisma.attributionSettings.findUnique({
    where: { tenantId },
    select: {
      attributionWindowDays: true,
      gclidDedupeMinutes: true,
      duplicateClicksCountAsConversion: true,
    },
  });
  if (!row) return { ...DEFAULT_ATTRIBUTION_SETTINGS };
  return {
    attributionWindowDays: row.attributionWindowDays,
    gclidDedupeMinutes: row.gclidDedupeMinutes,
    duplicateClicksCountAsConversion: row.duplicateClicksCountAsConversion,
  };
}
