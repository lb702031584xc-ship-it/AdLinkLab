import { describe, expect, it } from "vitest";
import { JOB_DEFINITIONS, QUEUE_NAMES, buildJobIdempotencyKey } from "./jobs.js";

describe("queue job definitions", () => {
  it("defines all required job types", () => {
    const names = JOB_DEFINITIONS.map((j) => j.name).sort();
    expect(names).toEqual(
      [
        "analyticsAggregation",
        "clickProcessing",
        "conversionUpload",
        "googleAdsSync",
        "urlChange",
      ].sort()
    );
  });

  it("builds stable idempotency keys", () => {
    expect(buildJobIdempotencyKey("googleAdsSync", "cust-1", "full")).toBe(
      "googleAdsSync:cust-1:full"
    );
    expect(QUEUE_NAMES.urlChange).toBe("urlChange");
  });
});
