/**
 * 长尾流水线（DataForSEO 实测扩词）标记与筛选口径（纯函数，无副作用）：
 * - 已购用户风险 / 型号特征两类启发式标记（确定性规则，是"特征"不是事实）
 * - 本地筛选 outcome 分类：pass / out-volume / out-competition / out-intent
 *   ——筛选只做标记不删词，被过滤的词可展开、可人工勾选保留
 * - 型号词稳定前置、勾选跨筛选/重扩保留等列表口径
 */
import type { DfsCandidate } from "@/lib/api/keyword-dataforseo-actions";

export type CompetitionMode = "lowPlusMedium" | "lowOnly" | "all";

export type FilterOutcome =
  | "pass"
  | "out-volume"
  | "out-competition"
  | "out-intent";

/** 按非字母数字切分 token（统一小写）。 */
export function tokensOf(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const OWNED_RISK_TOKENS = new Set([
  "app",
  "login",
  "support",
  "manual",
  "setup",
  "connect",
  "download",
  "fix",
  "pair",
  "pairing",
  "troubleshoot",
  "troubleshooting",
]);

const OWNED_RISK_PHRASES: ReadonlyArray<readonly [string, string]> = [
  ["sign", "in"],
  ["customer", "service"],
  ["how", "to"],
  ["set", "up"],
];

/**
 * 已购用户风险：命中 app / 登录 / 支持 / 说明书类词——搜的人多半已经买了
 * 产品、在找 App 或售后，不是买家。整 token 或固定短语比对，
 * 避免 "apple" 误伤 "app"、"application" 误伤 "app"。
 */
export function isOwnedUserRisk(keyword: string): boolean {
  const tokens = tokensOf(keyword);
  if (tokens.some((tk) => OWNED_RISK_TOKENS.has(tk))) return true;
  for (let i = 0; i + 1 < tokens.length; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (OWNED_RISK_PHRASES.some(([x, y]) => x === a && y === b)) return true;
  }
  return false;
}

/**
 * 型号特征（启发式）：任一 token 含相邻的字母+数字（如 s8、q7、x40、s8pro）。
 * 纯数字（如年份 2024）不算。
 */
export function hasModelToken(keyword: string): boolean {
  return tokensOf(keyword).some((tk) => /[a-z]\d|\d[a-z]/.test(tk));
}

/** 竞争等级：优先响应原文 competition_level，缺失时按 0–1 数值分档；未知 → null（不拦）。 */
export function competitionLevelOf(
  c: DfsCandidate
): "LOW" | "MEDIUM" | "HIGH" | null {
  const raw = c.competitionLevel?.toUpperCase();
  if (raw === "LOW" || raw === "MEDIUM" || raw === "HIGH") return raw;
  if (c.competition === null) return null;
  if (c.competition <= 0.33) return "LOW";
  if (c.competition <= 0.66) return "MEDIUM";
  return "HIGH";
}

export function passesCompetition(
  c: DfsCandidate,
  mode: CompetitionMode
): boolean {
  if (mode === "all") return true;
  const level = competitionLevelOf(c);
  if (level === null) return true; // 未知不误杀
  if (mode === "lowOnly") return level === "LOW";
  return level === "LOW" || level === "MEDIUM";
}

export function passesVolume(c: DfsCandidate, minVolume: number): boolean {
  if (minVolume <= 0) return true;
  if (c.searchVolume === null) return true; // 未知不误杀
  return c.searchVolume >= minVolume;
}

/**
 * 本地筛选分类（不花钱的一轮）：第一道不过就定 outcome——先量后竞争，
 * 与步骤条「本地过滤后 {a} 条」口径一致（out-intent 仍计入本地幸存）。
 */
export function classifyLocalOutcomes(
  candidates: readonly DfsCandidate[],
  opts: { minVolume: number; competitionMode: CompetitionMode }
): Map<string, FilterOutcome> {
  const map = new Map<string, FilterOutcome>();
  for (const c of candidates) {
    const key = c.keyword.toLowerCase();
    if (!passesVolume(c, opts.minVolume)) map.set(key, "out-volume");
    else if (!passesCompetition(c, opts.competitionMode))
      map.set(key, "out-competition");
    else map.set(key, "pass");
  }
  return map;
}

/**
 * 意图过滤结果并入 outcome：只动当前 pass 的行；意图明确非 commercial /
 * transactional → out-intent；意图未知（null 或结果缺失）保持 pass 并标记
 * 未验证（fail-soft，不丢词）。返回新 Map，不改入参。
 */
export function applyIntentOutcomes(
  outcomes: ReadonlyMap<string, FilterOutcome>,
  intents: ReadonlyMap<string, string | null>
): { outcomes: Map<string, FilterOutcome>; hasUnverified: boolean } {
  const next = new Map(outcomes);
  let hasUnverified = false;
  for (const [key, outcome] of next) {
    if (outcome !== "pass") continue;
    const intent = intents.get(key) ?? null;
    if (intent === null) {
      hasUnverified = true;
      continue;
    }
    if (intent !== "commercial" && intent !== "transactional")
      next.set(key, "out-intent");
  }
  return { outcomes: next, hasUnverified };
}

/** 本地幸存数（pass + out-intent）——意图过滤实际处理的规模。 */
export function countLocalSurvivors(
  outcomes: ReadonlyMap<string, FilterOutcome>
): number {
  let n = 0;
  for (const o of outcomes.values())
    if (o === "pass" || o === "out-intent") n++;
  return n;
}

export function countOutcome(
  outcomes: ReadonlyMap<string, FilterOutcome>,
  target: FilterOutcome
): number {
  let n = 0;
  for (const o of outcomes.values()) if (o === target) n++;
  return n;
}

/** 含型号特征的行稳定前置（组内保持原序）。 */
export function modelFirstStable<T extends { keyword: string }>(
  rows: readonly T[]
): T[] {
  const withModel: T[] = [];
  const rest: T[] = [];
  for (const r of rows)
    (hasModelToken(r.keyword) ? withModel : rest).push(r);
  return [...withModel, ...rest];
}

/** 勾选保留：只留下仍在候选集内的词（小写键交集）。 */
export function keepSelectionWithin(
  prev: ReadonlySet<string>,
  keywords: readonly string[]
): Set<string> {
  const alive = new Set(keywords.map((k) => k.toLowerCase()));
  const next = new Set<string>();
  for (const k of prev) if (alive.has(k)) next.add(k);
  return next;
}
