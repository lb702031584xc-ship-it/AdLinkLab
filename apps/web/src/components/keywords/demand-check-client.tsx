"use client";

/**
 * 需求验证清单（关键词启动包 · 需求验证 Tab）：
 * 逐词填写月搜索量 / 趋势 / 竞争度 / 意图 → 自动输出「需求是否存在 / 竞争是否可打」结论。
 * 纯前端，无后端依赖。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeywordStarterDict } from "@/i18n/dict/keyword-starter";
import { useWorkState } from "@/lib/use-work-state";
import { loadWorkStateAction } from "@/lib/api/work-state-actions";
import {
  recommendKeywordsAction,
  parseKeywordCaptureAiAction,
} from "@/lib/api/ai-actions";
import type { RecommendedKeyword } from "@/lib/api/ai";
import { generateKeywordIdeasAction, type RuleKeywordIdea } from "@/lib/api/keyword-ideas-actions";
import { CapturePicker } from "@/components/ai/capture-picker";

type Trend = "up" | "flat" | "down";
type Competition = "low" | "medium" | "high";
type Intent = "buy" | "review" | "compare" | "info";
/**
 * 前端轻量判定：与后端 keyword-gate 的核心规则同口径，让卡片当场就能标出
 * 「能不能投」，不用回头问人。后端仍以 keyword-gate 为准，这里只是即时提示。
 *
 * 判据只用不依赖上下文的几条：
 *   - vs / compare        → 落地页没有对比内容
 *   - discount / coupon   → 页面没有优惠
 *   - 以 best/top 开头     → 品类大词（品牌词几乎都以品牌开头）
 *   - 以数字开头且带单位   → 纯参数词（没人按参数搜索）
 */
type QuickVerdict = { v: "reject" | "verify"; why: string };

/** 型号裸词里该跳过的修饰。 */
const CORE_SKIP = new Set(["new", "latest", "updated", "the", "for", "with", "and", "of", "in", "on", "by"]);
/** 遇到品类词就停：型号名通常到此为止。 */
const CORE_STOP = new Set([
  "robot", "vacuum", "vacuums", "mop", "mopping", "cleaner", "machine",
  "heater", "sealer", "station", "kitchen", "appliance", "cleaners",
  "washer", "dryer", "purifier", "humidifier",
]);

/**
 * 从 seed 推出「型号裸词」：AI 只会在裸词上加修饰，默认你已经有裸词了。
 * 例：roborock 2026 new qrevo edge 3 pro robot vacuum and mop
 *     → [roborock qrevo edge 3 pro] / [qrevo edge 3 pro] / [roborock edge 3 pro]
 */
