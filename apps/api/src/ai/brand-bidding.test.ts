/**
 * 品牌词投流检查测试：域名归一化/官方判定/广告主提取/评估文案/无凭证降级。
 * DataForSEO 用 fetchImpl 注入，不打真实接口。
 */
import { describe, expect, it, vi } from "vitest";
import {
  normalizeDomain,
  isOfficialDomain,
  extractBidders,
  buildAssessment,
  checkBrandBidding,
} from "./brand-bidding.js";

const fakePrismaNoCreds = {
  aiSetting: { findUnique: async () => null },
} as never;

const fakePrismaWithCreds = {
  aiSetting: {
    findUnique: async ({ where }: { where: { key: string } }) => {
      if (where.key === "traffic.dataforseoLogin") return { value: "ENC_LOGIN" };
      if (where.key === "traffic.dataforseoPassword") return { value: "ENC_PASS" };
      return null;
    },
  },
} as never;

// settings.ts 会调 assertAiSettingsPepperConfigured + decryptSecret；
// 这里直接 mock 掉整个 settings 模块的读凭证函数。
vi.mock("../traffic/settings.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../traffic/settings.js")>();
  return {
    ...orig,
    readEncryptedTrafficSetting: async (prisma: never, key: string) => {
      const row = await (
        prisma as { aiSetting: { findUnique: (a: unknown) => Promise<{ value: string } | null> } }
      ).aiSetting.findUnique({ where: { key } });
      if (!row) return null;
      return row.value === "ENC_LOGIN" ? "login" : "password";
    },
  };
});

function serpFetch(items: unknown[]) {
  return async () =>
    ({
      ok: true,
      json: async () => ({
        tasks: [{ status_code: 20000, result: [{ items }] }],
      }),
    }) as never;
}

describe("normalizeDomain / isOfficialDomain", () => {
  it("去 www. 与大小写", () => {
    expect(normalizeDomain("WWW.NordVPN.COM ")).toBe("nordvpn.com");
  });
  it("子域名算官方", () => {
    expect(isOfficialDomain("go.nordvpn.com", "nordvpn.com")).toBe(true);
    expect(isOfficialDomain("nordvpn.com", "nordvpn.com")).toBe(true);
    expect(isOfficialDomain("nordvpn-deals.com", "nordvpn.com")).toBe(false);
  });
});

describe("extractBidders", () => {
  it("只取 paid 项并去重", () => {
    const bidders = extractBidders(
      [
        { type: "paid", domain: "nordvpn.com", title: "Official" },
        { type: "paid", domain: "www.nordvpn.com", title: "dup" },
        { type: "paid", domain: "vpndeals.com", title: "Deals" },
        { type: "organic", domain: "blog.com" },
      ],
      "nordvpn.com"
    );
    expect(bidders).toHaveLength(2);
    expect(bidders[0]!.isOfficial).toBe(true);
    expect(bidders[1]!.domain).toBe("vpndeals.com");
  });
});

describe("buildAssessment", () => {
  it("三种 verdict 都有评估", () => {
    expect(buildAssessment("no_ads", [], "merach")).toHaveLength(2);
    expect(buildAssessment("official_only", [], "merach")[0]).toContain("官方独占");
    const a = buildAssessment(
      "non_official_present",
      [{ domain: "vpndeals.com", title: null, isOfficial: false }],
      "nordvpn"
    );
    expect(a[0]).toContain("vpndeals.com");
    expect(a.join("")).toContain("封户");
  });
});

describe("checkBrandBidding", () => {
  it("无凭证 → unavailable + 手动指引", async () => {
    const r = await checkBrandBidding("nordvpn", "nordvpn.com", {
      prisma: fakePrismaNoCreds,
    });
    expect(r.status).toBe("unavailable");
    expect(r.verdict).toBeNull();
    expect(r.assessment.join("")).toContain("Transparency");
  });

  it("有非官方在投 → non_official_present", async () => {
    const r = await checkBrandBidding("nordvpn", "nordvpn.com", {
      prisma: fakePrismaWithCreds,
      fetchImpl: serpFetch([
        { type: "paid", domain: "nordvpn.com", title: "Official VPN" },
        { type: "paid", domain: "vpndeals.com", title: "Cheap VPN Deals" },
      ]),
    });
    expect(r.status).toBe("ok");
    expect(r.verdict).toBe("non_official_present");
    expect(r.adsFound).toBe(2);
    expect(r.nonOfficialAds).toBe(1);
    expect(r.nonOfficial[0]!.domain).toBe("vpndeals.com");
  });

  it("无广告 → no_ads", async () => {
    const r = await checkBrandBidding("someobscurebrand", "someobscurebrand.com", {
      prisma: fakePrismaWithCreds,
      fetchImpl: serpFetch([{ type: "organic", domain: "blog.com" }]),
    });
    expect(r.verdict).toBe("no_ads");
  });

  it("品牌词为空 → 抛错", async () => {
    await expect(
      checkBrandBidding("  ", "nordvpn.com", { prisma: fakePrismaNoCreds })
    ).rejects.toThrow();
  });

  it("403 + JSON status_message → 错误含真实原因", async () => {
    const fetchImpl = async () =>
      ({
        ok: false,
        status: 403,
        text: async () =>
          JSON.stringify({
            status_code: 40300,
            status_message: "Invalid login or password.",
          }),
      }) as never;
    await expect(
      checkBrandBidding("nordvpn", "nordvpn.com", {
        prisma: fakePrismaWithCreds,
        fetchImpl,
      })
    ).rejects.toThrow("Invalid login or password");
  });
});
