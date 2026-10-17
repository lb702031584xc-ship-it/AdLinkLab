/**
 * Phase 11 — OpenAI-compatible chat client (DeepSeek / OpenAI / Claude-via-proxy).
 * Never log apiKey, request bodies, or Authorization headers.
 */
import { AppError } from "@adlinklab/shared";

export class AiError extends AppError {
  constructor(message: string, statusCode = 502) {
    super(message, { code: "AI_ERROR", statusCode });
    this.name = "AiError";
  }
}

export interface ChatJsonArgs {
  baseUrl: string;
  model: string;
  /** Plaintext key — caller's responsibility to source from encrypted storage. */
  apiKey: string;
  system: string;
  user: string;
}

/**
 * Vision variant: user message carries text + image data URLs
 * (OpenAI multimodal format). Callers must keep each image ≤4MB
 * (jpeg/png/webp) — large payloads get rejected by most providers.
 */
export interface ChatJsonVisionArgs extends ChatJsonArgs {
  images: string[];
}

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * P0-6 — LLM 调用记账元数据。usage 来自服务商响应 envelope 的 usage 字段；
 * 服务商没返回时按 0 处理（见 parseUsage），绝不编造 tokens。
 */
export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export const ZERO_USAGE: LlmUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

export interface LlmCallMeta {
  usage: LlmUsage;
  latencyMs: number;
  model: string;
}

export interface LlmCallResult {
  /** Parsed model JSON (same payload chatJson returns). */
  data: unknown;
  usage: LlmUsage;
  latencyMs: number;
  model: string;
}

function asNonNegativeInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.floor(v)
    : 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Extract token usage from an OpenAI-compatible envelope; missing → zeros. */
export function parseUsage(envelope: unknown): LlmUsage {
  if (isRecord(envelope) && isRecord(envelope["usage"])) {
    const u = envelope["usage"];
    const promptTokens = asNonNegativeInt(u["prompt_tokens"]);
    const completionTokens = asNonNegativeInt(u["completion_tokens"]);
    const totalTokens =
      asNonNegativeInt(u["total_tokens"]) || promptTokens + completionTokens;
    return { promptTokens, completionTokens, totalTokens };
  }
  return { ...ZERO_USAGE };
}

/**
 * Call chatJson and validate the result, retrying ONCE with targeted feedback
 * when validation fails. Smaller models often need the nudge; the retry tells
 * them exactly which field was wrong.
 *
 * Generic over the args type so vision callers can pass their own impl.
 */
export async function chatJsonValidated<T, A extends ChatJsonArgs = ChatJsonArgs>(
  args: A,
  validate: (obj: unknown) => T,
  impl: (args: A) => Promise<unknown> = chatJson,
): Promise<T> {
  const raw = await impl(args);
  try {
    return validate(raw);
  } catch (e) {
    const reason = e instanceof AiError ? e.message : "invalid shape";
    const retry = await impl({
      ...args,
      system:
        `${args.system}\n\nIMPORTANT: your previous response was rejected (${reason}). ` +
        `Return ONLY the corrected STRICT JSON object matching the spec — no markdown fences, no commentary, no extra text.`,
    });
    return validate(retry);
  }
}

/** Read a short snippet of an error response body (for diagnosing provider errors). */
async function errorSnippet(res: Response): Promise<string> {
  try {
    const t = (await res.text()).trim().slice(0, 400).replace(/\s+/g, " ");
    return t ? `: ${t}` : "";
  } catch {
    return "";
  }
}

/**
 * Shared POST {baseUrl}/chat/completions with response_format json_object.
 * Returns the parsed JSON body plus usage/latency bookkeeping (P0-6).
 * Throws AiError (safe messages only) on network failure, non-2xx status,
 * or invalid JSON.
 */
