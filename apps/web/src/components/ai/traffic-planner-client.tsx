"use client";

/**
 * 投流决策 AI 分析：2×2 组合选择 → 数据源收集（一键直达+填充位）→ AI 五板块报告。
 * 关键词/否定词：自动生成 + 手动 + 批量导入 + 导出。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  zh as tpZh,
  en as tpEn,
  type TrafficPlannerDict,
} from "@/i18n/dict/traffic-planner";
import {
  analyzeTrafficPlanAction,
  parseKeywordCaptureAction,
  type AiActionResult,
} from "@/lib/api/ai-actions";
import { loadWorkStateAction } from "@/lib/api/work-state-actions";
import { useWorkState } from "@/lib/use-work-state";
import type {
  TrafficPlanKeywordInput,
  TrafficPlanResult,
} from "@/lib/api/ai";
import { CapturePicker } from "@/components/ai/capture-picker";
import { OfferPipelineNav } from "@/components/ai/offer-pipeline-nav";
import type { OfferCaptureItem } from "@/lib/api/ai";

type Dict = TrafficPlannerDict;
type Mode = "landing" | "direct";
type BrandPolicy = "allowed" | "forbidden";

/* ---------- 轻量 markdown 渲染（标题/加粗/列表/段落） ---------- */
function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let listBuf: string[] = [];
  const flushList = () => {
    if (listBuf.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="mb-2 list-disc space-y-1 pl-5 text-sm">
          {listBuf.map((li, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: inline(li) }} />
          ))}
        </ul>
      );
      listBuf = [];
    }
  };
  const inline = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, "<code class='rounded bg-ink/10 px-1'>$1</code>");
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (/^[-*]\s/.test(line)) {
      listBuf.push(line.replace(/^[-*]\s/, ""));
      return;
    }
    flushList();
    if (/^###\s/.test(line)) {
      out.push(
        <h4 key={idx} className="mb-1 mt-3 text-sm font-semibold text-ink"
          dangerouslySetInnerHTML={{ __html: inline(line.slice(4)) }} />
      );
    } else if (/^##\s/.test(line)) {
      out.push(
        <h3 key={idx} className="mb-1 mt-4 text-base font-semibold text-ink"
          dangerouslySetInnerHTML={{ __html: inline(line.slice(3)) }} />
      );
    } else if (/^#\s/.test(line)) {
      out.push(
        <h2 key={idx} className="mb-2 mt-4 text-lg font-bold text-ink"
          dangerouslySetInnerHTML={{ __html: inline(line.slice(2)) }} />
      );
    } else if (line) {
      out.push(
        <p key={idx} className="mb-2 text-sm leading-relaxed text-ink/90"
          dangerouslySetInnerHTML={{ __html: inline(line) }} />
      );
    }
  });
  flushList();
  return out;
}

/* ---------- 通用否定词库（与后端 UNIVERSAL_NEGATIVES 对应） ---------- */
const UNIVERSAL_NEGATIVES: Record<string, string[]> = {
  售后类: ["维修", "保修", "说明书", "客服", "电话", "地址", "退货", "换货", "repair", "warranty", "manual", "support"],
  白嫖类: ["免费", "破解", "torrent", "下载", "free", "crack", "download"],
  求职类: ["招聘", "兼职", "工资", "面试", "jobs", "hiring"],
  二手类: ["二手", "闲置", "转让", "used", "second hand"],
  纯信息类: ["是什么", "图片", "视频", "what is", "pictures"],
  本地类: ["附近", "门店", "near me", "store location"],
};

/* ---------- 一键直达 URL（含搜索参数预填） ---------- */
function siteUrl(site: string, query: string): string {
  const q = encodeURIComponent(query.trim());
  switch (site) {
    case "offervault":
      return q ? `https://offervault.com/?s=${q}` : "https://offervault.com/";
    case "semrush":
      return "https://www.semrush.com/";
    case "planner":
      return "https://ads.google.com/aw/keywordplanner/home";
    case "spyfu":
      return q ? `https://www.spyfu.com/overview/domain?query=${q}` : "https://www.spyfu.com/";
    case "transparency":
      return "https://adstransparency.google.com/";
    case "similarweb":
      return q ? `https://www.similarweb.com/website/${q}/` : "https://www.similarweb.com/";
    case "trends":
      return q ? `https://trends.google.com/trends/explore?q=${q}` : "https://trends.google.com/";
    /* 电商查询：电商 offer 在 Offervault 查不到数据，直接看产品本身 */
    case "amazon":
      return q ? `https://www.amazon.com/s?k=${q}` : "https://www.amazon.com/";
    case "keepa":
      return q ? `https://keepa.com/#!search/1-${q}` : "https://keepa.com/";
    case "gshopping":
      return q ? `https://www.google.com/search?tbm=shop&q=${q}` : "https://www.google.com/shopping";
    default:
      return "https://www.google.com/";
  }
}

const inputCls =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-signal";
const labelCls = "mb-1 block text-sm font-medium text-ink/80";
const hintCls = "mb-1 block text-xs text-ink/50";
const cardCls = "rounded-xl border border-ink/10 bg-white p-4 shadow-sm";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5 disabled:opacity-50";

