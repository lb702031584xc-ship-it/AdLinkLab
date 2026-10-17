/** §5 授权 helper 纯函数测试（无 DB）。 */
import { describe, expect, it } from "vitest";
import {
  isGrantCurrentlyValid,
  isValidWhitelistEntry,
  parseWhitelist,
  whitelistContains,
} from "./admin-grants.js";

const base = {
  id: "g1",
  tenantId: "t1",
  capability: "tracking-link-resolve",
  applicationId: null,
  applicantId: "u1",
  approverId: "u2",
  whitelist: ["example.com"],
  usageLimit: {},
  usageCount: 0,
  status: "active",
  startsAt: new Date(),
  endsAt: new Date(Date.now() + 86400 * 1000),
  revokedReason: null,
};

describe("§5 grant helpers", () => {
  it("通配符 / 全部网站 不是合法白名单条目", () => {
    expect(isValidWhitelistEntry("*.example.com")).toBe(false);
    expect(isValidWhitelistEntry("全部网站")).toBe(false);
    expect(isValidWhitelistEntry("example.com")).toBe(true);
    expect(() => parseWhitelist(["*.example.com"])).toThrow();
    expect(() => parseWhitelist([])).toThrow();
  });

  it("白名单精确匹配：通配符条目永不匹配", () => {
    expect(whitelistContains(["example.com"], "example.com")).toBe(true);
    expect(whitelistContains(["*.example.com"], "sub.example.com")).toBe(false);
    expect(whitelistContains(["example.com"], "other.com")).toBe(false);
  });

  it("过期 / 超限 / 已吊销 → 无效", () => {
    expect(isGrantCurrentlyValid(base)).toBe(true);
    expect(
      isGrantCurrentlyValid({ ...base, endsAt: new Date(Date.now() - 1000) })
    ).toBe(false);
    expect(
      isGrantCurrentlyValid({
        ...base,
        usageLimit: { maxCalls: 5 },
        usageCount: 5,
      })
    ).toBe(false);
    expect(isGrantCurrentlyValid({ ...base, status: "revoked" })).toBe(false);
  });
});
