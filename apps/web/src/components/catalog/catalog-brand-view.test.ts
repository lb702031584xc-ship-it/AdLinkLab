/**
 * Brand view: AdTrendMark renders the shared trend rules (new/stopped/active/
 * first visible; none/null hidden; hover title carries last count + date),
 * adBandBadge maps the brands-API band keys (redocean without underscore) to
 * the existing tier labels/colors, and CatalogBrandView starts in its
 * loading state. Action modules are stubbed so the test never loads the
 * server-only import chain.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/catalog-actions", () => ({
  listCatalogBrandsAction: async () => ({
    ok: true as const,
    data: { brands: [], total: 0 },
  }),
  saveBrandLandingUrlAction: async () => ({
    ok: true as const,
    data: { ok: true, landingUrl: null },
  }),
  batchCreateOffersAction: async () => ({
    ok: false as const,
    error: "stub",
  }),
}));

vi.mock("@/lib/api/entity-actions", () => ({
  updateOfferAction: async () => ({ ok: true as const, data: null }),
}));

import { en, zh } from "@/i18n/dict/catalog";
import type { CatalogBrand } from "@/lib/api/catalog-actions";
import {
  AdTrendMark,
  CatalogBrandView,
  adBandBadge,
  adLandingSplitText,
  adLongtailActiveVisible,
  adLongtailSuffix,
  adProbeFields,
  effectivePromoMode,
} from "./catalog-brand-view";

const d = zh.products;

function mark(props: Parameters<typeof AdTrendMark>[0]): string {
  return renderToStaticMarkup(createElement(AdTrendMark, props));
}

describe("AdTrendMark", () => {
  it("renders new / stopped / active / first with their labels", () => {
    expect(mark({ trend: "new", lastAdCount: 0, d })).toContain("↑ 新投");
    expect(mark({ trend: "stopped", lastAdCount: 5, d })).toContain(
      "↓ 疑似停投"
    );
    expect(mark({ trend: "active", lastAdCount: 3, d })).toContain(
      "→ 持续在投"
    );
    expect(mark({ trend: "first", lastAdCount: null, d })).toContain("首次计算");
  });

  it("colors: new is green, stopped is red, active is gray", () => {
    expect(mark({ trend: "new", lastAdCount: 0, d })).toContain("text-emerald-700");
    expect(mark({ trend: "stopped", lastAdCount: 5, d })).toContain("text-red-700");
    expect(mark({ trend: "active", lastAdCount: 3, d })).toContain("text-ink/50");
  });

  it("renders nothing for none / null / undefined", () => {
    expect(mark({ trend: "none", lastAdCount: 0, d })).toBe("");
    expect(mark({ trend: null, lastAdCount: null, d })).toBe("");
    expect(mark({ trend: undefined, lastAdCount: undefined, d })).toBe("");
  });

  it("title carries last count and date when both exist", () => {
    const at = "2026-10-01T00:00:00.000Z";
    const html = mark({
      trend: "stopped",
      lastAdCount: 7,
      lastAdCountAt: at,
      d,
    });
    expect(html).toContain("上次 7 条");
    // 组件按本地时区渲染日期（浏览器里即用户时区，属预期行为）；
    // 期望值按同一口径现算，避免断言随时区环境翻红。
    const dt = new Date(at);
    const expected = `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
    expect(html).toContain(expected);
  });

  it("title falls back to count-only without a date, and is absent without a count", () => {
    expect(mark({ trend: "new", lastAdCount: 2, d })).toContain("上次 2 条");
    expect(mark({ trend: "new", lastAdCount: null, d })).not.toContain("title=");
  });
});

describe("adBandBadge", () => {
  it("maps API band keys to existing tier labels/colors", () => {
    expect(adBandBadge("sweet", 10, d)).toEqual({
      label: "稳定投放·甜蜜点",
      cls: "bg-emerald-100 text-emerald-800",
    });
    expect(adBandBadge("redocean", 60, d)?.label).toBe("红海");
    expect(adBandBadge("none", 0, d)?.label).toBe("无人投放");
    expect(adBandBadge("hot", 30, d)?.label).toBe("竞争较热");
    expect(adBandBadge("small", 2, d)?.label).toBe("小规模在投");
  });

  it("falls back to the shared tier from adCount when band is null", () => {
    expect(adBandBadge(null, 30, d)?.label).toBe("竞争较热");
    expect(adBandBadge(null, 0, d)?.label).toBe("无人投放");
    expect(adBandBadge(null, null, d)).toBeNull();
  });
});

describe("adLandingSplitText", () => {
  it("joins both parts when both have values", () => {
    expect(adLandingSplitText(3, 5, d)).toBe("首页 3 · 商品 5");
  });

  it("shows only the part that has a value", () => {
    expect(adLandingSplitText(3, null, d)).toBe("首页 3");
    expect(adLandingSplitText(null, 5, d)).toBe("商品 5");
    expect(adLandingSplitText(3, undefined, d)).toBe("首页 3");
  });

  it("returns null when both are null/undefined (line hidden)", () => {
    expect(adLandingSplitText(null, null, d)).toBeNull();
    expect(adLandingSplitText(undefined, undefined, d)).toBeNull();
  });

  it("treats 0 as a real value", () => {
    expect(adLandingSplitText(0, 0, d)).toBe("首页 0 · 商品 0");
  });
});

describe("effectivePromoMode", () => {
  function brand(partial: Partial<CatalogBrand>): CatalogBrand {
    return {
      brand: "B",
      brandKey: "b",
      countryCode: "US",
      networkId: "n1",
      productCount: 1,
      priceMin: null,
      priceMax: null,
      maxRatePct: null,
      maxCommissionUsd: null,
      ge80Count: 0,
      adCount: null,
      adCountSelf: null,
      adCountOthers: null,
      adCountHome: null,
      adCountProduct: null,
      lastAdCount: null,
      adTrend: null,
      adBand: null,
      brandScore: 0,
      landingUrl: null,
      promoMode: null,
      topProducts: [],
      ...partial,
    };
  }

  it("explicit annotation wins over the landing URL", () => {
    expect(
      effectivePromoMode(brand({ promoMode: "product", landingUrl: "https://x" }))
    ).toBe("product");
    expect(
      effectivePromoMode(brand({ promoMode: "brand", landingUrl: null }))
    ).toBe("brand");
  });

  it("unmarked + filled link counts as brand page; unmarked + no link is unmarked (never inferred product)", () => {
    expect(
      effectivePromoMode(brand({ promoMode: null, landingUrl: "https://x" }))
    ).toBe("brand");
    expect(
      effectivePromoMode(brand({ promoMode: null, landingUrl: null }))
    ).toBe("unmarked");
  });
});

describe("adProbeFields", () => {
  it("passes through a numeric longtail and an explicit policy risk", () => {
    expect(adProbeFields({ adCountLongtail: 7, adPolicyRisk: true })).toEqual({
      longtail: 7,
      policyRisk: true,
    });
    expect(adProbeFields({ adCountLongtail: 0, adPolicyRisk: false })).toEqual(
      { longtail: 0, policyRisk: false }
    );
  });

  it("defaults missing/invalid fields to null / false (never guessed)", () => {
    expect(adProbeFields({})).toEqual({ longtail: null, policyRisk: false });
    expect(
      adProbeFields({ adCountLongtail: null, adPolicyRisk: undefined })
    ).toEqual({ longtail: null, policyRisk: false });
    expect(
      adProbeFields({ adCountLongtail: "7", adPolicyRisk: "yes" })
    ).toEqual({ longtail: null, policyRisk: false });
    expect(adProbeFields({ adCountLongtail: Number.NaN })).toEqual({
      longtail: null,
      policyRisk: false,
    });
  });
});

describe("adLongtailSuffix", () => {
  it("renders the probe count as a suffix with the leading separator", () => {
    expect(adLongtailSuffix(5, d)).toBe("· 长尾探针 约 5 条");
    expect(adLongtailSuffix(0, d)).toBe("· 长尾探针 约 0 条");
  });

  it("renders in English with the en template", () => {
    expect(adLongtailSuffix(5, en.products)).toBe("· Longtail probe ~5 ads");
  });

  it("returns null when not probed yet (line hidden)", () => {
    expect(adLongtailSuffix(null, d)).toBeNull();
    expect(adLongtailSuffix(undefined, d)).toBeNull();
  });
});

describe("adLongtailActiveVisible", () => {
  it("shows when the bare brand term has no ads but the longtail probe found some", () => {
    expect(adLongtailActiveVisible(0, 1)).toBe(true);
    expect(adLongtailActiveVisible(0, 12)).toBe(true);
    expect(adLongtailActiveVisible(null, 3)).toBe(true);
  });

  it("hides when the bare term already has ads, the probe found none, or nothing was probed", () => {
    expect(adLongtailActiveVisible(2, 5)).toBe(false);
    expect(adLongtailActiveVisible(0, 0)).toBe(false);
    expect(adLongtailActiveVisible(null, null)).toBe(false);
    expect(adLongtailActiveVisible(0, null)).toBe(false);
    expect(adLongtailActiveVisible(undefined, undefined)).toBe(false);
  });
});

describe("multi-probe dict keys", () => {
  it("exist in both languages with template placeholders intact", () => {
    for (const dict of [zh, en]) {
      const p = dict.products;
      expect(p.adsLongtailApprox).toContain("{n}");
      expect(p.adsLongtailShort).toContain("{n}");
      expect(p.adLongtailActive.length).toBeGreaterThan(0);
      expect(p.adPolicyRisk.length).toBeGreaterThan(0);
      expect(p.adPolicyRiskCategory.length).toBeGreaterThan(0);
    }
    expect(zh.products.adLongtailActive).toBe("长尾在投");
    expect(zh.products.adPolicyRisk).toBe("政策受限");
    expect(zh.products.adPolicyRiskCategory).toBe("政策受限类");
  });
});

describe("CatalogBrandView", () => {
  it("starts in the loading state", () => {
    const html = renderToStaticMarkup(
      createElement(CatalogBrandView, {
        d: zh,
        networkId: "n1",
        country: "",
        q: "",
      })
    );
    expect(html).toContain("品牌加载中…");
  });
});

describe("brand view dict keys", () => {
  it("exist in both languages with template placeholders intact", () => {
    for (const dict of [zh, en]) {
      const p = dict.products;
      expect(p.viewModeProducts.length).toBeGreaterThan(0);
      expect(p.viewModeBrands.length).toBeGreaterThan(0);
      expect(p.brandTotal).toContain("{n}");
      expect(p.trendPrevTip).toContain("{n}");
      expect(p.trendPrevTip).toContain("{date}");
      expect(p.oneClickAdStopped).toContain("{n}");
      expect(p.brandModeBrandPage.length).toBeGreaterThan(0);
      expect(p.brandModeProduct.length).toBeGreaterThan(0);
      expect(p.brandLandingSet.length).toBeGreaterThan(0);
      expect(p.brandLandingApplied.length).toBeGreaterThan(0);
      expect(p.brandEmpty.length).toBeGreaterThan(0);
      expect(p.adsHome).toContain("{n}");
      expect(p.adsProduct).toContain("{n}");
      expect(p.oneClickAdWaived).toContain("{n}");
      expect(p.brandModeUnmarked.length).toBeGreaterThan(0);
      expect(p.promoModeLabel.length).toBeGreaterThan(0);
      expect(p.promoModeBrand.length).toBeGreaterThan(0);
      expect(p.promoModeProduct.length).toBeGreaterThan(0);
      expect(p.promoModeSaved.length).toBeGreaterThan(0);
    }
    expect(zh.products.brandModeUnmarked).toBe("未标注");
    expect(zh.products.brandModeProduct).toBe("单品投放");
    expect(zh.products.brandModeBrandPage).toBe("品牌页投放");
  });
});