function coreVariants(seed: string): string[] {
  const raw = (seed || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (raw.length < 2) return [];
  const core: string[] = [];
  for (const t of raw) {
    if (/^\d{4}$/.test(t)) continue; // 年份
    if (CORE_SKIP.has(t)) continue;
    if (CORE_STOP.has(t)) break; // 品类词处截断
    core.push(t);
  }
  if (core.length < 2) return [];
  const full = core.join(" ");
  const noBrand = core.slice(1).join(" ");
  const tail = core.length >= 4 ? [core[0], ...core.slice(-3)].join(" ") : "";
  return [...new Set([full, noBrand, tail].filter((x) => x && x.split(" ").length >= 2))].slice(0, 3);
}

function quickVerdict(keyword: string, seed?: string): QuickVerdict {
  const kw = (keyword || "").toLowerCase().trim();
  if (/\b(vs|versus|compare|comparison)\b/.test(kw))
    return { v: "reject", why: "对比词，落地页没有对比内容" };
  if (/\b(discount|coupon|promo|voucher|deal|deals)\b/.test(kw))
    return { v: "reject", why: "折扣词，页面没有优惠" };
  if (/^(best|top|cheapest|affordable)\b/.test(kw))
    return { v: "reject", why: "品类大词，竞价贵、转化低" };
  if (/^\d/.test(kw) && /\b(pa|kw|mah|psi)\b/.test(kw))
    return { v: "reject", why: "纯参数词，没人按参数搜索" };
  // 无品牌的通用品类词：'self emptying robot vacuum mop combo' 这类，
  // 搜的人在看 $200–500 的机器，打 $1500 的旗舰只会烧钱。
  // 用 seed 的首个词（品牌/型号名）判断：不含它就是通用词。
  const brandToken = (seed || "").toLowerCase().match(/[a-z0-9]{3,}/)?.[0] ?? "";
  if (brandToken && !kw.includes(brandToken))
    return { v: "reject", why: "无品牌通用品类词，竞价贵且产品不对口" };
  return { v: "verify", why: "需查搜索量后再决定" };
}

export type DemandVerdict = "good" | "caution" | "bad";

export interface DemandRow {
  id: string;
  keyword: string;
  volume: string; // 手填数字字符串
  trend: Trend;
  competition: Competition;
  intent: Intent;
}

export interface SeedImportSignal {
  words: string[];
  seq: number;
}

let rowSeq = 0;
const newRow = (keyword = ""): DemandRow => ({
  id: `dm-${++rowSeq}`,
  keyword,
  volume: "",
  trend: "flat",
  competition: "medium",
  intent: "buy",
});

const inputCls =
  "w-full rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-signal";
const labelCls = "mb-1 block text-xs font-medium text-ink/60";

function plannerUrl(): string {
  return "https://ads.google.com/aw/keywordplanner/home";
}
function trendsUrl(kw: string): string {
  const q = encodeURIComponent(kw.trim());
  return q ? `https://trends.google.com/trends/explore?q=${q}` : "https://trends.google.com/";
}
function semrushUrl(): string {
  return "https://www.semrush.com/";
}

/** 需求强度：按月搜索量分档 */
function demandLevel(volume: string): "strong" | "weak" | "none" {
  const v = Number(volume);
  if (!Number.isFinite(v) || v < 100) return "none";
  if (v < 1000) return "weak";
  return "strong";
}

/** 是否可打：竞争度 × 意图 */
function beatable(
  competition: Competition,
  intent: Intent,
  trend: Trend
): "yes" | "caution" | "no" {
  if (competition === "high") return "no";
  if (competition === "medium") return "caution";
  if (intent === "info") return "caution";
  if (trend === "down") return "caution";
  return "yes";
}

export function verdictOf(row: DemandRow): DemandVerdict {
  // 空值不是 0：Number("") === 0，会被 demandLevel 判成「无需求」，
  // 于是没填数据也被打上「建议放弃」——方向正好反了，会把该投的词砍掉。
  // 未填 >= 不给否定结论，退回「谨慎测试」。
  if (!row.volume || row.volume.trim() === "") return "caution";
  const dl = demandLevel(row.volume);
  if (dl === "none") return "bad";
  const b = beatable(row.competition, row.intent, row.trend);
  if (b === "no") return "bad";
  if (b === "caution" || dl === "weak") return "caution";
  return "good";
}

/**
 * 真实数据综合评分 0-100（透明公式，所有输入均为用户填入的真实数据）：
 * - 搜索量 30 分：≥10000=30, ≥5000=25, ≥1000=18, ≥500=10, ≥100=5, <100=0
 * - 意图 30 分：buy=30, review=24, compare=16, info=4
 * - 竞争 25 分：low=25, medium=13, high=3
 * - 趋势 15 分：up=15, flat=9, down=3
 */
export function scoreOf(row: DemandRow): { total: number; parts: string } {
  const v = Number(row.volume);
  const volumeScore = !Number.isFinite(v) || v < 100 ? 0
    : v >= 10000 ? 30 : v >= 5000 ? 25 : v >= 1000 ? 18 : v >= 500 ? 10 : 5;
  const intentScore = { buy: 30, review: 24, compare: 16, info: 4 }[row.intent];
  const compScore = { low: 25, medium: 13, high: 3 }[row.competition];
  const trendScore = { up: 15, flat: 9, down: 3 }[row.trend];
  const total = volumeScore + intentScore + compScore + trendScore;
  const parts = `搜索量${volumeScore}+意图${intentScore}+竞争${compScore}+趋势${trendScore}`;
  return { total, parts };
}

const scoreCls = (s: number) =>
  s >= 75
    ? "bg-emerald-100 text-emerald-800"
    : s >= 50
      ? "bg-amber-100 text-amber-800"
      : "bg-ink/10 text-ink/60";

const verdictCls: Record<DemandVerdict, string> = {
  good: "bg-emerald-100 text-emerald-800",
  caution: "bg-amber-100 text-amber-800",
  bad: "bg-red-100 text-red-700",
};

/** 行内复制按钮：点一下把关键词放进剪贴板，1.5 秒后恢复。 */
function CopyKwButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          /* 剪贴板不可用时静默失败 */
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="text-xs text-ink/40 hover:text-emerald-700"
      title={text}
    >
      {done ? "已复制" : "复制"}
    </button>
  );
}

