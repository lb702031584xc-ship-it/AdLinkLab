import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError, chatJson } from "./llm.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockChatResponse(content: string) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

const args = {
  baseUrl: "https://example.test/v1",
  model: "deepseek-flash",
  apiKey: "k",
  system: "s",
  user: "u",
};

describe("chatJson", () => {
  it("模型返回非 JSON 内容时抛带片段的 AiError，而不是原生 SyntaxError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockChatResponse("not json at all")));
    await expect(chatJson(args)).rejects.toThrow(AiError);
    await expect(chatJson(args)).rejects.toThrow("LLM returned invalid JSON");
  });

  it("模型返回空内容时同样抛 AiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockChatResponse("")));
    await expect(chatJson(args)).rejects.toThrow(AiError);
  });

  it("模型返回合法 JSON 时正常解析", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockChatResponse('{"a":1}')));
    await expect(chatJson(args)).resolves.toEqual({ a: 1 });
  });
});
