import { describe, expect, it } from "vitest";
import { selectableProducts } from "./list-helpers";
import type { CatalogProduct } from "@/lib/api/catalog-actions";

function product(id: string, flags?: { blacklisted?: boolean; whitelisted?: boolean }): CatalogProduct {
  return {
    id,
    networkId: "n1",
    networkKind: "partnerboost",
    externalId: null,
    name: id,
    brand: null,
    asin: null,
    price: null,
    commissionAmount: null,
    commissionRate: null,
    currency: null,
    reviewCount: null,
    recommended: false,
    recommendationScore: null,
    promoUrl: null,
    syncedAt: null,
    blacklisted: flags?.blacklisted,
    whitelisted: flags?.whitelisted,
  };
}

describe("selectableProducts", () => {
  it("keeps normal, recommended and whitelisted products selectable", () => {
    const rows = [
      product("a"),
      product("b", { whitelisted: true }),
      product("c", { blacklisted: false }),
    ];
    expect(selectableProducts(rows).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("drops blacklisted products", () => {
    const rows = [
      product("a", { blacklisted: true }),
      product("b"),
      product("c", { blacklisted: true }),
    ];
    expect(selectableProducts(rows).map((p) => p.id)).toEqual(["b"]);
  });

  it("returns an empty array when everything is blacklisted", () => {
    const rows = [product("a", { blacklisted: true })];
    expect(selectableProducts(rows)).toEqual([]);
  });
});
