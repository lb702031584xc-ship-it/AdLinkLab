/**
 * 商品库同步 — 登录态(session)采集可复用基类。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ToS 风险提示（所有 session 模式子类同样适用，各子类文件头部重复声明）：
 * 使用登录态（Cookie）自动采集商品数据，可能违反目标站点服务条款中关于
 * 自动化访问的条款，存在账号被警告、限流或封禁的风险。请仅采集用户自己
 * 账号可见的公开商品列表，不要高频抓取；如该联盟提供官方商品 API，请优先
 * 切换为官方 API 模式。用户在切换到 session 模式时必须显式确认已知悉该风险。
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 合规边界（硬）：
 * - 只读采集：仅 GET 商品列表页/接口，绝不提交表单、不模拟点击购买、不绕过反爬。
 * - 固定 UA `AdLinkLab-SessionSync/1.0`；无代理池、无 UA/指纹轮换（硬禁能力不实现）。
 * - 自带页间延迟（默认 3s，第一页前不延迟）；429 直接降级，不重试、不退避重试。
 * - Cookie 只放在 `Cookie` 请求头；绝不打日志、绝不进审计 detail、绝不返回给前端。
 * - 每个子类必须如实标注其解析模板是否经真实账号验证（TemplateSessionAdapter.listTemplate.verified）。
 */
import { lookup } from "node:dns/promises";
import { isBlockedIp } from "../ai/fetch-page.js";
import type { NetworkOffer } from "./types.js";

/** NetworkOffer + 商品库字段。 */
export interface SessionProduct extends NetworkOffer {
  brand?: string | null;
  asin?: string | null;
  price?: number | null;
  /** 固定佣金金额（与 payout 语义一致：金额用 commissionAmount，百分比用 commissionRate）。 */
  commissionAmount?: number | null;
  /** 佣金率百分比，如 12 表示 12%。 */
  commissionRate?: number | null;
  reviewCount?: number | null;
  promoUrl?: string | null;
}

/** 401/403 或被重定向到登录页 → 登录态失效。 */
export class SessionExpiredError extends Error {
  readonly code = "SESSION_EXPIRED";
  /**
   * 账号受限标记：HTTP 403（明确账号受限/权限回收）时为 true → 同步服务直接进黑名单；
   * 401/登录页重定向为 false → 计 strike，连续 3 次才进黑名单。
   */
  readonly restricted: boolean;
  constructor(message = "Session expired", restricted = false) {
    super(message);
    this.name = "SessionExpiredError";
    this.restricted = restricted;
  }
}

/** 429 → 直接降级，不重试。 */
export class SessionRateLimitedError extends Error {
  readonly code = "SESSION_RATE_LIMITED";
  constructor(message = "Session rate limited") {
    super(message);
    this.name = "SessionRateLimitedError";
  }
}

/**
 * 脚手架适配器的解析模板尚未经真实账号验证，且实际响应与模板对不上时抛出。
 * 同步服务捕获后记 sessionStatus=FAILED + 审计，提示用户按文档用真实账号验证微调。
 */
export class SessionTemplateError extends Error {
  readonly code = "SESSION_TEMPLATE_UNVERIFIED";
  constructor(message: string) {
    super(message);
    this.name = "SessionTemplateError";
  }
}

/** 已验证模板的解析失败（结构漂移/页面改版）。 */
export class SessionParseError extends Error {
  readonly code = "SESSION_PARSE_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "SessionParseError";
  }
}

/** session 请求的其它 HTTP/网络错误。 */
export class SessionHttpError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "SessionHttpError";
    this.code = code;
    this.status = status;
  }
}

