"use server";

/**
 * P1-10：规则生成关键词 server action（转发到 API，无 LLM，无假搜索量）。
 */
import { sessionHeaders } from "./session";
import { getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { getLang } from "@/i18n/lang";

export interface RuleKeywordIdea {
  keyword: string;
  kind: "brand-suffix" | "seed-combo" | "token-suffix";
  ruleScore: number;
  source: "rule-generated";
  brandCoverage: number | null;
  brandCoverageWarn: boolean;
  avgMonthlySearches: null;
  competition: null;
}

export async function generateKeywordIdeasAction(input: {
  seeds: string[];
  brandTerms?: string[];
  domain?: string;
}): Promise<{ ok: true; data: { ideas: RuleKeywordIdea[]; count: number } } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/v1/keywords/ideas`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await sessionHeaders()) },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `Request failed: ${res.status}`);
    return { ok: true, data: JSON.parse(text) as { ideas: RuleKeywordIdea[]; count: number } };
  } catch (e) {
    return { ok: false, error: mapEntityErrorMessage(e, await getLang()) };
  }
}
