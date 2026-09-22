import { describe, expect, it } from "vitest";
import { createSeededMemoryRepositories } from "@adlinklab/database";
import { UrlVersionService } from "./index.js";

describe("UrlVersionService", () => {
  it("appends versions without overwriting history", async () => {
    const repos = createSeededMemoryRepositories();
    const service = new UrlVersionService(repos.urlVersions, repos.ads);
    const adId = (await repos.ads.list()).items[0]!.id;
    const before = await repos.urlVersions.listByAdId(adId);
    const expectedVersion =
      before.length === 0 ? 1 : Math.max(...before.map((v) => v.version)) + 1;

    const created = await service.createVersion({
      adId,
      finalUrl: "https://example.com/landing-v-next",
      trackingTemplate: "https://tracker.example.com/click?cid={_clickid}&url={lpurl}",
      customParameters: { _clickid: "v-next" },
    });

    expect(created.version).toBe(expectedVersion);
    const history = await repos.urlVersions.listByAdId(adId);
    expect(history.length).toBe(before.length + 1);
    expect(history.find((v) => v.version === created.version)?.status).toBe("ACTIVE");
    expect(
      history.filter((v) => v.version !== created.version && v.status === "ACTIVE")
    ).toHaveLength(0);
    // Historical rows retain their finalUrl content
    expect(history.find((v) => v.version === 1)?.finalUrl).toBe(
      "https://example.com/landing"
    );
  });
});