/** SSRF 守卫：session 采集的 baseUrl 必须是公网 https，禁止内网/回环。 */
export async function assertSessionUrlSafe(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SessionHttpError("INVALID_URL", "Session base URL 不是合法的 URL");
  }
  if (parsed.protocol !== "https:") {
    throw new SessionHttpError("INVALID_URL", "Session base URL 必须是 https");
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(parsed.hostname, { all: true });
  } catch {
    throw new SessionHttpError("DNS_FAILED", "DNS 解析失败");
  }
  for (const a of addresses) {
    if (isBlockedIp(a.address)) {
      throw new SessionHttpError("BLOCKED_TARGET", "目标 IP 被禁止（内网/回环）");
    }
  }
}

export interface SessionPageInput {
  /** 解密后的 Cookie（只进 Cookie 请求头，绝不打日志）。 */
  cookie: string;
  baseUrl: string;
  page: number;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  /** 可配置的商品列表路径（网络设置可覆盖；子类提供默认值）。 */
  sessionListPath?: string;
}

export interface SessionPageResult {
  products: SessionProduct[];
  hasMore: boolean;
}

export interface PullViaSessionInput {
  cookie: string;
  baseUrl?: string;
  /** 默认 10，上限 50。 */
  maxPages?: number;
  /** 页间延迟 ms，默认 3000；第一页前不延迟。 */
  pageDelayMs?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  ssrfCheck?: (url: string) => Promise<void>;
  sessionListPath?: string;
}

const SESSION_SYNC_UA = "AdLinkLab-SessionSync/1.0";
const LOGIN_PATH_RE = /\/login|\/signin|log-in|sign-in|auth\/login/i;

/**
 * 登录态采集基类：子类只需实现 fetchSessionPage（各家差异部分）。
 * 通用能力：SSRF 检查、分页循环、页间延迟、401/403/登录页重定向→SessionExpiredError、
 * 429→SessionRateLimitedError（不重试，直接降级）。
 */
export abstract class BaseSessionAdapter {
  abstract readonly sessionKind: string;
  abstract readonly sessionDisplayName: string;
  abstract readonly defaultSessionBaseUrl: string;

  protected abstract fetchSessionPage(
    input: SessionPageInput
  ): Promise<SessionPageResult>;

