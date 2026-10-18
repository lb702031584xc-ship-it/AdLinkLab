/**
 * 佣金门槛（MIN_COMMISSION_USD）的管理员覆盖读取。
 *
 * 覆盖项存在 ai_settings 表（key-value，无需 migration）：
 *   key   = "minCommissionUsd"
 *   value = 数字字符串（如 "8"）
 *
 * 读取失败 / 未配置 / 非法值 → 回退到 MIN_COMMISSION_USD（fail-soft，
 * 绝不因为配置问题挡住判定流程）。
 */
import type { PrismaClient } from "@adlinklab/database";
import { MIN_COMMISSION_USD } from "@adlinklab/shared";

export const MIN_COMMISSION_SETTING_KEY = "minCommissionUsd";

/** 管理员覆盖的佣金门槛（USD）；拿不到时返回默认值。 */
export async function getMinCommissionUsd(
  prisma: PrismaClient
): Promise<number> {
  try {
    const row = await prisma.aiSetting.findUnique({
      where: { key: MIN_COMMISSION_SETTING_KEY },
      select: { value: true },
    });
    const n = Number((row?.value ?? "").trim());
    if (Number.isFinite(n) && n > 0 && n < 1_000_000) return n;
  } catch {
    /* fail-soft → default */
  }
  return MIN_COMMISSION_USD;
}
