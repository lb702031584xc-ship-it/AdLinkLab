import type { CatalogProduct } from "@/lib/api/catalog-actions";

/**
 * Products that can be ticked for batch offer creation.
 * Blacklisted products are auto-skipped by the backend — the UI must not
 * let the user select them either.
 */
export function selectableProducts(
  products: CatalogProduct[]
): CatalogProduct[] {
  return products.filter((p) => !p.blacklisted);
}

/**
 * 排序值形状：`<列基名>_asc|desc`（如 brand_asc / id_desc）。
 * localStorage 里的排序是用户可篡改的外部输入，必须校验后才采纳，
 * 非法值一律回默认 id_desc，避免脏值把列表查询打挂。
 */
const SORT_VALUE_RE = /^[a-z]+_(asc|desc)$/;

export function isValidSortValue(v: unknown): v is string {
  return typeof v === "string" && SORT_VALUE_RE.test(v);
}

/** 存储中的排序值 → 合法则原样返回，不合法/缺失 → null（调用方回默认）。 */
export function resolveStoredSort(raw: string | null | undefined): string | null {
  return isValidSortValue(raw) ? raw : null;
}

/**
 * 测试优先分列的「先测」名次：仅在测试优先分降序（priority_desc）时，
 * 行的全局序号（(page-1)*pageSize + 行序）就是全局名次，可点亮名次 ≤5
 * 的「先测」徽标；其他排序（含 priority_asc 升序）下名次无"先测"语义 → null。
 */
export function priorityRankFor(sort: string, seq: number): number | null {
  return sort === "priority_desc" ? seq : null;
}
