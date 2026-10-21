"use client";

/**
 * DataForSEO 实测长尾流水线（/keywords/starter 研究 Tab）：
 * ① 扩词（Labs Related Keywords 实测）→ ② 多轮筛选（本地量/竞争过滤 +
 *    幸存词意图过滤）→ ③ 人工勾选 → ④ 广告测算（估算 CPC/页首出价，仅展示）
 *    → ⑤ 导入投放（复用既有 research→launch 导入路径）。
 * 每步都显示数字状态：已扩 X 条 / 通过 Y 条（被过滤 K 条）/ 已勾 Z 条。
 * 筛选是标记不是删除：全量候选常驻，被过滤的词折叠可展开、可人工勾选
 * 保留；改参数重跑筛选、或重跑扩词（缓存命中同一批），都不清空已有勾选。
 * 测算结果硬隔离：不写入任何出价字段，出价唯一来源是投流页盈利测算。
 */
import { useEffect, useMemo, useState } from "react";
import {
  adMeasureAction,
  expandKeywordsAction,
  intentFilterAction,
  type DfsCandidate,
  type DfsMeasureResult,
} from "@/lib/api/keyword-dataforseo-actions";
import {
  DFS_LANGUAGES,
  DFS_LOCATIONS,
} from "@/lib/keywords/dataforseo-locations";
import type { KeywordStarterDict } from "@/i18n/dict/keyword-starter";
import { PaidDataBillingNote } from "@/components/paid-data/billing-note";
import {
  applyIntentOutcomes,
  classifyLocalOutcomes,
  competitionLevelOf,
  countLocalSurvivors,
  countOutcome,
  hasModelToken,
  isOwnedUserRisk,
  keepSelectionWithin,
  modelFirstStable,
  type CompetitionMode,
  type FilterOutcome,
} from "./keyword-marks";

/** 候选行 = 扩词候选 + 意图过滤后附加的意图标签。 */
interface PipelineCandidate extends DfsCandidate {
  intent: string | null;
}

function parseBoundedInt(
  raw: string,
  def: number,
  min: number,
  max: number
): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function fmtNum(v: number | null): string {
  return v === null ? "—" : v.toLocaleString("en-US");
}

function fmtMoney(v: number | null): string {
  return v === null ? "—" : `$${v.toFixed(2)}`;
}

