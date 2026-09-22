import { describe, expect, it } from "vitest";
import { MockTrafficProvider } from "./mock-provider.js";

describe("MockTrafficProvider", () => {
  it("records click events locally", async () => {
    const provider = new MockTrafficProvider();
    const result = await provider.recordClick({
      tenantId: "00000000-0000-4000-8000-000000000001",
      trackingLinkId: "tl-1",
      gclid: "gclid-1",
      utmSource: "google",
    });
    expect(result.accepted).toBe(true);
    expect(provider.events).toHaveLength(1);
  });
});
