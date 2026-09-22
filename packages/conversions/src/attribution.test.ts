import { describe, expect, it } from "vitest";
import { buildAttributionChain, isFullyAttributed, resolveGoogleClickIdentity, assertMoneyDecimal, assertCurrencyCode } from "./attribution.js";

describe("attribution", () => {
  it("requires click, conversion, and order for full attribution", () => {
    const chain = buildAttributionChain({
      click: {
        id: "c1",
        clickId: "c1",
        tenantId: "t1",
        trackingLinkId: "t1",
        occurredAt: new Date(),
        createdAt: new Date(),
      },
      conversion: {
        id: "cv1",
        tenantId: "t1",
        clickId: "c1",
        conversionAction: "purchase",
        conversionTime: new Date(),
        value: "49.9900",
        currency: "USD",
        status: "ATTRIBUTED",
        googleUploadStatus: "NOT_UPLOADED",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      order: {
        id: "o1",
        tenantId: "t1",
        orderId: "ord-1",
        value: "49.9900",
        currency: "USD",
        amount: 49.99,
        currencyCode: "USD",
        status: "CONFIRMED",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    expect(isFullyAttributed(chain)).toBe(true);
  });

  it("resolves google click identity in priority order", () => {
    expect(
      resolveGoogleClickIdentity({
        gclid: "g",
        gbraid: "gb",
        wbraid: "wb",
      })
    ).toEqual({ kind: "gclid", value: "g" });
    expect(resolveGoogleClickIdentity({ gbraid: "gb" })).toEqual({
      kind: "gbraid",
      value: "gb",
    });
    expect(resolveGoogleClickIdentity({})).toBeNull();
  });

  it("validates money and currency", () => {
    expect(assertMoneyDecimal("10.5")).toBe("10.5");
    expect(assertCurrencyCode("eur")).toBe("EUR");
  });
});
