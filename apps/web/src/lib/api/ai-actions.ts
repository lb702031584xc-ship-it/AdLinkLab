"use server";

/**
 * AI analysis server actions: thin wrappers returning {ok, data} | {ok:false, error}.
 * Never logs API keys or tokens.
 */
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";
import {
  AiApiError,
  analyzeOffer,
  analyzeProfit,
  analyzeTerms,
  checkUrls,
  getAiSettings,
  getAnalysis,
  listAnalyses,
  listOfferCaptures,
  getOfferCapture,
  checkBrandBidding,
  parseKeywordCapture,
  saveAiSettings,
  screenOffers,
  type AiAnalysis,
  type AiAnalysisSummary,
  type AiScreenItemInput,
  type AiScreenResponse,
  type AiSettings,
  type AiTermsResult,
  type BrandBiddingResult,
  type ParsedKeywordData,
  type OfferCaptureDetail,
  type OfferCaptureItem,
  type AiUrlCheckResponse,
  type AnalyzeInput,
  type SaveSettingsInput,
  type TrafficPlanInput,
  type TrafficPlanResult,
  type RecommendedKeyword,
  analyzeTrafficPlan,
  recommendKeywords,
  testAiConnection,
  type AiConnectionTestResult,
  generateBlueprint,
  type BlueprintInput,
  type BlueprintResult,
  fetchOfferMeta,
  type OfferMetaResult,
} from "./ai";
import type {
  ProfitAnalysisInput,
  ProfitAnalysisResult,
} from "./profit-types";

export type AiActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export async function analyzeOfferAction(
  input: Omit<AnalyzeInput, "language">
): Promise<AiActionResult<AiAnalysis>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    const data = await analyzeOffer({ ...input, language: lang });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof AiApiError && e.code === "AI_NOT_CONFIGURED") {
      return {
        ok: false,
        error: t.ai.analyze.form.notConfigured,
        code: "AI_NOT_CONFIGURED",
      };
    }
    return {
      ok: false,
      error:
        e instanceof Error && e.message
          ? e.message
          : t.ai.analyze.form.failed,
    };
  }
}

export async function listAnalysesAction(): Promise<
  AiActionResult<AiAnalysisSummary[]>
> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    return { ok: true, data: await listAnalyses() };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.message
          ? e.message
          : t.ai.analyze.form.failed,
    };
  }
}

export async function getAnalysisAction(
  id: string
): Promise<AiActionResult<AiAnalysis>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    return { ok: true, data: await getAnalysis(id) };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.message
          ? e.message
          : t.ai.detail.loadError,
    };
  }
}

export async function getAiSettingsAction(): Promise<
  AiActionResult<AiSettings>
> {
  try {
    return { ok: true, data: await getAiSettings() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "failed",
    };
  }
}

export async function saveAiSettingsAction(
  input: SaveSettingsInput
): Promise<AiActionResult<{ ok: boolean; configured: boolean }>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    return { ok: true, data: await saveAiSettings(input) };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.message
          ? e.message
          : t.ai.admin.settings.saveFailed,
    };
  }
}

/** 测试 LLM 连接（可用当前表单值测试保存前的新配置）。 */
export async function testAiConnectionAction(input: {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}): Promise<AiActionResult<AiConnectionTestResult>> {
  try {
    return { ok: true, data: await testAiConnection(input) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.message ? e.message : "测试失败",
    };
  }
}

function mapAiActionError(
  e: unknown,
  t: ReturnType<typeof getDictionary>,
  fallback: string
): { ok: false; error: string; code?: string } {
  if (e instanceof AiApiError && e.code === "AI_NOT_CONFIGURED") {
    return {
      ok: false,
      error: t.ai.analyze.form.notConfigured,
      code: "AI_NOT_CONFIGURED",
    };
  }
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : fallback,
  };
}

export async function analyzeTermsAction(
  text: string
): Promise<AiActionResult<AiTermsResult>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    const data = await analyzeTerms(text, lang);
    return { ok: true, data };
  } catch (e) {
    return mapAiActionError(e, t, t.ai.terms.failed);
  }
}

export async function screenOffersAction(
  items: AiScreenItemInput[]
): Promise<AiActionResult<AiScreenResponse>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    const data = await screenOffers(items, lang);
    return { ok: true, data };
  } catch (e) {
    return mapAiActionError(e, t, t.ai.terms.failed);
  }
}

export async function checkUrlsAction(
  urls: string[],
  ownedDomains?: string[]
): Promise<AiActionResult<AiUrlCheckResponse>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    const data = await checkUrls(urls, ownedDomains);
    return { ok: true, data };
  } catch (e) {
    return mapAiActionError(e, t, t.ai.compliance.failed);
  }
}

