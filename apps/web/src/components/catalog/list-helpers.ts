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
