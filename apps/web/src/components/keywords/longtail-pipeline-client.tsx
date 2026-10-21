"use client";

/**
 * DataForSEO 实测长尾流水线（/keywords/starter 研究 Tab）：
 * ① 扩词（Labs Related Keywords 实测）→ ② 多轮筛选（本地量/竞争过滤 +
 *    幸存词意图过滤）→ ③ 人工勾选 → ④ 广告测算（估算 CPC/页首出价，仅展示）
 *    → ⑤ 导入投放（复用既有 research→launch 导入路径）。
 * 每步都显示数字状态：已扩 X 条 / 筛后 Y 条 / 已勾 Z 条。
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

type CompetitionMode = "lowPlusMedium" | "lowOnly" | "all";

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

/** 竞争等级：优先响应原文 competition_level，缺失时按 0–1 数值分档；未知 → null（不拦）。 */
function competitionLevelOf(c: DfsCandidate): "LOW" | "MEDIUM" | "HIGH" | null {
  const raw = c.competitionLevel?.toUpperCase();
  if (raw === "LOW" || raw === "MEDIUM" || raw === "HIGH") return raw;
  if (c.competition === null) return null;
  if (c.competition <= 0.33) return "LOW";
  if (c.competition <= 0.66) return "MEDIUM";
  return "HIGH";
}

function passesCompetition(c: DfsCandidate, mode: CompetitionMode): boolean {
  if (mode === "all") return true;
  const level = competitionLevelOf(c);
  if (level === null) return true; // 未知不误杀
  if (mode === "lowOnly") return level === "LOW";
  return level === "LOW" || level === "MEDIUM";
}

function passesVolume(c: DfsCandidate, minVolume: number): boolean {
  if (minVolume <= 0) return true;
  if (c.searchVolume === null) return true; // 未知不误杀
  return c.searchVolume >= minVolume;
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
  const [filtered, setFiltered] = useState<PipelineCandidate[] | null>(null);
  const [localSurvivors, setLocalSurvivors] = useState<number | null>(null);
  const [intentUnverified, setIntentUnverified] = useState(false);

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

  const visibleRows = filtered ?? candidates;
  const pickedWords = useMemo(() => {
    if (!filtered) return [];
    return filtered
      .filter((c) => selected.has(c.keyword.toLowerCase()))
      .map((c) => c.keyword);
  }, [filtered, selected]);

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
      setCandidates(
        res.data.candidates.map((c) => ({ ...c, intent: null }))
      );
      setCached(res.data.cached);
      // 换了一批候选：下游状态全部作废，避免拿旧筛选/旧测算误导
      setFiltered(null);
      setLocalSurvivors(null);
      setIntentUnverified(false);
      setSelected(new Set());
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
      const local = candidates.filter(
        (c) => passesVolume(c, minVolume) && passesCompetition(c, compMode)
      );
      setLocalSurvivors(local.length);
      let survivors = local;
      let unverified = false;
      if (intentOn && local.length > 0) {
        const res = await intentFilterAction({
          keywords: local.map((c) => c.keyword),
          locationCode,
          languageCode,
        });
        if (res.ok && res.data.verified) {
          const byKey = new Map(
            res.data.results.map((r) => [r.keyword.toLowerCase(), r.intent])
          );
          survivors = local
            .map((c) => ({
              ...c,
              intent: byKey.get(c.keyword.toLowerCase()) ?? null,
            }))
            .filter((c) => {
              // 意图明确非购买向才剔除；意图未知（null）保留，不丢词
              if (c.intent === null) {
                unverified = true;
                return true;
              }
              return c.intent === "commercial" || c.intent === "transactional";
            });
        } else {
          // fail-soft：意图没验成，保留全部本地幸存词并标注未验证
          unverified = true;
          if (!res.ok) setFilterError(res.error);
        }
      }
      setIntentUnverified(unverified);
      setFiltered(survivors);
      setSelected(new Set());
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

  const inputCls =
    "rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm outline-none focus:border-signal";
  const labelCls = "text-xs font-medium text-ink/60";
  const hintCls = "text-[11px] leading-snug text-ink/45";

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
                  filtered &&
                  candidates &&
                  t.filterLine
                    .replace("{x}", String(candidates.length))
                    .replace("{y}", String(filtered.length))}
                {step === "pick" &&
                  filtered &&
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
          {filtered && (
            <p className="mt-2 text-sm font-medium text-ink/70">
              {t.filterLine
                .replace("{x}", String(candidates.length))
                .replace("{y}", String(filtered.length))}
              {localSurvivors !== null && intentOn && (
                <span className="ml-2 text-xs text-ink/50">
                  {t.filterStageLine
                    .replace("{a}", String(localSurvivors))
                    .replace("{b}", String(filtered.length))}
                </span>
              )}
            </p>
          )}
          {filtered && intentUnverified && (
            <p className="mt-1 text-xs text-amber-600">⚠️ {t.intentUnverified}</p>
          )}
        </div>
      )}

      {/* 候选表：筛选前只读预览；筛选后可勾选（第 ③ 步） */}
      {visibleRows && visibleRows.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          {filtered && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-ink">
                {t.pickLine.replace("{n}", String(pickedWords.length))}
              </span>
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    new Set(filtered.map((c) => c.keyword.toLowerCase()))
                  )
                }
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
            </div>
          )}
          {!filtered && (
            <p className="mb-2 text-xs text-ink/45">{t.needFilterFirst}</p>
          )}
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-xs text-ink/50">
                {filtered && <th className="py-1.5 pr-2 font-medium">✓</th>}
                <th className="py-1.5 pr-2 font-medium">{d.thKeyword}</th>
                <th className="py-1.5 pr-2 font-medium">{d.thVolume}</th>
                <th className="py-1.5 pr-2 font-medium">{t.thCpc}</th>
                <th className="py-1.5 pr-2 font-medium">{d.thCompetition}</th>
                <th className="py-1.5 font-medium">{d.thIntent}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((c) => {
                const level = competitionLevelOf(c);
                const key = c.keyword.toLowerCase();
                return (
                  <tr key={key} className="border-b border-ink/5">
                    {filtered && (
                      <td className="py-1.5 pr-2">
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => togglePick(c.keyword)}
                          className="h-4 w-4 accent-[#2563eb]"
                        />
                      </td>
                    )}
                    <td className="py-1.5 pr-2 text-ink/85">{c.keyword}</td>
                    <td className="py-1.5 pr-2 text-ink/70">
                      {fmtNum(c.searchVolume)}
                    </td>
                    <td className="py-1.5 pr-2 text-ink/70">{fmtMoney(c.cpc)}</td>
                    <td className="py-1.5 pr-2 text-ink/70">
                      {level ? t.competitionLevels[level] : "—"}
                    </td>
                    <td className="py-1.5 text-ink/70">
                      {c.intent
                        ? (t.intentLabels[
                            c.intent as keyof typeof t.intentLabels
                          ] ?? c.intent)
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        candidates && (
          <p className="mt-3 text-sm text-ink/50">{t.emptyCandidates}</p>
        )
      )}

      {/* ④ 广告测算（人工勾选门：未勾选禁用） */}
      {filtered && (
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