export function DemandCheckClient({
  dict: d,
  importSignal,
  aiProduct,
  onValidatedReady,
  offerId,
  offerName,
}: {
  dict: KeywordStarterDict;
  importSignal: SeedImportSignal | null;
  aiProduct?: string;
  onValidatedReady?: (words: string[]) => void;
  offerId?: string | null;
  offerName?: string | null;
}) {
  const [rows, setRows] = useState<DemandRow[]>([]);
  const [kwInput, setKwInput] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");

  // AI 推荐关键词
  const [aiProductInput, setAiProductInput] = useState(
    aiProduct ?? offerName ?? ""
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiKeywords, setAiKeywords] = useState<RecommendedKeyword[]>([]);
  // P1-10：规则生成关键词（无 LLM，无假搜索量；规则分 + 来源 + 品牌覆盖警告）。
  const [ruleSeeds, setRuleSeeds] = useState("");
  const [ruleBrand, setRuleBrand] = useState("");
  const [ruleDomain, setRuleDomain] = useState("");
  const [ruleIdeas, setRuleIdeas] = useState<RuleKeywordIdea[]>([]);
  const [ruleLoading, setRuleLoading] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [captureExtracting, setCaptureExtracting] = useState(false);
  // 抓取填充参数：忙碌目标（"all" = 全部；行 id = 单条）与每条的提示
  const [fillBusy, setFillBusy] = useState<string | null>(null);
  const [fillNotes, setFillNotes] = useState<Record<string, string>>({});

  /* 自动保存：刷新/隔夜后可恢复（租户隔离） */
  const { historyOpen, historyItems, restoredAt, toggleHistory, restoreFromHistory } =
    useWorkState({
      page: "keyword-research",
      offerId: offerId ?? null,
      label: offerName ?? aiProductInput.trim() ?? null,
      buildSnapshot: () => ({ version: 1, rows, aiProductInput, aiKeywords }),
      isMeaningful: (s) => {
        const rs = s.rows as DemandRow[] | undefined;
        const ks = s.aiKeywords as unknown[] | undefined;
        return (
          (Array.isArray(rs) && rs.some((r) => r.keyword?.trim())) ||
          (Array.isArray(ks) && ks.length > 0)
        );
      },
      applySnapshot: (s) => {
        // 合并语义：已有的行不丢，快照里的词去重追加
        const rs = s.rows as DemandRow[] | undefined;
        const ks = s.aiKeywords as RecommendedKeyword[] | undefined;
        if (Array.isArray(rs) && rs.length > 0) {
          const clean = rs.filter((r) => r && typeof r.keyword === "string" && r.keyword.trim());
          if (clean.length > 0) {
            setRows((cur) => {
              const have = new Set(
                cur.map((r) => r.keyword.trim().toLowerCase()).filter(Boolean)
              );
              const fresh = clean
                .filter((r) => !have.has(r.keyword.trim().toLowerCase()))
                .map((r) => ({ ...newRow(), ...r }));
              return [...cur, ...fresh];
            });
          }
        }
        if (Array.isArray(ks) && ks.length > 0) {
          setAiKeywords((cur) => {
            const have = new Set(cur.map((k) => k.keyword?.trim().toLowerCase()).filter(Boolean));
            return [...cur, ...ks.filter((k) => k && !have.has(k.keyword?.trim().toLowerCase()))];
          });
        }
        if (typeof s.aiProductInput === "string" && s.aiProductInput.trim() && !aiProductInput.trim()) {
          setAiProductInput(s.aiProductInput);
        }
      },
      watch: [offerId, rows, aiProductInput, aiKeywords],
    });

  /* offer 切换时：载入该 offer 的快照（替换，不合并），没快照则清空，
     不留上一个 offer 的词。首次挂载由 useWorkState 恢复，这里跳过。
     aiProductInput 由下方 offer→AI 输入框同步 effect 负责。 */
  const prevOfferRef = useRef(offerId ?? null);
  useEffect(() => {
    const prev = prevOfferRef.current;
    prevOfferRef.current = offerId ?? null;
    if (prev === (offerId ?? null)) return;
    if (!offerId) {
      setRows([]);
      setAiKeywords([]);
      setFillNotes({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await loadWorkStateAction("keyword-research", offerId);
        if (cancelled) return;
        const s = res.ok ? res.data.state : null;
        const rs = s?.rows as DemandRow[] | undefined;
        const ks = s?.aiKeywords as RecommendedKeyword[] | undefined;
        const cleanRows = Array.isArray(rs)
          ? rs.filter((r) => r && typeof r.keyword === "string" && r.keyword.trim())
          : [];
        const cleanKs = Array.isArray(ks)
          ? ks.filter((k) => k && typeof k.keyword === "string" && k.keyword.trim())
          : [];
        if (cleanRows.length > 0 || cleanKs.length > 0) {
          setRows(cleanRows.map((r) => ({ ...newRow(), ...r })));
          setAiKeywords(cleanKs);
          setFillNotes({});
          if (typeof s?.aiProductInput === "string" && s.aiProductInput.trim()) {
            setAiProductInput(s.aiProductInput);
          }
        } else {
          setRows([]);
          setAiKeywords([]);
          setFillNotes({});
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setAiKeywords([]);
          setFillNotes({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId]);

  // offer 选择变化时同步到 AI 输入框
  useEffect(() => {
    if (aiProduct) setAiProductInput(aiProduct);
    else if (offerName && !aiProductInput.trim()) setAiProductInput(offerName);
  }, [aiProduct]);

  const onAiRecommend = async () => {
    const p = aiProductInput.trim();
    if (!p || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await recommendKeywordsAction(p, 10);
      if (res.ok) {
        setAiKeywords((cur) => {
          const have = new Set(
            cur.map((k) => k.keyword.trim().toLowerCase()).filter(Boolean)
          );
          const fresh = res.data.keywords
            .filter((k) => k.keyword && !have.has(k.keyword.trim().toLowerCase()))
            .map((k) => ({ ...k, source: "ai" as const }));
          return [...cur, ...fresh];
        });
      } else {
        setAiError(res.error || d.aiFailed);
      }
    } catch {
      setAiError(d.aiFailed);
    } finally {
      setAiLoading(false);
    }
  };

  const importAiKeyword = (k: RecommendedKeyword) => {
    const t = k.keyword.trim();
    if (!t) return;
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.keyword.trim().toLowerCase()));
      if (have.has(t.toLowerCase())) return rs;
      const row = newRow(t);
      if (k.volume != null) row.volume = String(k.volume);
      return [...rs, row];
    });
  };

  const importAllAi = () => {
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.keyword.trim().toLowerCase()));
      const fresh = aiKeywords
        .filter((k) => k.keyword.trim() && !have.has(k.keyword.trim().toLowerCase()))
        .map((k) => {
          const row = newRow(k.keyword.trim());
          if (k.volume != null) row.volume = String(k.volume);
          return row;
        });
      return [...rs, ...fresh];
    });
  };

  // P1-10：规则生成（种子默认取当前清单关键词；品牌/域名手动填）。
  const onRuleGenerate = async () => {
    const seeds = ruleSeeds
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const seedsFinal =
      seeds.length > 0
        ? seeds
        : rows.map((r) => r.keyword.trim()).filter(Boolean);
    if (seedsFinal.length === 0 || ruleLoading) return;
    setRuleLoading(true);
    setRuleError(null);
    try {
      const res = await generateKeywordIdeasAction({
        seeds: seedsFinal,
        brandTerms: ruleBrand.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean),
        domain: ruleDomain.trim() || undefined,
      });
      if (res.ok) {
        setRuleIdeas(res.data.ideas);
      } else {
        setRuleError(res.error || d.ruleFailed);
      }
    } catch {
      setRuleError(d.ruleFailed);
    } finally {
      setRuleLoading(false);
    }
  };

  const importRuleIdea = (idea: RuleKeywordIdea) => {
    const t = idea.keyword.trim();
    if (!t) return;
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.keyword.trim().toLowerCase()));
      if (have.has(t.toLowerCase())) return rs;
      return [...rs, newRow(t)];
    });
  };

  const importAllRule = () => {
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.keyword.trim().toLowerCase()));
      const fresh = ruleIdeas
        .filter((k) => k.keyword.trim() && !have.has(k.keyword.trim().toLowerCase()))
        .map((k) => newRow(k.keyword.trim()));
      return [...rs, ...fresh];
    });
  };

  // 上方种子词一键导入（去重）
  useEffect(() => {
    if (!importSignal || importSignal.seq === 0) return;
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.keyword.trim().toLowerCase()));
      const fresh = importSignal.words
        .map((w) => w.trim())
        .filter((w) => w && !have.has(w.toLowerCase()))
        .map((w) => newRow(w));
      return fresh.length ? [...rs, ...fresh] : rs;
    });
  }, [importSignal]);

  const update = (id: string, patch: Partial<DemandRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id));

  /* 抓取填充参数：AI 从抓取页提取该词的真实参数，匹配上的才覆盖，没匹配的不动 */
  const fillFromCapture = async (captureId: string, target: "all" | string) => {
    const busyKey = target === "all" ? "all" : target;
    setFillBusy(busyKey);
    try {
      const res = await parseKeywordCaptureAiAction(captureId);
      if (!res.ok || res.data.rows.length === 0) {
        setFillNotes((n) => ({ ...n, [busyKey]: d.captureFillRowNone }));
        return;
      }
      const byKw = new Map(
        res.data.rows.map((r) => [r.keyword.trim().toLowerCase(), r])
      );
      const patches = new Map<string, Partial<DemandRow>>();
      for (const row of rows) {
        if (target !== "all" && row.id !== target) continue;
        const ai = byKw.get(row.keyword.trim().toLowerCase());
        if (!ai) continue;
        const patch: Partial<DemandRow> = {};
        if (ai.volume != null) patch.volume = String(ai.volume);
        if (ai.competition === "Low") patch.competition = "low";
        else if (ai.competition === "Medium") patch.competition = "medium";
        else if (ai.competition === "High") patch.competition = "high";
        // 导航意图没有对应选项，保持原值不覆盖
        if (ai.intent === "交易" || ai.intent === "Transactional") patch.intent = "buy";
        else if (ai.intent === "商业调查" || ai.intent === "Commercial") patch.intent = "compare";
        else if (ai.intent === "信息" || ai.intent === "Informational") patch.intent = "info";
        if (ai.trend === "up" || ai.trend === "flat" || ai.trend === "down") patch.trend = ai.trend;
        if (Object.keys(patch).length > 0) patches.set(row.id, patch);
      }
      if (patches.size === 0) {
        setFillNotes((n) => ({
          ...n,
          [busyKey]: target === "all" ? d.captureFillNone : d.captureFillRowNone,
        }));
        return;
      }
      setRows((cur) =>
        cur.map((r) => (patches.has(r.id) ? { ...r, ...patches.get(r.id) } : r))
      );
      setFillNotes((n) => ({
        ...n,
        [busyKey]:
          target === "all"
            ? d.captureFillDone.replace("{n}", String(patches.size))
            : d.captureFillRowDone,
      }));
    } finally {
      setFillBusy(null);
    }
  };

  const addKeyword = () => {
    const kw = kwInput.trim();
    if (!kw) return;
    setRows((rs) => [...rs, newRow(kw)]);
    setKwInput("");
  };

  const doBulkImport = () => {
    const words = bulkText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!words.length) {
      setBulkOpen(false);
      return;
    }
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.keyword.trim().toLowerCase()));
      const fresh = words
        .filter((w) => !have.has(w.toLowerCase()))
        .map((w) => newRow(w));
      return [...rs, ...fresh];
    });
    setBulkText("");
    setBulkOpen(false);
  };

  const summary = useMemo(() => {
    let good = 0, caution = 0, bad = 0;
    for (const r of rows) {
      const v = verdictOf(r);
      if (v === "good") good++;
      else if (v === "caution") caution++;
      else bad++;
    }
    return { total: rows.length, good, caution, bad };
  }, [rows]);

  const summaryText = d.summaryLine
    .replace("{total}", String(summary.total))
    .replace("{good}", String(summary.good))
    .replace("{caution}", String(summary.caution))
    .replace("{bad}", String(summary.bad));

  const exportValidated = () => {
    const words = rows
      .filter((r) => {
        const v = verdictOf(r);
        return v === "good" || v === "caution";
      })
      .map((r) => r.keyword.trim())
      .filter(Boolean);
    if (words.length && onValidatedReady) onValidatedReady(words);
  };

  return (
    <div className="mt-8 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink">📊 {d.demandTitle}</h2>
        <p className="mt-1 text-sm text-ink/60">{d.demandSubtitle}</p>
      </div>

      {/* 自动保存 + 历史记录 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggleHistory}
          className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
        >
          🕘 {d.history} {historyOpen ? "▾" : "▸"}
        </button>
        {restoredAt && (
          <span className="text-xs text-emerald-700">
            ✓ {d.restoredNote.replace("{time}", new Date(restoredAt).toLocaleString())}
          </span>
        )}
        <span className="text-xs text-ink/45">{d.autosaveHint}</span>
      </div>
      {historyOpen && (
        <div className="rounded-xl border border-ink/10 bg-white/70 p-3">
          {historyItems.length === 0 ? (
            <p className="text-sm text-ink/55">{d.historyEmpty}</p>
          ) : (
            <ul className="divide-y divide-ink/5">
              {historyItems.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => restoreFromHistory(h)}
                    className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-ink/[0.03]"
                  >
                    <span className="truncate text-sm font-medium text-ink">
                      {h.label || d.historyUntitled}
                    </span>
                    <span className="shrink-0 text-xs text-ink/50">
                      {new Date(h.updatedAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* AI 推荐关键词 */}
      <div className="rounded-xl border border-signal/30 bg-signal/[0.04] p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">🤖 {d.aiRecommendTitle}</h3>
        </div>
        <p className="mt-1 text-xs text-ink/50">{d.aiRecommendHint}</p>
        <CapturePicker
          onPick={async (c) => {
            const v = [c.title, c.description].filter(Boolean).join(" ").slice(0, 500);
            if (v) setAiProductInput(v);
            // 抓取页面的真实关键词（AI 提取，带搜索量）进推荐列表，标明来源
            setCaptureExtracting(true);
            try {
              const res = await parseKeywordCaptureAiAction(c.id);
              if (res.ok && res.data.rows.length > 0) {
                const from = (c.title || "").trim();
                setAiKeywords((cur) => {
                  const have = new Set(
                    cur.map((k) => k.keyword.trim().toLowerCase()).filter(Boolean)
                  );
                  const fresh: RecommendedKeyword[] = [];
                  for (const row of res.data.rows) {
                    if (!row.keyword || have.has(row.keyword.toLowerCase())) continue;
                    have.add(row.keyword.toLowerCase());
                    const parts = [`${d.captureKwFrom} ${from || d.captureKwPage}`];
                    if (row.volume != null)
                      parts.push(`${d.captureKwVolume} ${row.volume.toLocaleString()}`);
                    fresh.push({
                      keyword: row.keyword,
                      reason: parts.join(" · "),
                      source: "capture",
                      volume: row.volume,
                    });
                  }
                  return [...fresh, ...cur];
                });
              }
            } finally {
              setCaptureExtracting(false);
            }
          }}
        />
        {captureExtracting && (
          <p className="mt-1 text-xs text-ink/55">{d.captureKwExtracting}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={aiProductInput}
            onChange={(e) => setAiProductInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAiRecommend()}
            placeholder={d.aiProductPlaceholder}
            className={`${inputCls} max-w-xs`}
          />
          <button
            type="button"
            onClick={onAiRecommend}
            disabled={aiLoading || !aiProductInput.trim()}
            className="rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {aiLoading ? d.aiRecommending : d.aiRecommendBtn}
          </button>
          {aiKeywords.length > 0 && (
            <button
              type="button"
              onClick={importAllAi}
              className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
            >
              {d.aiImportAll} ({aiKeywords.length})
            </button>
          )}
        </div>
        {aiError && (
          <p className="mt-2 text-xs text-red-600">{aiError}</p>
        )}
        {coreVariants(aiProductInput).length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-xs font-medium text-emerald-800">
              🎯 必投：型号裸词（AI 只会加修饰，默认你已有裸词）。这些最接近下单，用完全匹配
            </p>
            {coreVariants(aiProductInput).map((kw) => (
              <div
                key={kw}
                className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2"
              >
                <span className="min-w-0 text-sm font-medium text-ink">
                  [{kw}]
                </span>
                <button
                  type="button"
                  onClick={() =>
                    importAiKeyword({
                      keyword: kw,
                      reason: "型号裸词（最高优先级）",
                      source: "ai",
                    })
                  }
                  className="shrink-0 text-xs text-signal hover:underline"
                >
                  {d.aiImportOne}
                </button>
              </div>
            ))}
          </div>
        )}
        {aiKeywords.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-xs text-ink/50">{d.aiNoScoreHint}</p>
            {aiKeywords.map((k) => (
              <div
                key={k.keyword}
                className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium text-ink">{k.keyword}</span>
                  <span
                    className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${
                      k.source === "capture"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-ink/5 text-ink/60"
                    }`}
                  >
                    {k.source === "capture" ? `📥 ${d.sourceCapture}` : `🤖 ${d.sourceAi}`}
                  </span>
                  <span
                    className={`ml-1 rounded px-1.5 py-0.5 text-[11px] ${
                      quickVerdict(k.keyword, aiProductInput).v === "reject"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {quickVerdict(k.keyword, aiProductInput).v === "reject" ? "❌ 不投" : "⚠️ 待验证"}
                  </span>
                  {k.reason && (
                    <p className="truncate text-xs text-ink/50">{k.reason}</p>
                  )}
                  {quickVerdict(k.keyword, aiProductInput).v === "reject" && (
                    <p className="truncate text-xs text-red-600">
                      {quickVerdict(k.keyword, aiProductInput).why}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => importAiKeyword(k)}
                  className="shrink-0 text-xs text-signal hover:underline"
                >
                  {d.aiImportOne}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* P1-10：规则生成关键词（规则分 + 来源 + 品牌覆盖警告；搜索量/竞争度 — 不编造）。 */}
      <div className="rounded-xl border border-ink/10 bg-white p-4">
        <h3 className="text-sm font-semibold text-ink">📏 {d.ruleTitle}</h3>
        <p className="mt-1 text-xs text-ink/50">{d.ruleHint}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={ruleSeeds}
            onChange={(e) => setRuleSeeds(e.target.value)}
            placeholder={d.ruleSeeds}
            className={`${inputCls} max-w-xs`}
          />
          <input
            value={ruleBrand}
            onChange={(e) => setRuleBrand(e.target.value)}
            placeholder={d.ruleBrand}
            className={`${inputCls} max-w-xs`}
          />
          <input
            value={ruleDomain}
            onChange={(e) => setRuleDomain(e.target.value)}
            placeholder={d.ruleDomain}
            className={`${inputCls} max-w-xs`}
          />
          <button
            type="button"
            onClick={onRuleGenerate}
            disabled={ruleLoading}
            className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {ruleLoading ? d.ruleGenerating : d.ruleGenerate}
          </button>
          {ruleIdeas.length > 0 && (
            <button
              type="button"
              onClick={importAllRule}
              className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
            >
              {d.ruleImportAll} ({ruleIdeas.length})
            </button>
          )}
        </div>
        {ruleError && <p className="mt-2 text-xs text-red-600">{ruleError}</p>}
        {ruleIdeas.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-xs text-ink/50">{d.ruleNoVolume}</p>
            {ruleIdeas.map((idea) => (
              <div
                key={idea.keyword}
                className="flex items-center justify-between gap-2 rounded-lg bg-ink/[0.03] px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium text-ink">{idea.keyword}</span>
                  <span className="ml-2 rounded bg-ink/5 px-1.5 py-0.5 text-[11px] text-ink/60">
                    {d.ruleSourceLabel} · {d.ruleKindLabels[idea.kind]} · 规则分 {idea.ruleScore}
                  </span>
                  <span className="ml-2 text-xs text-ink/50">搜索量 — · 竞争度 —</span>
                  {idea.brandCoverageWarn ? (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
                      ⚠️ {d.ruleCoverageWarn}
                      {idea.brandCoverage != null ? `（${idea.brandCoverage}）` : ""}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => importRuleIdea(idea)}
                  className="shrink-0 text-xs text-signal hover:underline"
                >
                  {d.ruleImportOne}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={kwInput}
          onChange={(e) => setKwInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addKeyword()}
          placeholder={d.kwPlaceholder}
          className={`${inputCls} max-w-xs`}
        />
        <button
          type="button"
          onClick={addKeyword}
          className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          + {d.addKeyword}
        </button>
        <button
          type="button"
          onClick={() => setBulkOpen((o) => !o)}
          className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
        >
          {d.importKeywords}
        </button>
      </div>

      {bulkOpen && (
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={d.bulkPlaceholder}
            rows={5}
            className={inputCls}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={doBulkImport}
              className="rounded-lg bg-signal px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              {d.doImport}
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen(false)}
              className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
            >
              {d.cancel}
            </button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-2">
          <CapturePicker
            label={d.captureFillAll}
            onPick={(c) => void fillFromCapture(c.id, "all")}
          />
          {fillBusy === "all" && (
            <p className="mt-1 text-xs text-ink/55">{d.captureFilling}</p>
          )}
          {fillNotes.all && fillBusy !== "all" && (
            <p className="mt-1 text-xs text-ink/55">{fillNotes.all}</p>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink/20 bg-white/50 p-6 text-center text-sm text-ink/50">
          {d.emptyDemand}
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const v = verdictOf(r);
            const dl = demandLevel(r.volume);
            const b = beatable(r.competition, r.intent, r.trend);
            const score = scoreOf(r);
            const hasData = r.volume.trim() !== "";
            return (
              <div key={r.id} className="rounded-xl border border-ink/10 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-bold text-ink">{r.keyword}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    {hasData && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${scoreCls(score.total)}`}
                        title={`${d.aiScore}：${score.parts}（基于你填的真实数据）`}
                      >
                        {score.total}分
                      </span>
                    )}
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${verdictCls[v]}`}>
                      {d.verdictOptions[v]}
                    </span>
                    <CapturePicker
                      label={d.captureFillRow}
                      className=""
                      onPick={(c) => void fillFromCapture(c.id, r.id)}
                    />
                    <CopyKwButton text={r.keyword} />
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      className="text-xs text-ink/40 hover:text-red-600"
                    >
                      {d.remove}
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <label className={labelCls}>{d.thVolume}</label>
                    <input
                      value={r.volume}
                      onChange={(e) => update(r.id, { volume: e.target.value.replace(/[^\d]/g, "") })}
                      inputMode="numeric"
                      placeholder="1000"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>{d.thTrend}</label>
                    <select
                      value={r.trend}
                      onChange={(e) => update(r.id, { trend: e.target.value as Trend })}
                      className={inputCls}
                    >
                      {(Object.keys(d.trendOptions) as Trend[]).map((k) => (
                        <option key={k} value={k}>{d.trendOptions[k]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>{d.thCompetition}</label>
                    <select
                      value={r.competition}
                      onChange={(e) => update(r.id, { competition: e.target.value as Competition })}
                      className={inputCls}
                    >
                      {(Object.keys(d.competitionOptions) as Competition[]).map((k) => (
                        <option key={k} value={k}>{d.competitionOptions[k]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>{d.thIntent}</label>
                    <select
                      value={r.intent}
                      onChange={(e) => update(r.id, { intent: e.target.value as Intent })}
                      className={inputCls}
                    >
                      {(Object.keys(d.intentOptions) as Intent[]).map((k) => (
                        <option key={k} value={k}>{d.intentOptions[k]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/60">
                  <span>{d.demandLabel}：<b className="text-ink/80">{d.demandLevels[dl]}</b></span>
                  <span>{d.beatableLabel}：<b className="text-ink/80">{d.beatableLevels[b]}</b></span>
                  <span className="ml-auto flex gap-2">
                    <a href={plannerUrl()} target="_blank" rel="noreferrer" className="text-signal hover:underline">{d.openPlanner} ↗</a>
                    <a href={trendsUrl(r.keyword)} target="_blank" rel="noreferrer" className="text-signal hover:underline">{d.openTrends} ↗</a>
                    <a href={semrushUrl()} target="_blank" rel="noreferrer" className="text-signal hover:underline">{d.openSemrush} ↗</a>
                  </span>
                </div>
                {(fillBusy === r.id || fillNotes[r.id]) && (
                  <p className="mt-2 text-xs text-ink/55">
                    {fillBusy === r.id ? d.captureFilling : fillNotes[r.id]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded-xl border border-signal/30 bg-signal/[0.06] p-4">
          <p className="text-sm font-bold text-ink">✅ {d.summaryTitle}</p>
          <p className="mt-1 text-sm text-ink/80">{summaryText}</p>
          {onValidatedReady && summary.good + summary.caution > 0 && (
            <button
              type="button"
              onClick={exportValidated}
              className="mt-2 rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              🚀 {d.importValidatedBtn.replace("{n}", String(summary.good + summary.caution))}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