interface KwRow extends TrafficPlanKeywordInput {
  id: string;
}
let kwSeq = 0;
const newKwRow = (): KwRow => ({ id: `kw-${++kwSeq}`, keyword: "" });

/** Offer 上下文（offer 库 / AI 分析工作表带入）。 */
export interface PlannerOffer {
  id: string;
  name: string;
  network: string;
  commissionValue?: string | number | null;
  commissionType?: string | null;
  avgPrice?: string | number | null;
}

/** 从 offer 库参数推导 payout（美元）：固定佣金直接用；百分比佣金按均价折算。 */
function payoutFromOffer(o: PlannerOffer): string {
  const v = Number(o.commissionValue);
  if (!Number.isFinite(v) || v <= 0) return "";
  if (o.commissionType === "percentage") {
    const price = Number(o.avgPrice);
    if (!Number.isFinite(price) || price <= 0) return "";
    return ((price * v) / 100).toFixed(2);
  }
  return String(o.commissionValue);
}

export function TrafficPlannerClient({
  showSetupNudge,
  hideHeader,
  onResult,
  initialOffer,
  offers,
  initialInputs,
}: {
  showSetupNudge: boolean;
  /** Worksheet embedding: hide the page header (the step card provides it). */
  hideHeader?: boolean;
  /** Worksheet embedding: report the generated plan upward. */
  onResult?: (r: TrafficPlanResult | null) => void;
  /** Offer 上下文：独立页 ?offerId= / 工作表嵌入时带入，自动填 offer 参数。 */
  initialOffer?: PlannerOffer | null;
  /** 独立页 offer 下拉列表（嵌入时不传，不显示下拉）。 */
  offers?: PlannerOffer[];
  /**
   * 上游（工作表 ③ 盈利测算）同步来的值：payout/CVR/退款率。
   * 恢复完成后应用到对应字段（只覆盖这三个字段，关键词/情报等仍用本页快照）。
   */
  initialInputs?: { payout?: string; cvr?: string; refundRate?: string };
}) {
  const { lang } = useI18n();
  const d: Dict = lang === "zh" ? tpZh : tpEn;

  const [mode, setMode] = useState<Mode>("landing");
  const [brandPolicy, setBrandPolicy] = useState<BrandPolicy>("allowed");

  // Offer 上下文：?offerId= / 工作表嵌入带入
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(
    initialOffer?.id ?? null
  );
  const appliedOfferRef = useRef<string | null>(initialOffer?.id ?? null);

  // Offer 基础（优先用带入的 offer 参数初始化）
  const [offerName, setOfferName] = useState(initialOffer?.name ?? "");
  const [payout, setPayout] = useState(
    () => initialInputs?.payout ?? (initialOffer ? payoutFromOffer(initialOffer) : "")
  );
  const [network, setNetwork] = useState(initialOffer?.network ?? "");
  const [cookieDays, setCookieDays] = useState("");
  // EPC
  const [epc, setEpc] = useState("");
  const [networkCvr, setNetworkCvr] = useState(initialInputs?.cvr ?? "");
  const [refundRate, setRefundRate] = useState(initialInputs?.refundRate ?? "");
  // Offervault
  const [bestPayout, setBestPayout] = useState("");
  const [bestPayoutNetwork, setBestPayoutNetwork] = useState("");
  // 情报
  const [spyfuKeywords, setSpyfuKeywords] = useState("");
  const [spyfuBudgetTrend, setSpyfuBudgetTrend] = useState("");
  const [competitorAds, setCompetitorAds] = useState("");
  const [similarwebNotes, setSimilarwebNotes] = useState("");
  const [targetMargin, setTargetMargin] = useState("50");
  const [notes, setNotes] = useState("");

  // 关键词
  const [keywords, setKeywords] = useState<KwRow[]>([newKwRow()]);
  const [kwImportOpen, setKwImportOpen] = useState(false);
  const [kwImportText, setKwImportText] = useState("");

  // 否定词
  const [negatives, setNegatives] = useState<string[]>([]);
  const [negInput, setNegInput] = useState("");
  const [negImportOpen, setNegImportOpen] = useState(false);
  const [negImportText, setNegImportText] = useState("");

  // 分析
  const [analyzing, setAnalyzing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<TrafficPlanResult | null>(null);

  const comboKey = `${mode}_${brandPolicy}`;
  const comboBadge = useMemo(() => {
    if (comboKey === "landing_allowed") return { text: d.comboA, cls: "bg-emerald-100 text-emerald-800" };
    if (comboKey === "direct_forbidden") return { text: d.comboD, cls: "bg-red-100 text-red-800" };
    return { text: "", cls: "" };
  }, [comboKey, d]);

  const numOrUndef = (s: string): number | undefined => {
    const n = Number(s);
    return s.trim() !== "" && Number.isFinite(n) ? n : undefined;
  };

  /* ----- 关键词操作 ----- */
  const updateKw = (id: string, field: keyof KwRow, value: string) => {
    setKeywords((ks) =>
      ks.map((k) => (k.id === id ? { ...k, [field]: value } : k))
    );
  };
  const updateKwNum = (id: string, field: keyof KwRow, value: string) => {
    setKeywords((ks) =>
      ks.map((k) => (k.id === id ? { ...k, [field]: value === "" ? undefined : Number(value) } : k))
    );
  };
  const removeKw = (id: string) =>
    setKeywords((ks) => (ks.length > 1 ? ks.filter((k) => k.id !== id) : ks));

  /** 用 offer 库参数填充 offer 区块（名称/佣金/渠道） */
  const fillFromOffer = (o: PlannerOffer) => {
    setSelectedOfferId(o.id || null);
    setOfferName(o.name);
    setNetwork(o.network);
    const p = payoutFromOffer(o);
    if (p) setPayout(p);
  };

  /** 快照：全部输入（按 offer 隔离保存，刷新/隔夜不丢） */
  const buildSnapshot = () => ({
    version: 1,
    mode,
    brandPolicy,
    offerName,
    payout,
    network,
    cookieDays,
    epc,
    networkCvr,
    refundRate,
    bestPayout,
    bestPayoutNetwork,
    spyfuKeywords,
    spyfuBudgetTrend,
    competitorAds,
    similarwebNotes,
    targetMargin,
    notes,
    keywords: keywords.map(({ id: _id, ...r }) => r),
    negatives,
  });
  const snapshotMeaningful = (s: Record<string, unknown>) =>
    Boolean(
      (s.offerName as string)?.trim() ||
        (s.payout as string)?.toString().trim() ||
        ((s.keywords as Array<{ keyword?: string }>) ?? []).some((k) =>
          k.keyword?.trim()
        ) ||
        (s.spyfuKeywords as string)?.trim() ||
        (s.competitorAds as string)?.trim() ||
        (s.similarwebNotes as string)?.trim()
    );
  const applySnapshot = (s: Record<string, unknown>) => {
    const str = (v: unknown) => (v == null ? "" : String(v));
    if (s.mode === "landing" || s.mode === "direct") setMode(s.mode);
    if (s.brandPolicy === "allowed" || s.brandPolicy === "forbidden")
      setBrandPolicy(s.brandPolicy);
    setOfferName(str(s.offerName));
    setPayout(str(s.payout));
    setNetwork(str(s.network));
    setCookieDays(str(s.cookieDays));
    setEpc(str(s.epc));
    setNetworkCvr(str(s.networkCvr));
    setRefundRate(str(s.refundRate));
    setBestPayout(str(s.bestPayout));
    setBestPayoutNetwork(str(s.bestPayoutNetwork));
    setSpyfuKeywords(str(s.spyfuKeywords));
    setSpyfuBudgetTrend(str(s.spyfuBudgetTrend));
    setCompetitorAds(str(s.competitorAds));
    setSimilarwebNotes(str(s.similarwebNotes));
    if (s.targetMargin != null) setTargetMargin(str(s.targetMargin));
    setNotes(str(s.notes));
    const ks = s.keywords as TrafficPlanKeywordInput[] | undefined;
    if (Array.isArray(ks) && ks.length > 0) {
      setKeywords(
        ks.map((k) => ({ ...newKwRow(), ...k, keyword: str(k.keyword) }))
      );
    }
    if (Array.isArray(s.negatives))
      setNegatives((s.negatives as unknown[]).map((x) => String(x)));
  };

  const { restored } = useWorkState({
    page: "traffic-planner",
    offerId: selectedOfferId,
    label: offerName || null,
    buildSnapshot,
    isMeaningful: snapshotMeaningful,
    applySnapshot,
    watch: [
      selectedOfferId,
      mode,
      brandPolicy,
      offerName,
      payout,
      network,
      cookieDays,
      epc,
      networkCvr,
      refundRate,
      bestPayout,
      bestPayoutNetwork,
      spyfuKeywords,
      spyfuBudgetTrend,
      competitorAds,
      similarwebNotes,
      targetMargin,
      notes,
      keywords,
      negatives,
    ],
  });
  const appliedInputsRef = useRef<string | null>(null);

  /* 上游 ③ 的值：恢复完成后应用（只覆盖 payout/CVR/退款率三个字段） */
  useEffect(() => {
    if (!restored || !initialInputs) return;
    const key = JSON.stringify(initialInputs);
    if (appliedInputsRef.current === key) return;
    appliedInputsRef.current = key;
    if (initialInputs.payout != null) setPayout(initialInputs.payout);
    if (initialInputs.cvr != null) setNetworkCvr(initialInputs.cvr);
    if (initialInputs.refundRate != null) setRefundRate(initialInputs.refundRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, initialInputs]);

  /** 工作表嵌入时：上层 offer 变化 → 同步填充（每个 offer 只自动填一次，不覆盖手改） */
  useEffect(() => {
    const key = initialOffer ? `${initialOffer.id}::${initialOffer.name}` : null;
    if (key && appliedOfferRef.current !== key) {
      appliedOfferRef.current = key;
      fillFromOffer(initialOffer!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOffer]);

  /** 下拉切换 offer：先填库参数，再恢复该 offer 的 planner 快照（有则覆盖） */
  const onSelectOffer = async (id: string) => {
    const o = (offers ?? []).find((x) => x.id === id) ?? null;
    if (!o) {
      setSelectedOfferId(null);
      return;
    }
    fillFromOffer(o);
    try {
      const res = await loadWorkStateAction("traffic-planner", o.id);
      if (res.ok && res.data.state && snapshotMeaningful(res.data.state)) {
        applySnapshot(res.data.state);
      }
    } catch {
      /* 恢复失败不打断 */
    }
  };

  /** 从投放选词页导入该 offer 的关键词（去重） */
  const importLaunchKeywords = async () => {
    if (!selectedOfferId) {
      setMsg(d.selectOfferFirst);
      return;
    }
    try {
      const res = await loadWorkStateAction("keyword-launch", selectedOfferId);
      const rows = (res.ok && res.data.state
        ? (res.data.state.rows as Array<{
            keyword?: string;
            refCpc?: string;
          }>)
        : []) as Array<{ keyword?: string; refCpc?: string }>;
      const valid = (rows ?? []).filter((r) => r.keyword?.trim());
      if (valid.length === 0) {
        setMsg(d.noLaunchData);
        return;
      }
      const existing = new Set(
        keywords.map((k) => k.keyword.trim().toLowerCase()).filter(Boolean)
      );
      const toAdd = valid.filter(
        (r) => !existing.has(r.keyword!.trim().toLowerCase())
      );
      if (toAdd.length === 0) {
        setMsg(d.alreadyImported);
        return;
      }
      setKeywords((ks) => {
        const base = ks.some((k) => !k.keyword.trim())
          ? ks.filter((k) => k.keyword.trim())
          : ks;
        return [
          ...base,
          ...toAdd.map((r) => ({
            ...newKwRow(),
            keyword: r.keyword!.trim(),
            cpc: r.refCpc && Number(r.refCpc) > 0 ? Number(r.refCpc) : undefined,
          })),
        ];
      });
      setMsg(d.importedKeywords.replace("{n}", String(toAdd.length)));
    } catch {
      setMsg(d.noLaunchData);
    }
  };

  /** 插件抓取填入关键词行：解析 SEMrush/Planner 页面，填首个空行或追加新行 */
  const fillKwFromCapture = async (c: OfferCaptureItem) => {
    const r = await parseKeywordCaptureAction(c.id);
    if (!r.ok) return;
    const d = r.data;
    // 表格多行（SEMrush 关键词变化表等）：去重后全部并入表
    if (d.rows && d.rows.length > 0) {
      setKeywords((ks) => {
        const existing = new Set(
          ks.map((k) => k.keyword.trim().toLowerCase()).filter(Boolean)
        );
        const fresh = d.rows!.filter(
          (row) => row.keyword && !existing.has(row.keyword.toLowerCase())
        );
        if (fresh.length === 0) return ks;
        const rows = fresh.map((row) => ({
          ...newKwRow(),
          keyword: row.keyword,
          volume: row.volume ?? undefined,
          cpc: row.cpc ?? undefined,
          competition: row.competition ?? undefined,
        }));
        const next = [...ks];
        const idx = next.findIndex((k) => !k.keyword.trim());
        if (idx >= 0) {
          next[idx] = { ...next[idx], ...rows[0] };
          return [...next, ...rows.slice(1)];
        }
        return [...next, ...rows];
      });
      return;
    }
    const patch: Partial<KwRow> = {};
    if (d.keyword) patch.keyword = d.keyword;
    if (d.volume != null) patch.volume = d.volume;
    if (d.cpc != null) patch.cpc = d.cpc;
    if (d.plannerLow != null) patch.plannerLow = d.plannerLow;
    if (d.plannerHigh != null) patch.plannerHigh = d.plannerHigh;
    if (d.competition) patch.competition = d.competition;
    setKeywords((ks) => {
      const idx = ks.findIndex((k) => !k.keyword.trim());
      if (idx >= 0) {
        const next = [...ks];
        next[idx] = { ...next[idx], ...patch };
        return next;
      }
      return [...ks, { ...newKwRow(), ...patch }];
    });
  };

  const importKeywords = () => {    const rows: KwRow[] = [];
    for (const line of kwImportText.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (t.includes(",")) {
        const [kw, vol, cpc, low, high] = t.split(",").map((s) => s.trim());
        if (!kw) continue;
        rows.push({
          id: `kw-${++kwSeq}`,
          keyword: kw,
          volume: vol ? Number(vol) || undefined : undefined,
          cpc: cpc ? Number(cpc) || undefined : undefined,
          plannerLow: low ? Number(low) || undefined : undefined,
          plannerHigh: high ? Number(high) || undefined : undefined,
        });
      } else {
        rows.push({ id: `kw-${++kwSeq}`, keyword: t });
      }
    }
    if (rows.length) {
      setKeywords((ks) => {
        const base = ks.length === 1 && !ks[0].keyword ? [] : ks;
        return [...base, ...rows];
      });
    }
    setKwImportText("");
    setKwImportOpen(false);
  };

  /* ----- 否定词操作 ----- */
  const autoNegatives = () => {
    const all = new Set<string>(negatives);
    Object.values(UNIVERSAL_NEGATIVES).forEach((arr) => arr.forEach((w) => all.add(w)));
    if (brandPolicy === "forbidden" && offerName.trim()) {
      // 品牌词大扫除：品牌名及常见变体
      const brand = offerName.trim().split(/\s+/)[0];
      [brand, `${brand}官网`, `${brand}客服`, `${brand}官方`].forEach((w) => all.add(w));
    }
    setNegatives([...all]);
  };
  const addNegative = (w: string) => {
    const t = w.trim();
    if (t && !negatives.includes(t)) setNegatives((ns) => [...ns, t]);
  };
  const importNegatives = () => {
    const words = negImportText.split(/[\n,，、]/).map((s) => s.trim()).filter(Boolean);
    setNegatives((ns) => [...new Set([...ns, ...words])]);
    setNegImportText("");
    setNegImportOpen(false);
  };
  const exportNegatives = async () => {
    const text = negatives.join("\n");
    await navigator.clipboard.writeText(text);
    setMsg(d.copied);
    setTimeout(() => setMsg(null), 2000);
  };

  /* ----- 分析 ----- */
  const onAnalyze = async () => {
    setMsg(null);
    if (!offerName.trim()) {
      setMsg(d.needOfferName);
      return;
    }
    setAnalyzing(true);
    try {
      const validKeywords = keywords
        .filter((k) => k.keyword.trim())
        .map(({ id: _id, ...rest }) => ({
          ...rest,
          keyword: rest.keyword.trim(),
        }));
      const res: AiActionResult<TrafficPlanResult> = await analyzeTrafficPlanAction({
        mode,
        brandPolicy,
        offerName: offerName.trim(),
        payout: numOrUndef(payout),
        network: network.trim() || undefined,
        cookieDays: numOrUndef(cookieDays),
        epc: numOrUndef(epc),
        networkCvr: numOrUndef(networkCvr),
        refundRate: numOrUndef(refundRate),
        bestPayout: numOrUndef(bestPayout),
        bestPayoutNetwork: bestPayoutNetwork.trim() || undefined,
        competitorAds: competitorAds.trim() || undefined,
        spyfuKeywords: spyfuKeywords.trim() || undefined,
        spyfuBudgetTrend: spyfuBudgetTrend || undefined,
        similarwebNotes: similarwebNotes.trim() || undefined,
        keywords: validKeywords,
        negativeKeywords: negatives,
        targetProfitMargin: (numOrUndef(targetMargin) ?? 50) / 100,
        notes: notes.trim() || undefined,
      });
      if (res.ok) {
        setResult(res.data);
        setMsg(null);
        onResult?.(res.data);
      } else {
        setMsg(`${d.failed}：${res.error}`);
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const siteBtn = (site: string, query = "") => (
    <a
      href={siteUrl(site, query)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-lg bg-signal/10 px-2.5 py-1 text-xs font-medium text-signal transition hover:bg-signal/20"
    >
      ↗ {d.openSite}
    </a>
  );

  const sectionHead = (title: string, site: string, hint: string, query = "", key = false) => (
    <div className="mb-3 flex items-start justify-between gap-2">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {key && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">★ {d.keyField}</span>
          )}
        </div>
        <p className="mt-1 text-xs text-ink/50">{hint}</p>
      </div>
      {siteBtn(site, query)}
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      {hideHeader ? null : (
        <div>
          <h1 className="text-xl font-bold text-ink">{d.title}</h1>
          <p className="mt-1 text-sm text-ink/60">{d.subtitle}</p>
        </div>
      )}

      {!hideHeader && (
        <OfferPipelineNav
          current="planner"
          offerId={selectedOfferId}
          offerName={offerName || null}
          offerNetwork={network || null}
          offers={(offers ?? []).map((o) => ({ id: o.id, name: o.name, network: o.network }))}
          onSelectOffer={onSelectOffer}
        />
      )}


      {showSetupNudge && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {d.needAiSetup}{" "}
          <a href="/admin/ai-settings" className="font-medium underline">
            {d.goToAiSettings}
          </a>
        </div>
      )}

      {/* Step 1 */}
      <section className={cardCls}>
        <h2 className="mb-3 text-base font-semibold text-ink">{d.step1}</h2>
        <p className={labelCls}>{d.mode}</p>
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              { v: "landing" as Mode, t: d.modeLanding, desc: d.modeLandingDesc },
              { v: "direct" as Mode, t: d.modeDirect, desc: d.modeDirectDesc },
            ]
          ).map((o) => (
            <button
              key={o.v}
              onClick={() => setMode(o.v)}
              className={`rounded-xl border p-3 text-left transition ${
                mode === o.v
                  ? "border-signal bg-signal/5 ring-1 ring-signal"
                  : "border-ink/15 hover:border-ink/30"
              }`}
            >
              <div className="text-sm font-semibold text-ink">{o.t}</div>
              <div className="mt-1 text-xs text-ink/60">{o.desc}</div>
            </button>
          ))}
        </div>
        <p className={labelCls}>{d.brandPolicy}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              { v: "allowed" as BrandPolicy, t: d.brandAllowed, desc: d.brandAllowedDesc },
              { v: "forbidden" as BrandPolicy, t: d.brandForbidden, desc: d.brandForbiddenDesc },
            ]
          ).map((o) => (
            <button
              key={o.v}
              onClick={() => setBrandPolicy(o.v)}
              className={`rounded-xl border p-3 text-left transition ${
                brandPolicy === o.v
                  ? "border-signal bg-signal/5 ring-1 ring-signal"
                  : "border-ink/15 hover:border-ink/30"
              }`}
            >
              <div className="text-sm font-semibold text-ink">{o.t}</div>
              <div className="mt-1 text-xs text-ink/60">{o.desc}</div>
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm text-ink/70">
          <span>{d.comboHint}：</span>
          <span className="font-medium text-ink">
            {mode === "landing" ? d.modeLanding : d.modeDirect} +{" "}
            {brandPolicy === "allowed" ? d.brandAllowed : d.brandForbidden}
          </span>
          {comboBadge.text && (
            <span className={`rounded px-1.5 py-0.5 text-xs ${comboBadge.cls}`}>
              {comboBadge.text}
            </span>
          )}
        </div>
      </section>

      {/* Step 2 */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-ink">{d.step2}</h2>
        <p className="text-sm text-ink/60">{d.dataSources}</p>

        {/* Offer 基础 */}
        <div className={cardCls}>
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-ink">{d.offerSection}</h3>
            <CapturePicker
              onPick={(c) => {
                if (c.title) setOfferName(c.title);
              }}
            />
          </div>
          {offers && offers.length > 0 && (
            <div className="mb-3">
              <select
                value={selectedOfferId ?? ""}
                onChange={(e) => onSelectOffer(e.target.value)}
                className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-signal sm:max-w-xs"
              >
                <option value="">{d.selectOffer}</option>
                {offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}（{o.network}）
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink/50">{d.selectOfferHint}</p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>{d.offerName} <span className="text-red-500">*</span></span>
              <input className={inputCls} value={offerName} onChange={(e) => setOfferName(e.target.value)} placeholder={d.offerNameHint} />
            </label>
            <label className="block">
              <span className={labelCls}>{d.payout}</span>
              <span className={hintCls}>{d.payoutHint}</span>
              <input className={inputCls} type="number" min="0" step="0.01" value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="20" />
            </label>
            <label className="block">
              <span className={labelCls}>{d.network}</span>
              <input className={inputCls} value={network} onChange={(e) => setNetwork(e.target.value)} placeholder={d.networkHint} />
            </label>
            <label className="block">
              <span className={labelCls}>{d.cookieDays}</span>
              <span className={hintCls}>{d.cookieDaysHint}</span>
              <input className={inputCls} type="number" min="0" value={cookieDays} onChange={(e) => setCookieDays(e.target.value)} placeholder="30" />
            </label>
          </div>
        </div>

        {/* EPC */}
        <div className={cardCls}>
          {sectionHead(d.epcSection, "offervault", d.epcHint, offerName, true)}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className={labelCls}>{d.epc}</span>
              <input className={inputCls} type="number" min="0" step="0.01" value={epc} onChange={(e) => setEpc(e.target.value)} placeholder="0.50" />
            </label>
            <label className="block">
              <span className={labelCls}>{d.networkCvr}</span>
              <input className={inputCls} type="number" min="0" step="0.1" value={networkCvr} onChange={(e) => setNetworkCvr(e.target.value)} placeholder="3.5" />
            </label>
            <label className="block">
              <span className={labelCls}>{d.refundRate}</span>
              <span className={hintCls}>{d.refundRateHint}</span>
              <input className={inputCls} type="number" min="0" step="0.1" value={refundRate} onChange={(e) => setRefundRate(e.target.value)} placeholder="5" />
            </label>
          </div>
          {/* 电商查询：电商 offer 在 Offervault 没有数据，直接查产品本身 */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-3">
            <span className="text-xs font-medium text-ink/70">{d.ecomQuery}：</span>
            <a href={siteUrl("amazon", offerName)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-signal/10 px-2.5 py-1 text-xs font-medium text-signal transition hover:bg-signal/20">
              ↗ {d.amazonSearch}
            </a>
            <a href={siteUrl("keepa", offerName)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-signal/10 px-2.5 py-1 text-xs font-medium text-signal transition hover:bg-signal/20">
              ↗ {d.keepaPrice}
            </a>
            <a href={siteUrl("gshopping", offerName)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-signal/10 px-2.5 py-1 text-xs font-medium text-signal transition hover:bg-signal/20">
              ↗ {d.googleShopping}
            </a>
            <span className="text-xs text-ink/50">{d.ecomQueryHint}</span>
          </div>
        </div>

        {/* Offervault */}
        <div className={cardCls}>
          {sectionHead(d.offervaultSection, "offervault", d.bestPayoutHint, offerName)}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>{d.bestPayout}</span>
              <input className={inputCls} type="number" min="0" step="0.01" value={bestPayout} onChange={(e) => setBestPayout(e.target.value)} placeholder="22" />
            </label>
            <label className="block">
              <span className={labelCls}>{d.bestPayoutNetwork}</span>
              <input className={inputCls} value={bestPayoutNetwork} onChange={(e) => setBestPayoutNetwork(e.target.value)} />
            </label>
          </div>
        </div>

        {/* SEMRUSH + Planner 关键词表 */}
        <div className={cardCls}>
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-ink">{d.semrushSection} / {d.plannerSection}</h3>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">★ {d.keyField}</span>
              </div>
              <p className="mt-1 text-xs text-ink/50">{d.semrushHint}</p>
              <p className="mt-0.5 text-xs text-ink/50">{d.plannerHint}</p>
            </div>
            <div className="flex gap-1">
              {siteBtn("semrush")}
              {siteBtn("planner")}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink/50">
                  <th className="pb-2 pr-2">{d.colKeyword}</th>
                  <th className="pb-2 pr-2">{d.kwVolume}</th>
                  <th className="pb-2 pr-2">{d.kwCpc}</th>
                  <th className="pb-2 pr-2">{d.kwLow}</th>
                  <th className="pb-2 pr-2">{d.kwHigh}</th>
                  <th className="pb-2 pr-2">{d.kwComp}</th>
                  <th className="pb-2 pr-2">{d.kwIntent}</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {keywords.map((k) => (
                  <tr key={k.id} className="border-t border-ink/10">
                    <td className="py-1 pr-2">
                      <input className={inputCls} value={k.keyword} onChange={(e) => updateKw(k.id, "keyword", e.target.value)} placeholder="best vpn 2026" />
                    </td>
                    <td className="py-1 pr-2">
                      <input className={inputCls} type="number" min="0" value={k.volume ?? ""} onChange={(e) => updateKwNum(k.id, "volume", e.target.value)} placeholder="10000" />
                    </td>
                    <td className="py-1 pr-2">
                      <input className={inputCls} type="number" min="0" step="0.01" value={k.cpc ?? ""} onChange={(e) => updateKwNum(k.id, "cpc", e.target.value)} placeholder="1.50" />
                    </td>
                    <td className="py-1 pr-2">
                      <input className={inputCls} type="number" min="0" step="0.01" value={k.plannerLow ?? ""} onChange={(e) => updateKwNum(k.id, "plannerLow", e.target.value)} placeholder="0.80" />
                    </td>
                    <td className="py-1 pr-2">
                      <input className={inputCls} type="number" min="0" step="0.01" value={k.plannerHigh ?? ""} onChange={(e) => updateKwNum(k.id, "plannerHigh", e.target.value)} placeholder="2.50" />
                    </td>
                    <td className="py-1 pr-2">
                      <select className={inputCls} value={k.competition ?? ""} onChange={(e) => updateKw(k.id, "competition", e.target.value)}>
                        <option value="">-</option>
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <input className={inputCls} value={k.intent ?? ""} onChange={(e) => updateKw(k.id, "intent", e.target.value)} placeholder="交易" />
                    </td>
                    <td className="py-1">
                      <button className={btnGhost} onClick={() => removeKw(k.id)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className={btnGhost} onClick={() => setKeywords((ks) => [...ks, newKwRow()])}>
              + {d.addKeyword}
            </button>
            <button className={btnGhost} onClick={() => setKwImportOpen(!kwImportOpen)}>
              {d.importKeywords}
            </button>
            <button className={btnGhost} onClick={importLaunchKeywords}>
              {d.importLaunchKeywords}
            </button>
          </div>
          <CapturePicker onPick={fillKwFromCapture} />
          {kwImportOpen && (
            <div className="mt-2">
              <textarea
                className={`${inputCls} h-24`}
                value={kwImportText}
                onChange={(e) => setKwImportText(e.target.value)}
                placeholder={d.importPlaceholder}
              />
              <button className={`${btnPrimary} mt-2`} onClick={importKeywords}>
                {d.importKeywords}
              </button>
            </div>
          )}
        </div>

        {/* 否定词 */}
        <div className={cardCls}>
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">
                {d.negatives}（{negatives.length}）
              </h3>
              <p className="mt-1 text-xs text-ink/50">
                {lang === "zh"
                  ? "AI 自动生成通用否定词库（售后/白嫖/求职/二手/信息/本地类），不可投品牌词组合会自动追加品牌词"
                  : "Auto-generates universal negatives; forbidden-brand combos append brand terms"}
              </p>
            </div>
            <div className="flex gap-1">
              <button className={btnGhost} onClick={autoNegatives}>{d.autoNegatives}</button>
              <button className={btnGhost} onClick={exportNegatives}>{d.exportNegatives}</button>
            </div>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {negatives.map((w) => (
              <span key={w} className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-2.5 py-1 text-xs text-ink/80">
                {w}
                <button
                  className="text-ink/40 hover:text-red-500"
                  onClick={() => setNegatives((ns) => ns.filter((x) => x !== w))}
                >
                  ×
                </button>
              </span>
            ))}
            {negatives.length === 0 && (
              <span className="text-xs text-ink/40">—</span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              className={inputCls}
              value={negInput}
              onChange={(e) => setNegInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addNegative(negInput);
                  setNegInput("");
                }
              }}
              placeholder={d.negativePlaceholder}
            />
            <button
              className={btnGhost}
              onClick={() => {
                addNegative(negInput);
                setNegInput("");
              }}
            >
              {d.addNegative}
            </button>
            <button className={btnGhost} onClick={() => setNegImportOpen(!negImportOpen)}>
              {d.importNegatives}
            </button>
          </div>
          <CapturePicker
            onPick={(c) => {
              setNegImportText(c.text.slice(0, 2000));
              setNegImportOpen(true);
            }}
          />
          {negImportOpen && (
            <div className="mt-2">
              <textarea
                className={`${inputCls} h-20`}
                value={negImportText}
                onChange={(e) => setNegImportText(e.target.value)}
                placeholder={lang === "zh" ? "每行一个，或用逗号分隔" : "One per line, or comma-separated"}
              />
              <button className={`${btnPrimary} mt-2`} onClick={importNegatives}>
                {d.importNegatives}
              </button>
            </div>
          )}
        </div>

        {/* SpyFu */}
        <div className={cardCls}>
          {sectionHead(d.spyfuSection, "spyfu", d.spyfuHint, network || offerName)}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>{d.spyfuKeywords}</span>
              <textarea className={`${inputCls} h-20`} value={spyfuKeywords} onChange={(e) => setSpyfuKeywords(e.target.value)} placeholder={lang === "zh" ? "比如：对手投 best vpn、vpn deal 等 20 个词" : "e.g. competitor bids on 20 keywords like best vpn"} />
            </label>
            <label className="block">
              <span className={labelCls}>{d.spyfuBudgetTrend}</span>
              <select className={inputCls} value={spyfuBudgetTrend} onChange={(e) => setSpyfuBudgetTrend(e.target.value)}>
                <option value="">{d.optional}</option>
                <option value="up">{d.budgetUp}</option>
                <option value="flat">{d.budgetFlat}</option>
                <option value="down">{d.budgetDown}</option>
              </select>
            </label>
          </div>
          <CapturePicker onPick={(c) => setSpyfuKeywords(c.text.slice(0, 2000))} />
        </div>

        {/* Transparency */}
        <div className={cardCls}>
          {sectionHead(d.transparencySection, "transparency", d.transparencyHint, offerName)}
          <label className="block">
            <span className={labelCls}>{d.competitorAds}</span>
            <textarea className={`${inputCls} h-20`} value={competitorAds} onChange={(e) => setCompetitorAds(e.target.value)} placeholder={d.competitorAdsHint} />
          </label>
          <CapturePicker onPick={(c) => setCompetitorAds(c.text.slice(0, 2000))} />
        </div>

        {/* SimilarWeb */}
        <div className={cardCls}>
          {sectionHead(d.similarwebSection, "similarweb", d.similarwebHint, network)}
          <label className="block">
            <span className={labelCls}>{d.similarwebNotes}</span>
            <textarea className={`${inputCls} h-20`} value={similarwebNotes} onChange={(e) => setSimilarwebNotes(e.target.value)} placeholder={lang === "zh" ? "比如：对手搜索流量占 65%，可复制" : "e.g. 65% search traffic, replicable"} />
          </label>
          <CapturePicker onPick={(c) => setSimilarwebNotes(c.text.slice(0, 2000))} />
        </div>

        {/* 其他 */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>{d.targetMargin}（%）</span>
              <span className={hintCls}>{d.targetMarginHint}</span>
              <input className={inputCls} type="number" min="1" max="95" value={targetMargin} onChange={(e) => setTargetMargin(e.target.value)} />
            </label>
            <label className="block">
              <span className={labelCls}>{d.notes}</span>
              <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
        </div>
      </section>

      {/* Step 3 */}
      <section className={cardCls}>
        <h2 className="mb-3 text-base font-semibold text-ink">{d.step3}</h2>
        {msg && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
            {msg}
          </div>
        )}
        <button className={btnPrimary} disabled={analyzing} onClick={onAnalyze}>
          {analyzing ? d.analyzing : d.analyze}
        </button>

        {result && (
          <div className="mt-4">
            {result.math.epcVerdict && (
              <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                ★ {result.math.epcVerdict}
              </div>
            )}
            {result.math.rows.length > 0 && (
              <div className="mb-4 overflow-x-auto">
                <h3 className="mb-2 text-sm font-semibold text-ink">{d.mathTable}</h3>
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink/50">
                      <th className="pb-1 pr-2">{d.colKeyword}</th>
                      <th className="pb-1 pr-2">{d.colRefCpc}</th>
                      <th className="pb-1 pr-2">{d.colBreakEven}</th>
                      <th className="pb-1 pr-2">{d.colMaxBid}</th>
                      <th className="pb-1">{d.colVerdict}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.math.rows.map((r) => (
                      <tr key={r.keyword} className="border-t border-ink/10">
                        <td className="py-1.5 pr-2 font-medium">{r.keyword}</td>
                        <td className="py-1.5 pr-2">{r.refCpc != null ? `$${r.refCpc.toFixed(2)}` : "-"}</td>
                        <td className="py-1.5 pr-2">{r.breakEvenCvrPct != null ? `${r.breakEvenCvrPct.toFixed(1)}%` : "-"}</td>
                        <td className="py-1.5 pr-2">{r.maxBid != null ? `$${r.maxBid.toFixed(2)}` : "-"}</td>
                        <td className="py-1.5">
                          <span className={`rounded px-1.5 py-0.5 text-xs ${
                            r.affordable === true ? "bg-emerald-100 text-emerald-800"
                            : r.affordable === false ? "bg-red-100 text-red-800"
                            : "bg-ink/10 text-ink/60"
                          }`}>
                            {r.verdict}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h3 className="mb-2 text-sm font-semibold text-ink">{d.report}</h3>
            <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
              {renderMarkdown(result.report)}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
