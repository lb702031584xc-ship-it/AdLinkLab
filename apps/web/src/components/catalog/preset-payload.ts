import type { ScreeningMode } from "@/lib/api/catalog-actions";

export interface ScreeningPresetPayloadInput {
  minReviews: number | null;
  minCommissionAmount: number | null;
  minCommissionRate: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  minScore: number | null;
  /** 筛查口径：未传 = 常规（与后端未保存时返回 "regular" 一致）。 */
  mode?: ScreeningMode;
  autoCreateOffer?: boolean;
  autoCreateTopN?: number;
  admin?: boolean;
}

/**
 * 筛选预设保存 payload（纯函数，供 catalog-client 的 buildPresetPayload 与测试共用）。
 * 口径规则：mode 未传时默认 "regular"，传 "loose" 时原样透传；常规模式下行为与老 payload
 * 完全一致（只是多了 mode: "regular" 一个后端已接受的字段）。
 * adminFields 为 false 时不带管理员字段——非管理员发管理员字段会 403（老行为不变）。
 */
export function buildScreeningPresetPayload(
  input: ScreeningPresetPayloadInput,
  adminFields: boolean
) {
  return {
    minReviews: input.minReviews,
    minCommissionAmount: input.minCommissionAmount,
    minCommissionRate: input.minCommissionRate,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    minScore: input.minScore,
    mode: input.mode ?? "regular",
    autoCreateOffer: adminFields ? input.autoCreateOffer : undefined,
    autoCreateTopN: adminFields ? input.autoCreateTopN : undefined,
    admin: adminFields,
  };
}
