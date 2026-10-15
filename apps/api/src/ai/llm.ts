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
 * Returns the parsed JSON body. Throws AiError (safe messages only) on
 * network failure, non-2xx status, or invalid JSON.
 */
async function postChatCompletions(
  args: ChatJsonArgs,
  userContent: unknown,
): Promise<unknown> {
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
  const content = extractContent(envelope);
  const jsonText = extractJson(content);
  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    // 模型返回了非 JSON 内容（空串/截断/纯文本拒绝）：原生 SyntaxError 不是
    // AiError，会被调用方吞成裸 "LLM request failed"，这里转成带内容片段的 AiError
    const snippet = jsonText.slice(0, 200).replace(/\s+/g, " ");
    throw new AiError(`LLM returned invalid JSON${snippet ? `: ${snippet}` : ""}`);
  }
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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