async function postChatCompletionsWithMeta(
  args: ChatJsonArgs,
  userContent: unknown,
): Promise<LlmCallResult> {
  const started = Date.now();
  const url = `${args.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // apiKey intentionally not logged anywhere on this path.
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        model: args.model,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AiError("LLM request failed: network error");
  }
  if (!res.ok) {
    throw new AiError(`LLM request failed (status ${res.status})${await errorSnippet(res)}`);
  }
  const text = await res.text();
  let envelope: unknown;
  try {
    envelope = JSON.parse(text) as unknown;
  } catch {
    throw new AiError("LLM returned invalid JSON");
  }
  const usage = parseUsage(envelope);
  const latencyMs = Math.max(0, Date.now() - started);
  const content = extractContent(envelope);
  const jsonText = extractJson(content);
  try {
    return {
      data: JSON.parse(jsonText) as unknown,
      usage,
      latencyMs,
      model: args.model,
    };
  } catch {
    // 模型返回了非 JSON 内容（空串/截断/纯文本拒绝）：原生 SyntaxError 不是
    // AiError，会被调用方吞成裸 "LLM request failed"，这里转成带内容片段的 AiError
    const snippet = jsonText.slice(0, 200).replace(/\s+/g, " ");
    throw new AiError(`LLM returned invalid JSON${snippet ? `: ${snippet}` : ""}`);
  }
}

async function postChatCompletions(
  args: ChatJsonArgs,
  userContent: unknown,
): Promise<unknown> {
  return (await postChatCompletionsWithMeta(args, userContent)).data;
}

/**
 * POST {baseUrl}/chat/completions with response_format json_object.
 * Returns the parsed JSON body. Throws AiError (safe messages only) on
 * network failure, non-2xx status, or invalid JSON.
 */
export async function chatJson(args: ChatJsonArgs): Promise<unknown> {
  return postChatCompletions(args, args.user);
}

/**
 * P0-6 — chatJson + 记账元数据（usage/latency/model）。
 * 记账调用方用它；不记账的调用方继续用 chatJson（行为不变）。
 */
export async function chatJsonWithMeta(
  args: ChatJsonArgs,
): Promise<LlmCallResult> {
  return postChatCompletionsWithMeta(args, args.user);
}

/**
 * P0-6 — chatJsonVision + 记账元数据。
 */
export async function chatJsonVisionWithMeta(
  args: ChatJsonVisionArgs,
): Promise<LlmCallResult> {
  return postChatCompletionsWithMeta(args, [
    { type: "text", text: args.user },
    ...args.images.map((u) => ({ type: "image_url", image_url: { url: u } })),
  ]);
}

/**
 * P0-6 — 带校验的 chatJson + 记账元数据。重试时 usage/latency 累加
 *（两次调用都花了 tokens，都要记）。
 */
export async function chatJsonValidatedWithMeta<
  T,
  A extends ChatJsonArgs = ChatJsonArgs,
>(
  args: A,
  validate: (obj: unknown) => T,
  impl: (args: A) => Promise<LlmCallResult> = chatJsonWithMeta as (
    args: A,
  ) => Promise<LlmCallResult>,
): Promise<{ data: T; usage: LlmUsage; latencyMs: number; model: string }> {
  const first = await impl(args);
  try {
    return {
      data: validate(first.data),
      usage: first.usage,
      latencyMs: first.latencyMs,
      model: first.model,
    };
  } catch (e) {
    const reason = e instanceof AiError ? e.message : "invalid shape";
    const retry = await impl({
      ...args,
      system:
        `${args.system}\n\nIMPORTANT: your previous response was rejected (${reason}). ` +
        `Return ONLY the corrected STRICT JSON object matching the spec — no markdown fences, no commentary, no extra text.`,
    });
    return {
      data: validate(retry.data),
      usage: {
        promptTokens: first.usage.promptTokens + retry.usage.promptTokens,
        completionTokens:
          first.usage.completionTokens + retry.usage.completionTokens,
        totalTokens: first.usage.totalTokens + retry.usage.totalTokens,
      },
      latencyMs: first.latencyMs + retry.latencyMs,
      model: retry.model,
    };
  }
}

/**
 * P0-6 — 统一记账入口：有注入 impl（测试替身）时走原 chatJsonValidated，
 * usage 未知记 0；无注入时走真实 chatJsonWithMeta，透传真实 usage。
 * 调用方无需分支，拿到 { data, usage, latencyMs, model } 直接记账即可。
 */
export async function chatJsonValidatedAccounting<
  T,
  A extends ChatJsonArgs = ChatJsonArgs,
>(
  args: A,
  validate: (obj: unknown) => T,
  impl?: (args: A) => Promise<unknown>,
): Promise<{ data: T; usage: LlmUsage; latencyMs: number; model: string }> {
  if (impl) {
    const data = await chatJsonValidated(args, validate, impl);
    return { data, usage: { ...ZERO_USAGE }, latencyMs: 0, model: args.model };
  }
  return chatJsonValidatedWithMeta(args, validate);
}

/**
 * P0-6 — chatJson 的记账版（无校验场景，如 recommend-keywords / traffic-plan）。
 * 有注入 impl 时 usage 记 0；否则透传真实 usage。
 */
export async function chatJsonAccounting<A extends ChatJsonArgs = ChatJsonArgs>(
  args: A,
  impl?: (args: A) => Promise<unknown>,
): Promise<{ data: unknown; usage: LlmUsage; latencyMs: number; model: string }> {
  if (impl) {
    const data = await impl(args);
    return { data, usage: { ...ZERO_USAGE }, latencyMs: 0, model: args.model };
  }
  const r = await chatJsonWithMeta(args);
  return { data: r.data, usage: r.usage, latencyMs: r.latencyMs, model: r.model };
}

/**
 * Vision variant of chatJson: sends text + image data URLs in one user message.
 * Whether the configured model actually supports vision is unknown until the
 * provider answers — callers should map vision-unsupported provider errors
 * (see keepa/vision.ts isVisionUnsupportedError) to a clear user message.
 */
export async function chatJsonVision(args: ChatJsonVisionArgs): Promise<unknown> {
  return postChatCompletions(args, [
    { type: "text", text: args.user },
    ...args.images.map((u) => ({ type: "image_url", image_url: { url: u } })),
  ]);
}

/**
 * Unwrap the OpenAI-compatible chat-completion envelope:
 * { choices: [{ message: { content: "<model JSON>" } }] }.
 */
function extractContent(envelope: unknown): string {
  if (isRecord(envelope)) {
    const choices = envelope["choices"];
    if (Array.isArray(choices) && choices.length > 0 && isRecord(choices[0])) {
      const message = (choices[0] as Record<string, unknown>)["message"];
      if (isRecord(message) && typeof message["content"] === "string") {
        return message["content"];
      }
    }
  }
  throw new AiError("LLM returned an unexpected response envelope");
}

/**
 * Models sometimes wrap the JSON in markdown code fences despite being asked
 * not to (or when response_format is not honored). Strip them defensively.
 */
function extractJson(text: string): string {
  const t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) return fence[1].trim();
  return t;
}
