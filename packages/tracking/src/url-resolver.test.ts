import { describe, expect, it } from "vitest";
import { UrlResolver } from "./url-resolver.js";

describe("UrlResolver", () => {
  const resolver = new UrlResolver();

  it("keeps final url, template, and custom params separate", () => {
    const result = resolver.resolve({
      finalUrl: "https://example.com/landing",
      trackingTemplate:
        "https://tracker.example.com/click?cid={_clickid}&url={lpurl}",
      customParameters: { _clickid: "abc123" },
    });

    expect(result.finalUrl).toBe("https://example.com/landing");
    expect(result.trackingTemplate).toContain("tracker.example.com");
    expect(result.customParameters._clickid).toBe("abc123");
    expect(result.resolvedTrackingUrl).toContain("cid=abc123");
    expect(result.resolvedTrackingUrl).toContain(
      encodeURIComponent("https://example.com/landing")
    );
  });
});
