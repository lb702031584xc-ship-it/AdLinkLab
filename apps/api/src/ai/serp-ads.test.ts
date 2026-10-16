/**
 * fetchSerpAds 测试：DataForSEO 失败时把返回体里的 status_message
 * 带进错误信息（而不是只剩 HTTP 状态码），以及正常返回路径。
 * fetch 用 fetchImpl 注入，不打真实接口。
 */
import { describe, expect, it } from "vitest";
import { fetchSerpAds } from "./serp-ads.js";

function mockFetch(status: number, body: string) {
  return async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
      json: async () => JSON.parse(body),
    }) as never;
}

const CREDS = { login: "login", password: "password" };

describe("fetchSerpAds DataForSEO 错误信息", () => {
  it("403 + JSON 顶层 status_message → 错误含真实原因", async () => {
    const fetchImpl = mockFetch(
      403,
      JSON.stringify({
        status_code: 40300,
        status_message: "Invalid login or password.",
      })
    );
    await expect(
      fetchSerpAds("nordvpn", CREDS, { fetchImpl })
    ).rejects.toThrow("Invalid login or password");
  });

  it("403 + 仅 tasks[0].status_message → 取任务级原因", async () => {
    const fetchImpl = mockFetch(
      403,
      JSON.stringify({
        status_code: 40300,
        tasks: [{ status_message: "Task failed: quota exceeded." }],
      })
    );
    await expect(
      fetchSerpAds("nordvpn", CREDS, { fetchImpl })
    ).rejects.toThrow("quota exceeded");
  });

  it("403 + 非 JSON body → 错误含 raw text", async () => {
    const fetchImpl = mockFetch(403, "Forbidden: bad credentials");
    await expect(fetchSerpAds("nordvpn", CREDS, { fetchImpl })).rejects.toThrow(
      "Forbidden: bad credentials"
    );
  });

  it("403 + 空 body → 错误仍是 HTTP 403 且不崩", async () => {
    const fetchImpl = mockFetch(403, "");
    await expect(fetchSerpAds("nordvpn", CREDS, { fetchImpl })).rejects.toThrow(
      "HTTP 403"
    );
  });

  it("200 + paid items → 正常返回", async () => {
    const fetchImpl = mockFetch(
      200,
      JSON.stringify({
        tasks: [
          {
            status_code: 20000,
            result: [
              {
                items: [
                  {
                    type: "paid",
                    title: "Ad 1",
                    description: "Desc 1",
                    domain: "example.com",
                  },
                  { type: "organic", title: "Blog", description: "Post" },
                ],
              },
            ],
          },
        ],
      })
    );
    const ads = await fetchSerpAds("nordvpn", CREDS, { fetchImpl });
    expect(ads).toHaveLength(1);
    expect(ads[0]!.title).toBe("Ad 1");
    expect(ads[0]!.displayUrl).toBe("example.com");
  });
});
