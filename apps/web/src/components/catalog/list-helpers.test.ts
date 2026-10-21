import { describe, expect, it } from "vitest";
import {
  isValidSortValue,
  priorityRankFor,
  resolveStoredSort,
  selectableProducts,
} from "./list-helpers";
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
    landingPageType: null,
    countryCode: null,
    status: "active",
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

describe("sort persistence helpers", () => {
  it("accepts well-formed sort values", () => {
    expect(isValidSortValue("brand_asc")).toBe(true);
    expect(isValidSortValue("id_desc")).toBe(true);
    expect(isValidSortValue("score_desc")).toBe(true);
    expect(resolveStoredSort("brand_asc")).toBe("brand_asc");
  });

  it("rejects malformed or missing values back to null (default applies)", () => {
    expect(isValidSortValue("brand")).toBe(false);
    expect(isValidSortValue("brand_up")).toBe(false);
    expect(isValidSortValue("BRAND_ASC")).toBe(false);
    expect(isValidSortValue("")).toBe(false);
    expect(isValidSortValue(null)).toBe(false);
    expect(isValidSortValue(42)).toBe(false);
    expect(resolveStoredSort(null)).toBeNull();
    expect(resolveStoredSort(undefined)).toBeNull();
    expect(resolveStoredSort("x; DROP TABLE")).toBeNull();
  });

  it("accepts priority sort values (persisted like any other column sort)", () => {
    expect(isValidSortValue("priority_desc")).toBe(true);
    expect(isValidSortValue("priority_asc")).toBe(true);
    expect(resolveStoredSort("priority_desc")).toBe("priority_desc");
  });
});

describe("priorityRankFor（先测名次）", () => {
  it("priority_desc 时全局序号即名次", () => {
    expect(priorityRankFor("priority_desc", 1)).toBe(1);
    expect(priorityRankFor("priority_desc", 5)).toBe(5);
    expect(priorityRankFor("priority_desc", 25)).toBe(25);
  });

  it("其他排序（含 priority_asc）不给名次", () => {
    expect(priorityRankFor("priority_asc", 1)).toBeNull();
    expect(priorityRankFor("id_desc", 1)).toBeNull();
    expect(priorityRankFor("score_desc", 3)).toBeNull();
  });
});