export async function analyzeProfitAction(
  input: ProfitAnalysisInput
): Promise<AiActionResult<{ analysis: ProfitAnalysisResult }>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    const data = await analyzeProfit(input);
    return { ok: true, data };
  } catch (e) {
    return mapAiActionError(e, t, lang === "zh" ? "盈利测算失败，请稍后重试。" : "Profit analysis failed, please try again.");
  }
}

export async function analyzeTrafficPlanAction(
  input: Omit<TrafficPlanInput, "language">
): Promise<AiActionResult<TrafficPlanResult>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    const data = await analyzeTrafficPlan({
      ...input,
      language: lang,
    });
    return { ok: true, data };
  } catch (e) {
    return mapAiActionError(
      e,
      t,
      lang === "zh" ? "投流分析失败，请稍后重试。" : "Traffic plan analysis failed, please try again."
    );
  }
}

export async function recommendKeywordsAction(
  product: string,
  count = 10
): Promise<AiActionResult<{ product: string; keywords: RecommendedKeyword[] }>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    const data = await recommendKeywords(product, count, lang);
    return { ok: true, data };
  } catch (e) {
    return mapAiActionError(
      e,
      t,
      lang === "zh" ? "AI 推荐关键词失败，请稍后重试。" : "Keyword recommendation failed, please try again."
    );
  }
}

/** Offer 一键推演报告：一次生成 7 节（约 1~2 分钟）。 */
export async function generateBlueprintAction(
  input: Omit<BlueprintInput, never>
): Promise<AiActionResult<{ blueprint: BlueprintResult }>> {
  const lang = await getLang();
  try {
    const data = await generateBlueprint(input, lang);
    return { ok: true, data };
  } catch (e) {
    return mapAiActionError(
      e,
      getDictionary(lang),
      lang === "zh" ? "推演报告生成失败，请稍后重试。" : "Blueprint generation failed, please try again."
    );
  }
}

/** 抓取 offer 页面元信息（标题/描述/价格），用于推演报告表单预填。 */
export async function fetchOfferMetaAction(
  url: string
): Promise<AiActionResult<OfferMetaResult>> {
  const lang = await getLang();
  try {
    const data = await fetchOfferMeta(url);
    return { ok: true, data };
  } catch (e) {
    return mapAiActionError(
      e,
      getDictionary(lang),
      lang === "zh" ? "页面抓取失败，该站可能屏蔽了服务器抓取，请手动填写。" : "Page fetch failed; the site may block server-side fetching. Fill in manually."
    );
  }
}

/** 截图 OCR 兜底：offer 页抓不到时上传截图识别（multipart）。 */
export async function fetchOfferOcrAction(
  formData: FormData
): Promise<AiActionResult<OfferMetaResult>> {
  const lang = await getLang();
  const file = formData.get("screenshot");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: lang === "zh" ? "请先选择一张截图。" : "Please choose a screenshot first." };
  }
  if (file.size > 8 * 1024 * 1024) {
    return { ok: false, error: lang === "zh" ? "图片超过 8MB 上限。" : "Image exceeds the 8MB limit." };
  }
  const out = new FormData();
  out.append("screenshot", file, file.name || "screenshot.png");
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/v1/ai/offer-ocr`, {
      method: "POST",
      headers: { ...(await sessionHeaders()) },
      body: out,
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: lang === "zh" ? "网络请求失败，请稍后重试。" : "Network request failed, please try again." };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = lang === "zh" ? `截图识别失败（${res.status}）` : `OCR failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch { /* ignore */ }
    return { ok: false, error: message };
  }
  return { ok: true, data: (await res.json()) as OfferMetaResult };
}

/** 浏览器插件抓取记录（最近 10 条）。 */
export async function listOfferCapturesAction(): Promise<
  AiActionResult<OfferCaptureItem[]>
> {
  try {
    return { ok: true, data: await listOfferCaptures() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof AiApiError ? e.message : "加载抓取记录失败",
    };
  }
}

/** 单条抓取记录详情（含 HTML）。 */
export async function getOfferCaptureAction(
  id: string
): Promise<AiActionResult<OfferCaptureDetail>> {
  try {
    return { ok: true, data: await getOfferCapture(id) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof AiApiError ? e.message : "加载抓取记录失败",
    };
  }
}

/** 品牌词投流检查：谁在投这个品牌词（官方 vs 非官方）+ 评估。 */
export async function checkBrandBiddingAction(
  brandKeyword: string,
  officialDomain: string
): Promise<AiActionResult<BrandBiddingResult>> {
  try {
    return { ok: true, data: await checkBrandBidding(brandKeyword, officialDomain) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof AiApiError ? e.message : "品牌词检查失败",
    };
  }
}

/** 解析插件抓到的 SEMrush / Planner 页面 → 关键词表一行。 */
export async function parseKeywordCaptureAction(
  captureId: string
): Promise<AiActionResult<ParsedKeywordData>> {
  try {
    return { ok: true, data: await parseKeywordCapture(captureId) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof AiApiError ? e.message : "解析抓取失败",
    };
  }
}
