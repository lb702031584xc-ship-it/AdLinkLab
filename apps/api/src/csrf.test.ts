/**
 * P1-20：CSRF Origin 校验 — 纯函数单测。
 */
import { describe, expect, it } from "vitest";
import { shouldBlockCsrf } from "./csrf.js";

describe("P1-20 shouldBlockCsrf", () => {
  it("blocks cross-origin requests carrying the session cookie", () => {
    expect(
      shouldBlockCsrf({
        origin: "https://evil.example.com",
        host: "adtlab.xyz",
        cookie: "alk_session=abc; other=1",
      })
    ).toBe(true);
  });

  it("allows same-origin session requests", () => {
    expect(
      shouldBlockCsrf({
        origin: "https://adtlab.xyz",
        host: "adtlab.xyz",
        cookie: "alk_session=abc",
      })
    ).toBe(false);
  });

  it("skips Bearer/API-key requests (no session cookie) and no-Origin clients", () => {
    expect(
      shouldBlockCsrf({
        origin: "https://evil.example.com",
        host: "adtlab.xyz",
        cookie: "other=1",
      })
    ).toBe(false);
    expect(
      shouldBlockCsrf({ host: "adtlab.xyz", cookie: "alk_session=abc" })
    ).toBe(false);
  });
});
