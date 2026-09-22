import { describe, expect, it } from "vitest";
import {
  CustomParameterResolver,
  HierarchyResolver,
  ServingUrlResolver,
} from "./index.js";

describe("URL hierarchy resolution", () => {
  it("orders Customer → Campaign → AdGroup → Ad", () => {
    const hierarchy = new HierarchyResolver().resolve({
      levels: [
        {
          entityType: "AD",
          entityId: "ad-1",
          config: { finalUrl: "https://example.com/ad", customParameters: {} },
        },
        {
          entityType: "CUSTOMER",
          entityId: "cust-1",
          config: {
            trackingTemplate: "https://tracker.example.com/?url={lpurl}",
            customParameters: { _account: "a" },
          },
        },
        {
          entityType: "CAMPAIGN",
          entityId: "camp-1",
          config: { customParameters: { _camp: "c" } },
        },
      ],
    });

    expect(hierarchy.chain).toEqual(["CUSTOMER", "CAMPAIGN", "AD"]);
    expect(hierarchy.target.entityType).toBe("AD");
  });
});

describe("Custom parameter inheritance", () => {
  it("lets more specific levels override parent keys", () => {
    const merged = new CustomParameterResolver().resolveFromHierarchy([
      {
        entityType: "CUSTOMER",
        entityId: "c",
        config: { customParameters: { _clickid: "from-customer", _brand: "x" } },
      },
      {
        entityType: "AD",
        entityId: "a",
        config: { customParameters: { _clickid: "from-ad" } },
      },
    ]);

    expect(merged._clickid).toBe("from-ad");
    expect(merged._brand).toBe("x");
  });
});

describe("Serving URL resolution", () => {
  it("expands ValueTrack, custom params, and {lpurl}", () => {
    const result = new ServingUrlResolver().resolveServingUrl({
      levels: [
        {
          entityType: "CAMPAIGN",
          entityId: "camp",
          config: {
            trackingTemplate:
              "https://tracker.example.com/c/{campaignid}?cid={_clickid}&url={lpurl}",
            customParameters: { _clickid: "abc" },
          },
        },
        {
          entityType: "AD",
          entityId: "ad",
          config: {
            finalUrl: "https://example.com/landing",
            finalMobileUrl: "https://m.example.com/landing",
            customParameters: {},
          },
        },
      ],
      valueTrack: { campaignId: "1001" },
      device: "desktop",
    });

    expect(result.hierarchyChain).toEqual(["CAMPAIGN", "AD"]);
    expect(result.finalUrl).toBe("https://example.com/landing");
    expect(result.servingUrl).toContain("1001");
    expect(result.servingUrl).toContain("cid=abc");
    expect(result.servingUrl).toContain(
      encodeURIComponent("https://example.com/landing")
    );
    expect(result.usedMobileUrl).toBe(false);
  });

  it("uses finalMobileUrl when device is mobile", () => {
    const result = new ServingUrlResolver().resolveServingUrl({
      levels: [
        {
          entityType: "AD",
          entityId: "ad",
          config: {
            finalUrl: "https://example.com/desktop",
            finalMobileUrl: "https://m.example.com/mobile",
            trackingTemplate: "https://tracker.example.com/?url={lpurl}",
            customParameters: {},
          },
        },
      ],
      device: "mobile",
    });

    expect(result.usedMobileUrl).toBe(true);
    expect(result.servingUrl).toContain(
      encodeURIComponent("https://m.example.com/mobile")
    );
  });
});