  /**
   * 带守卫的 session GET：Cookie 只放请求头；统一做过期/限流判定。
   * 子类实现 fetchSessionPage 时必须经由本方法发请求（不得自建 fetch 直调）。
   */
  protected async sessionFetch(
    input: Pick<SessionPageInput, "cookie" | "fetchImpl" | "timeoutMs">,
    url: string,
    init?: RequestInit
  ): Promise<Response> {
    let res: Response;
    try {
      res = await input.fetchImpl(url, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          // Cookie 只放在请求头；此处绝不记录 cookie 内容。
          Cookie: input.cookie,
          "User-Agent": SESSION_SYNC_UA,
        },
        signal: AbortSignal.timeout(input.timeoutMs),
      });
    } catch (error) {
      throw new SessionHttpError(
        "NETWORK_ERROR",
        `${this.sessionDisplayName} session 请求失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (res.status === 401 || res.status === 403) {
      // 401 = 登录态过期（计 strike）；403 = 明确账号受限/权限回收（restricted=true，直接进黑名单）。
      throw new SessionExpiredError(
        res.status === 403
          ? `${this.sessionDisplayName} 账号受限（HTTP 403）：可能是账号被禁用或权限被回收，请检查账号状态`
          : `${this.sessionDisplayName} 登录态已失效（HTTP 401），请在商品库设置页重新保存 Cookie`,
        res.status === 403
      );
    }
    if (res.status === 429) {
      // 合规：触发对方限流 → 直接降级，不重试、不退避重试。
      throw new SessionRateLimitedError(
        `${this.sessionDisplayName} 触发对方限流（HTTP 429）：已按合规要求直接降级停止，未做任何重试`
      );
    }
    const finalUrl = typeof res.url === "string" ? res.url : "";
    if (finalUrl && LOGIN_PATH_RE.test(finalUrl)) {
      throw new SessionExpiredError(
        `${this.sessionDisplayName} 登录态已失效（被重定向到登录页），请重新保存 Cookie`
      );
    }
    if (!res.ok) {
      throw new SessionHttpError(
        "HTTP_ERROR",
        `${this.sessionDisplayName} session 请求失败：HTTP ${res.status}`,
        res.status
      );
    }
    return res;
  }

  async pullViaSession(input: PullViaSessionInput): Promise<SessionProduct[]> {
    const cookie = input.cookie?.trim();
    if (!cookie) {
      throw new SessionExpiredError("Session Cookie 为空，请先保存登录态");
    }
    const baseUrl = (input.baseUrl || this.defaultSessionBaseUrl).replace(
      /\/+$/,
      ""
    );
    const ssrfCheck = input.ssrfCheck ?? assertSessionUrlSafe;
    await ssrfCheck(baseUrl);

    const fetchImpl = input.fetchImpl ?? fetch;
    const timeoutMs = input.timeoutMs ?? 15_000;
    const maxPages = Math.max(1, Math.min(50, input.maxPages ?? 10));
    const pageDelayMs = Math.max(0, input.pageDelayMs ?? 3000);

    const out: SessionProduct[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore && page <= maxPages) {
      // 第一页前不延迟；之后每页间隔 pageDelayMs（合规：不高频抓取）。
      if (page > 1 && pageDelayMs > 0) {
        await new Promise((r) => setTimeout(r, pageDelayMs));
      }
      const result = await this.fetchSessionPage({
        cookie,
        baseUrl,
        page,
        fetchImpl,
        timeoutMs,
        sessionListPath: input.sessionListPath,
      });
      out.push(...result.products);
      hasMore = result.hasMore && result.products.length > 0;
      page += 1;
    }
    return out;
  }
}

/* ── 可配置解析模板（脚手架适配器共用） ─────────────────────────── */

/**
 * 解析模板声明。现实约束：我们没有这些联盟 publisher 后台的真实页面结构可验证
 * （没登录过），模板按各联盟公开的 publisher 门户常识写成可配置的端点/字段模板，
 * verified=false 即"脚手架：待真实账号验证"。猜测绝不硬编码成已验证。
 */
export interface SessionListTemplate {
  /** 是否已用真实账号验证。false → 结构对不上时抛 SESSION_TEMPLATE_UNVERIFIED 明错。 */
  verified: boolean;
  /** JSON 响应中商品列表的候选点路径（按优先级试），如 ["data.list", "data.items"]。 */
  jsonListPaths: string[];
  /** JSON 响应中 has_more 标志的候选路径。 */
  jsonHasMorePaths: string[];
  /** 对真实页面/接口的文字描述（基于公开常识，未验证）。 */
  description: string;
}

function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function firstArrayAtPaths(obj: unknown, paths: string[]): unknown[] | null {
  for (const p of paths) {
    const v = readPath(obj, p);
    if (Array.isArray(v)) return v;
  }
  return null;
}

function asString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 字段映射用的防御式取值：按候选键名依次尝试。 */
export function pickField(
  item: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const k of keys) {
    const v = item[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/**
 * 在候选键里优先挑"纯数字"值（商品主键用，如 PB product_id 62837599）。
 * 第一个候选是哈希串（如某些后台的 uuid id）时会跳过，继续找数字值；
 * 全都不是数字 → 回退 pickField 的第一个非空值。
 */
export function pickNumericField(
  item: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const k of keys) {
    const v = item[k];
    if (v === undefined || v === null || v === "") continue;
    const s = String(v).trim();
    if (/^\d+$/.test(s)) return v;
  }
  return pickField(item, ...keys);
}

export { asNumber as sessionAsNumber, asString as sessionAsString };

/**
 * 模板型 session 适配器：baseUrl + listPath 可配；JSON 按候选路径防御式解析；
 * HTML 只做最小表格提取。verified=false 的脚手架在结构对不上时抛明确错误
 * （SESSION_TEMPLATE_UNVERIFIED），由同步服务统一降级为 FAILED + 审计。
 */
export abstract class TemplateSessionAdapter extends BaseSessionAdapter {
  /** 默认列表路径模板（未验证；用户可在网络设置里覆盖）。 */
  protected abstract readonly defaultSessionListPath: string;
  protected abstract readonly listTemplate: SessionListTemplate;
  /** 防御式字段映射：未知字段名变体都尝试，缺失 → null。 */
  protected abstract mapSessionItem(
    item: Record<string, unknown>
  ): SessionProduct;

  protected async fetchSessionPage(
    input: SessionPageInput
  ): Promise<SessionPageResult> {
    const rawPath = (input.sessionListPath ?? this.defaultSessionListPath).trim();
    const path = rawPath || this.defaultSessionListPath;
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const sep = normalized.includes("?") ? "&" : "?";
    // 页码参数名是模板假设（常见为 page），需真实账号验证后微调。
    const url = `${input.baseUrl}${normalized}${sep}page=${input.page}`;
    const res = await this.sessionFetch(input, url, {
      method: "GET",
      headers: { Accept: "application/json, text/html;q=0.9" },
    });
    const text = await res.text();
    const tpl = this.listTemplate;

    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (json !== null && typeof json === "object") {
      const list = firstArrayAtPaths(json, tpl.jsonListPaths);
      if (list) {
        const products = list.map((it) =>
          this.mapSessionItem(
            (it !== null && typeof it === "object"
              ? it
              : {}) as Record<string, unknown>
          )
        );
        const hasMore = tpl.jsonHasMorePaths.some(
          (p) => readPath(json, p) === true
        );
        return { products, hasMore };
      }
      this.throwTemplateMismatch("JSON");
    }

    // HTML 回退：最小提取（只认 <table> 行；注释说明：真实后台多为 JS 渲染表格，
    // 该回退大概率抓不到，属尽力而为，绝不伪造数据）。
    const tableProducts = extractHtmlTableProducts(text);
    if (tableProducts.length > 0) {
      return { products: tableProducts, hasMore: false };
    }
    this.throwTemplateMismatch("HTML");
  }

  private throwTemplateMismatch(kind: "JSON" | "HTML"): never {
    const tpl = this.listTemplate;
    if (!tpl.verified) {
      throw new SessionTemplateError(
        `${this.sessionDisplayName} session 解析模板尚未经真实账号验证` +
          `（收到 ${kind}，期望列表路径候选：${tpl.jsonListPaths.join(" / ")})。` +
          `请用真实账号按 docs/catalog-session-mode.md 指引确认后台商品列表接口后，` +
          `微调 ${this.sessionKind}-session-adapter.ts 的 defaultSessionListPath 与字段映射。`
      );
    }
    throw new SessionParseError(
      `${this.sessionDisplayName} session 页面解析失败（${kind} 结构与已验证模板不匹配），` +
        `可能是后台改版或登录态异常，请检查网络设置。`
    );
  }
}

/**
 * HTML 表格最小提取：每行取前几个 <td> 文本 → 仅 name 可用，其余字段 null。
 * 明确不是"已验证解析"：真实后台多为 JS 渲染，该回退通常返回空并走模板错误。
 */
function extractHtmlTableProducts(html: string): SessionProduct[] {
  const out: SessionProduct[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let rowMatch: RegExpExecArray | null;
  let rows = 0;
  while ((rowMatch = rowRe.exec(html)) !== null && rows < 200) {
    rows += 1;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null && cells.length < 8) {
      const text = cellMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text) cells.push(text);
    }
    if (cells.length >= 2 && !/^name|product|商品/i.test(cells[0])) {
      out.push({
        externalId: `html-row-${rows}`,
        name: cells[0].slice(0, 200),
        rawData: { cells },
      });
    }
  }
  return out;
}
