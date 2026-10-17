import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chatJsonAccounting,
  chatJsonValidatedAccounting,
  chatJsonValidatedWithMeta,
  chatJsonWithMeta,
  parseUsage,
} from "./llm.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockChatResponse(envelope: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(envelope),
  } as unknown as Response;
}

function envelope(content: string, usage?: unknown) {
  return {
    choices: [{ message: { content } }],
    ...(usage ? { usage } : {}),
  };
}

const args = {
  baseUrl: "https://example.test/v1",
  model: "deepseek-chat",
  apiKey: "test-key",
  system: "s",
  user: "u",
};

describe("parseUsage", () => {
  it("服务商返回 usage 时解析三项", () => {
    expect(
      parseUsage({
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
    ).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it("无 usage 字段时按 0 处理，不编造", () => {
    expect(parseUsage({ choices: [] })).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(parseUsage(null)).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it("total 缺失时用 in+out 求和", () => {
    expect(
      parseUsage({ usage: { prompt_tokens: 3, completion_tokens: 4 } })
    ).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });
  });
});

describe("chatJsonWithMeta", () => {
  it("透传 usage + latency + model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockChatResponse(
          envelope('{"a":1}', {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          })
        )
      )
    );
    const r = await chatJsonWithMeta(args);
    expect(r.data).toEqual({ a: 1 });
    expect(r.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(r.model).toBe("deepseek-chat");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("无 usage 时记 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockChatResponse(envelope('{"a":1}')))
    );
    const r = await chatJsonWithMeta(args);
    expect(r.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });
});

describe("chatJsonValidatedWithMeta", () => {
  it("校验重试时 usage/latency 累加", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockChatResponse(
          envelope('{"wrong":1}', {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          })
        )
      )
      .mockResolvedValueOnce(
        mockChatResponse(
          envelope('{"a":2}', {
            prompt_tokens: 20,
            completion_tokens: 10,
            total_tokens: 30,
          })
        )
      );
    vi.stubGlobal("fetch", fetchMock);
    const r = await chatJsonValidatedWithMeta(args, (obj) => {
      const o = obj as { a?: unknown };
      if (typeof o.a !== "number") throw new Error("missing a");
      return o;
    });
    expect(r.data).toEqual({ a: 2 });
    expect(r.usage).toEqual({
      promptTokens: 30,
      completionTokens: 15,
      totalTokens: 45,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("accounting 入口（注入 impl 时）", () => {
  it("chatJsonValidatedAccounting：注入 impl → 数据原样，usage 记 0", async () => {
    const r = await chatJsonValidatedAccounting(
      args,
      (obj) => obj as { a: number },
      async () => ({ a: 9 })
    );
    expect(r.data).toEqual({ a: 9 });
    expect(r.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(r.latencyMs).toBe(0);
  });

  it("chatJsonAccounting：注入 impl → 数据原样，usage 记 0", async () => {
    const r = await chatJsonAccounting(args, async () => ({ b: 1 }));
    expect(r.data).toEqual({ b: 1 });
    expect(r.usage.completionTokens).toBe(0);
  });
});