export function LongtailPipelineClient({
  dict: d,
  lang,
  seedFromOffer,
  onImportToLaunch,
}: {
  dict: KeywordStarterDict;
  lang: "zh" | "en";
  /** 当前 Offer 名（页面上方选择器），作为种子词默认值带入 */
  seedFromOffer: string;
  /** ⑤ 导入投放：复用 Tab 外壳的 research→launch 导入信号 */
  onImportToLaunch: (words: string[]) => void;
}) {
  const t = d.dfs;
  const [seed, setSeed] = useState("");
  const [locationCode, setLocationCode] = useState(2840);
  const [language, setLanguage] = useState("auto");
  const [expandLimitRaw, setExpandLimitRaw] = useState("100");

  const [expanding, setExpanding] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<PipelineCandidate[] | null>(null);
  const [cached, setCached] = useState(false);

  const [minVolumeRaw, setMinVolumeRaw] = useState("100");
  const [compMode, setCompMode] = useState<CompetitionMode>("lowPlusMedium");
  const [intentOn, setIntentOn] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  /** 筛选标记：小写词 → outcome；null = 还没筛过。candidates 始终是全量。 */
  const [outcomes, setOutcomes] = useState<Map<string, FilterOutcome> | null>(
    null
  );
  const [intentUnverified, setIntentUnverified] = useState(false);
  const [showFiltered, setShowFiltered] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [measureLimitRaw, setMeasureLimitRaw] = useState("20");
  const [measuring, setMeasuring] = useState(false);
  const [measureError, setMeasureError] = useState<string | null>(null);
  const [measure, setMeasure] = useState<DfsMeasureResult | null>(null);

  // Offer 带入种子词（用户手动改过就不再覆盖）
  const [seedTouched, setSeedTouched] = useState(false);
  useEffect(() => {
    if (!seedTouched && seedFromOffer) setSeed(seedFromOffer);
  }, [seedFromOffer, seedTouched]);

  const location = useMemo(
    () => DFS_LOCATIONS.find((l) => l.locationCode === locationCode) ?? DFS_LOCATIONS[0],
    [locationCode]
  );
  const languageCode =
    language === "auto" ? location.defaultLanguage : language;

  const outcomeOf = (keyword: string): FilterOutcome | null =>
    outcomes ? (outcomes.get(keyword.toLowerCase()) ?? "pass") : null;

  const passCount = outcomes ? countOutcome(outcomes, "pass") : 0;
  const outCount =
    outcomes && candidates ? candidates.length - passCount : 0;
  const localSurvivorCount = outcomes ? countLocalSurvivors(outcomes) : 0;

  /** 展示序：pass 组与被过滤组各自内部，含型号特征的行稳定前置。 */
  const allRows = candidates ?? [];
  const passRows = outcomes
    ? allRows.filter((c) => outcomeOf(c.keyword) === "pass")
    : allRows;
  const outRows = outcomes
    ? allRows.filter((c) => outcomeOf(c.keyword) !== "pass")
    : [];
  const displayPass = modelFirstStable(passRows);
  const displayOut = modelFirstStable(outRows);

  /** 已勾选词（含人工保留的被过滤词），按候选原序。 */
  const pickedWords = useMemo(() => {
    if (!candidates) return [];
    return candidates
      .filter((c) => selected.has(c.keyword.toLowerCase()))
      .map((c) => c.keyword);
  }, [candidates, selected]);

  async function doExpand() {
    const s = seed.trim();
    if (s.length < 2 || expanding) return;
    setExpanding(true);
    setExpandError(null);
    try {
      const res = await expandKeywordsAction({
        seed: s,
        locationCode,
        languageCode,
        limit: parseBoundedInt(expandLimitRaw, 100, 10, 200),
      });
      if (!res.ok) {
        setExpandError(res.error);
        return;
      }
      const nextCandidates = res.data.candidates.map((c) => ({
        ...c,
        intent: null,
      }));
      setCandidates(nextCandidates);
      setCached(res.data.cached);
      // 换了一批候选：筛选标记与测算作废（口径对不上新批次）；
      // 但勾选只按"词还在不在新批次"保留，不整表清空。
      setOutcomes(null);
      setIntentUnverified(false);
      setShowFiltered(false);
      setSelected((prev) =>
        keepSelectionWithin(
          prev,
          nextCandidates.map((c) => c.keyword)
        )
      );
      setMeasure(null);
      setMeasureError(null);
    } finally {
      setExpanding(false);
    }
  }

  async function doFilter() {
    if (!candidates || filtering) return;
    setFiltering(true);
    setFilterError(null);
    try {
      const minVolume = parseBoundedInt(minVolumeRaw, 100, 0, 100_000_000);
      let next = classifyLocalOutcomes(candidates, {
        minVolume,
        competitionMode: compMode,
      });
      let unverified = false;
      // 先清上一轮的意图标签，避免旧标签挂在新口径的行上误导
      let nextCandidates: PipelineCandidate[] = candidates.map((c) => ({
        ...c,
        intent: null,
      }));
      const localKeys = new Set<string>();
      for (const [k, o] of next) if (o === "pass") localKeys.add(k);
      if (intentOn && localKeys.size > 0) {
        const res = await intentFilterAction({
          keywords: candidates
            .filter((c) => localKeys.has(c.keyword.toLowerCase()))
            .map((c) => c.keyword),
          locationCode,
          languageCode,
        });
        if (res.ok && res.data.verified) {
          const byKey = new Map(
            res.data.results.map((r) => [r.keyword.toLowerCase(), r.intent])
          );
          nextCandidates = nextCandidates.map((c) => {
            const k = c.keyword.toLowerCase();
            return localKeys.has(k)
              ? { ...c, intent: byKey.get(k) ?? null }
              : c;
          });
          const applied = applyIntentOutcomes(next, byKey);
          next = applied.outcomes;
          unverified = applied.hasUnverified;
        } else {
          // fail-soft：意图没验成，本地幸存词全部保留并标注未验证
          unverified = true;
          if (!res.ok) setFilterError(res.error);
        }
      }
      setCandidates(nextCandidates);
      setOutcomes(next);
      setIntentUnverified(unverified);
      // 不清勾选：改参数重跑筛选，已勾的词（含人工保留）继续算数；
      // 只有测算结果作废（口径变了，旧测算不能冒充新结论）。
      setMeasure(null);
      setMeasureError(null);
    } finally {
      setFiltering(false);
    }
  }

  async function doMeasure() {
    if (pickedWords.length === 0 || measuring) return;
    setMeasuring(true);
    setMeasureError(null);
    try {
      const res = await adMeasureAction({
        keywords: pickedWords,
        locationCode,
        languageCode,
        limit: parseBoundedInt(measureLimitRaw, 20, 5, 100),
      });
      if (!res.ok) {
        setMeasureError(res.error);
        return;
      }
      setMeasure(res.data);
    } finally {
      setMeasuring(false);
    }
  }

  function togglePick(keyword: string) {
    const key = keyword.toLowerCase();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** 全选通过词：疑似已购用户词排除（这类词勾了也是给已购用户烧钱）。 */
  function selectAllPass() {
    setSelected(
      new Set(
        passRows
          .filter((c) => !isOwnedUserRisk(c.keyword))
          .map((c) => c.keyword.toLowerCase())
      )
    );
  }

  const inputCls =
    "rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm outline-none focus:border-signal";
  const labelCls = "text-xs font-medium text-ink/60";
  const hintCls = "text-[11px] leading-snug text-ink/45";
  const badgeCls =
    "ml-1.5 inline-block rounded-full px-1.5 py-px align-middle text-[10px] font-medium";

  function renderRow(c: PipelineCandidate) {
    const level = competitionLevelOf(c);
    const key = c.keyword.toLowerCase();
    const outcome = outcomeOf(c.keyword);
    const isOut = outcome !== null && outcome !== "pass";
    const risk = isOwnedUserRisk(c.keyword);
    const model = hasModelToken(c.keyword);
    const kept = isOut && selected.has(key);
    return (
      <tr
        key={key}
        className={`border-b border-ink/5 ${isOut ? "opacity-55" : ""}`}
      >
        {outcomes && (
          <td className="py-1.5 pr-2">
            <input
              type="checkbox"
              checked={selected.has(key)}
              onChange={() => togglePick(c.keyword)}
              className="h-4 w-4 accent-[#2563eb]"
            />
          </td>
        )}
        <td className="py-1.5 pr-2 text-ink/85">
          {c.keyword}
          {isOut && (
            <span className={`${badgeCls} bg-ink/10 text-ink/60`}>
              {t.outcomeReasons[outcome as keyof typeof t.outcomeReasons]}
            </span>
          )}
          {risk && (
            <span className={`${badgeCls} bg-amber-100 text-amber-700`}>
              {t.ownedRiskBadge}
            </span>
          )}
          {model && (
            <span className={`${badgeCls} bg-sky-100 text-sky-700`}>
              {t.modelBadge}
            </span>
          )}
          {kept && (
            <span className={`${badgeCls} bg-emerald-100 text-emerald-700`}>
              {t.keptBadge}
            </span>
          )}
        </td>
        <td className="py-1.5 pr-2 text-ink/70">{fmtNum(c.searchVolume)}</td>
        <td className="py-1.5 pr-2 text-ink/70">{fmtMoney(c.cpc)}</td>
        <td className="py-1.5 pr-2 text-ink/70">
          {level ? t.competitionLevels[level] : "—"}
        </td>
        <td className="py-1.5 text-ink/70">
          {c.intent
            ? (t.intentLabels[c.intent as keyof typeof t.intentLabels] ??
              c.intent)
            : "—"}
        </td>
      </tr>
    );
  }

  return (
    <section className="mt-6 rounded-xl border border-ink/10 bg-white p-4">
      <h2 className="text-base font-bold text-ink">📡 {t.title}</h2>
      <p className="mt-1 text-sm text-ink/60">{t.subtitle}</p>
      <p className="mt-1">
        <PaidDataBillingNote feature="keywords-ad-measure" labels={t.billing} />
      </p>

      {/* 流程标注：先点什么、接着什么（每步带数字状态） */}
      <ol className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-5">
        {(["expand", "filter", "pick", "measure", "import"] as const).map(
          (step) => (
            <li
              key={step}
              className="rounded-lg bg-ink/[0.04] px-2.5 py-2 text-ink/75"
            >
              <span className="block">{t.steps[step]}</span>
              <span className="mt-0.5 block text-xs font-semibold text-signal">
                {step === "expand" &&
                  candidates &&
                  t.expandedLine.replace("{n}", String(candidates.length))}
                {step === "filter" &&
                  outcomes &&
                  candidates &&
                  t.filterLine
                    .replace("{x}", String(candidates.length))
                    .replace("{y}", String(passCount))
                    .replace("{k}", String(outCount))}
                {step === "pick" &&
                  outcomes &&
                  t.pickLine.replace("{n}", String(pickedWords.length))}
                {step === "measure" &&
                  measure &&
                  t.measuredLine
                    .replace("{x}", String(measure.requestedCount))
                    .replace("{y}", String(measure.total))}
              </span>
            </li>
          )
        )}
      </ol>

      {/* ① 扩词 */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-52 flex-1 flex-col gap-1">
          <span className={labelCls}>{t.seedLabel}</span>
          <input
            value={seed}
            onChange={(e) => {
              setSeed(e.target.value);
              setSeedTouched(true);
            }}
            placeholder={t.seedPlaceholder}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t.countryLabel}</span>
          <select
            value={locationCode}
            onChange={(e) => setLocationCode(Number(e.target.value))}
            className={inputCls}
          >
            {DFS_LOCATIONS.map((l) => (
              <option key={l.locationCode} value={l.locationCode}>
                {lang === "en" ? l.nameEn : l.nameZh}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t.languageLabel}</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className={inputCls}
          >
            <option value="auto">{t.langAuto}</option>
            {DFS_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-36 flex-col gap-1">
          <span className={labelCls}>{t.expandLimitLabel}</span>
          <input
            type="number"
            min={10}
            max={200}
            value={expandLimitRaw}
            onChange={(e) => setExpandLimitRaw(e.target.value)}
            className={inputCls}
          />
          <span className={hintCls}>{t.expandLimitHint}</span>
        </label>
        <button
          type="button"
          onClick={doExpand}
          disabled={expanding || seed.trim().length < 2}
          className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {expanding ? t.expanding : `🔍 ${t.expandBtn}`}
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-ink/45">
        {t.expandCacheNote}
      </p>
      {expandError && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {expandError}
        </p>
      )}
      {candidates && (
        <p className="mt-2 text-sm font-medium text-ink/70">
          {t.expandedLine.replace("{n}", String(candidates.length))}
          {cached && (
            <span className="ml-2 text-xs text-ink/45">（{t.cachedNote}）</span>
          )}
        </p>
      )}

      {/* ② 筛选 */}
      {candidates && (
        <div className="mt-4 rounded-xl border border-ink/10 bg-ink/[0.02] p-3">
          <p className="text-sm font-semibold text-ink">{t.filterTitle}</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="flex w-40 flex-col gap-1">
              <span className={labelCls}>{t.minVolumeLabel}</span>
              <input
                type="number"
                min={0}
                value={minVolumeRaw}
                onChange={(e) => setMinVolumeRaw(e.target.value)}
                className={inputCls}
              />
              <span className={hintCls}>{t.minVolumeHint}</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>{t.competitionLabel}</span>
              <select
                value={compMode}
                onChange={(e) => setCompMode(e.target.value as CompetitionMode)}
                className={inputCls}
              >
                {(["lowPlusMedium", "lowOnly", "all"] as const).map((m) => (
                  <option key={m} value={m}>
                    {t.competitionModes[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-ink/75">
              <input
                type="checkbox"
                checked={intentOn}
                onChange={(e) => setIntentOn(e.target.checked)}
                className="h-4 w-4 accent-[#2563eb]"
              />
              {t.intentToggle}
            </label>
            <button
              type="button"
              onClick={doFilter}
              disabled={filtering}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {filtering ? t.filtering : `🧹 ${t.filterBtn}`}
            </button>
          </div>
          {filterError && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {filterError}
            </p>
          )}
          {outcomes && candidates && (
            <p className="mt-2 text-sm font-medium text-ink/70">
              {t.filterLine
                .replace("{x}", String(candidates.length))
                .replace("{y}", String(passCount))
                .replace("{k}", String(outCount))}
              {intentOn && (
                <span className="ml-2 text-xs text-ink/50">
                  {t.filterStageLine
                    .replace("{a}", String(localSurvivorCount))
                    .replace("{b}", String(passCount))}
                </span>
              )}
            </p>
          )}
          {outcomes && intentUnverified && (
            <p className="mt-1 text-xs text-amber-600">⚠️ {t.intentUnverified}</p>
          )}
        </div>
      )}

      {/* 候选表：筛选前只读预览（含标记）；筛选后可勾选（第 ③ 步），
          被过滤的词折叠在开关下、展开后同样可勾选（人工保留） */}
      {candidates && candidates.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          {outcomes && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-ink">
                {t.pickLine.replace("{n}", String(pickedWords.length))}
              </span>
              <button
                type="button"
                onClick={selectAllPass}
                className="rounded-lg border border-ink/15 px-2.5 py-1 text-xs text-ink/70 hover:bg-ink/5"
              >
                {t.selectAll}
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="rounded-lg border border-ink/15 px-2.5 py-1 text-xs text-ink/70 hover:bg-ink/5"
              >
                {t.selectNone}
              </button>
              {outCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowFiltered((v) => !v)}
                  className="rounded-lg border border-ink/15 px-2.5 py-1 text-xs text-ink/70 hover:bg-ink/5"
                >
                  {showFiltered
                    ? t.hideFiltered
                    : t.showFiltered.replace("{k}", String(outCount))}
                </button>
              )}
            </div>
          )}
          {!outcomes && (
            <p className="mb-2 text-xs text-ink/45">{t.needFilterFirst}</p>
          )}
          <p className="mb-2 text-[11px] leading-snug text-ink/45">
            {t.marksNote}
          </p>
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-xs text-ink/50">
                {outcomes && <th className="py-1.5 pr-2 font-medium">✓</th>}
                <th className="py-1.5 pr-2 font-medium">{d.thKeyword}</th>
                <th className="py-1.5 pr-2 font-medium">{d.thVolume}</th>
                <th className="py-1.5 pr-2 font-medium">{t.thCpc}</th>
                <th className="py-1.5 pr-2 font-medium">{d.thCompetition}</th>
                <th className="py-1.5 font-medium">{d.thIntent}</th>
              </tr>
            </thead>
            <tbody>
              {displayPass.map((c) => renderRow(c))}
              {outcomes &&
                showFiltered &&
                displayOut.map((c) => renderRow(c))}
            </tbody>
          </table>
        </div>
      ) : (
        candidates && (
          <p className="mt-3 text-sm text-ink/50">{t.emptyCandidates}</p>
        )
      )}

      {/* ④ 广告测算（人工勾选门：未勾选禁用） */}
      {outcomes && (
        <div className="mt-4 rounded-xl border border-ink/10 bg-ink/[0.02] p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex w-40 flex-col gap-1">
              <span className={labelCls}>{t.measureLimitLabel}</span>
              <input
                type="number"
                min={5}
                max={100}
                value={measureLimitRaw}
                onChange={(e) => setMeasureLimitRaw(e.target.value)}
                className={inputCls}
              />
              <span className={hintCls}>{t.measureLimitHint}</span>
            </label>
            <button
              type="button"
              onClick={doMeasure}
              disabled={measuring || pickedWords.length === 0}
              className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {measuring ? t.measuring : `📐 ${t.measureBtn}`}
            </button>
            {/* ⑤ 导入投放（复用既有 launch 导入路径） */}
            <button
              type="button"
              onClick={() => onImportToLaunch(pickedWords)}
              disabled={pickedWords.length === 0}
              className="rounded-lg border border-signal px-4 py-2 text-sm font-semibold text-signal hover:bg-signal/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t.importBtn.replace("{n}", String(pickedWords.length))}
            </button>
          </div>
          {pickedWords.length === 0 && (
            <p className="mt-1.5 text-xs text-ink/45">{t.measureNeedPick}</p>
          )}
          {measureError && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {measureError}
            </p>
          )}
          {measure && (
            <div className="mt-3">
              <p className="text-sm font-medium text-ink/70">
                {t.measuredLine
                  .replace("{x}", String(measure.requestedCount))
                  .replace("{y}", String(measure.total))}
              </p>
              <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                ⚠️ {t.estimateNote}
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 text-xs text-ink/50">
                      <th className="py-1.5 pr-2 font-medium">{d.thKeyword}</th>
                      <th className="py-1.5 pr-2 font-medium">{d.thVolume}</th>
                      <th className="py-1.5 pr-2 font-medium">{t.thCpc}</th>
                      <th className="py-1.5 pr-2 font-medium">{t.thBidRange}</th>
                      <th className="py-1.5 font-medium">{t.thCompIndex}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {measure.rows.map((r) => (
                      <tr
                        key={r.keyword.toLowerCase()}
                        className="border-b border-ink/5"
                      >
                        <td className="py-1.5 pr-2 text-ink/85">{r.keyword}</td>
                        <td className="py-1.5 pr-2 text-ink/70">
                          {fmtNum(r.searchVolume)}
                        </td>
                        <td className="py-1.5 pr-2 text-ink/70">
                          {fmtMoney(r.cpc)}
                        </td>
                        <td className="py-1.5 pr-2 text-ink/70">
                          {r.lowTopBid === null && r.highTopBid === null
                            ? "—"
                            : `${fmtMoney(r.lowTopBid)} – ${fmtMoney(r.highTopBid)}`}
                        </td>
                        <td className="py-1.5 text-ink/70">
                          {fmtNum(r.competitionIndex)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
