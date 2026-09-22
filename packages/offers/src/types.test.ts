import { describe, expect, it } from "vitest";
import { describeOfferDestination } from "./types.js";
import { makeOffer } from "./test-fakes.js";

describe("describeOfferDestination", () => {
  it("formats network and destinationUrl", () => {
    const offer = makeOffer({
      id: "o1",
      tenantId: "t1",
      network: "partner-a",
      destinationUrl: "https://partner.example/x",
    });
    expect(describeOfferDestination(offer)).toBe(
      "partner-a → https://partner.example/x"
    );
  });
});
