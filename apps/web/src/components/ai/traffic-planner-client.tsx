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
  parseKeywordCaptureAiAction,
  parseIntelCaptureAction,
  parseEcommerceCaptureAction,
  type AiActionResult,
} from "@/lib/api/ai-actions";
import { loadWorkStateAction } from "@/lib/api/work-state-actions";
import { checkKeywordsAction, type KeywordCheckResult } from "@/lib/api/keyword-check-actions";
import { calcProfit } from "@/lib/profit-calc";
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
/** 盈利模式：电商（按比例佣金，payout 派生）/ 联盟（固定 payout，扣量）。与工作表 ③ 判定一致。 */
type ProfitMode = "ecommerce" | "affiliate";

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

  /* 盈利模式：老快照没有 profitMode 时，固定佣金 → 联盟，否则电商（与工作表 ③ 一致）。 */
  const [profitMode, setProfitMode] = useState<ProfitMode>(
    initialOffer?.commissionType === "fixed" ? "affiliate" : "ecommerce"
  );
  /** 电商：均价 / 佣金率（派生 payout 用）。 */
  const [avgPrice, setAvgPrice] = useState(
    initialOffer?.avgPrice != null ? String(initialOffer.avgPrice) : ""
  );
  const [commissionRate, setCommissionRate] = useState(
    initialOffer?.commissionType === "percentage" && initialOffer?.commissionValue != null
      ? String(initialOffer.commissionValue)
      : ""
  );
  /** 联盟：扣量假设（%），默认 0。 */
  const [shavePct, setShavePct] = useState("0");
  /** 出价参考：目标 ROI（%），默认 100。 */
  const [targetRoiPct, setTargetRoiPct] = useState("100");

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

  /* ③→④ 同步：工作表嵌入时，③ 盈利测算的输入变化后同步到 ④ 的 payout/CVR/退款率。
     useState 初始值只在挂载时生效，之前 ③ 改了之后 ④ 一直用旧值、重算也判不准。
     按值比较（父级每次渲染都会新建 initialInputs 对象）；挂载时 initialInputs 已由
     初始值 + 快照恢复处理，这里不重复覆盖——快照里的手改值优先。 */
  const appliedInputsKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialInputs) return;
    const key = `${initialInputs.payout ?? ""}::${initialInputs.cvr ?? ""}::${initialInputs.refundRate ?? ""}`;
    if (appliedInputsKeyRef.current === key) return;
    appliedInputsKeyRef.current = key;
    if (initialInputs.payout != null) setPayout(initialInputs.payout);
    if (initialInputs.cvr != null) setNetworkCvr(initialInputs.cvr);
    if (initialInputs.refundRate != null) setRefundRate(initialInputs.refundRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInputs]);
  // Offervault
  const [bestPayout, setBestPayout] = useState("");
  const [bestPayoutNetwork, setBestPayoutNetwork] = useState("");
  // 情报
  const [spyfuKeywords, setSpyfuKeywords] = useState("");
  const [spyfuBudgetTrend, setSpyfuBudgetTrend] = useState("");
  const [competitorAds, setCompetitorAds] = useState("");
  const [similarwebNotes, setSimilarwebNotes] = useState("");
  /** 电商产品数据：插件抓 Amazon/Keepa/Shopping 后填入，进 AI 输入。 */
  const [ecommerceNotes, setEcommerceNotes] = useState("");
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

  /* 电商派生 payout = 均价 × 佣金率% × (1 - 退货率%)，只读展示；缺参时为 null（诚实空状态）。 */
  const derivedPayout = useMemo(() => {
    if (profitMode !== "ecommerce") return null;
    const price = Number(avgPrice);
    const rate = Number(commissionRate);
    const refund = Number(refundRate);
    if (!Number.isFinite(price) || price <= 0) return null;
    if (!Number.isFinite(rate) || rate < 0) return null;
    const refundF = Number.isFinite(refund) ? Math.min(Math.max(refund, 0), 100) / 100 : 0;
    return price * (rate / 100) * (1 - refundF);
  }, [profitMode, avgPrice, commissionRate, refundRate]);

  /* 出价参考：EPC / 保本 CPC（= EPC）/ 推荐出价（= EPC ÷ (1 + 目标 ROI)），全部来自 profit-calc。
     电商用派生 payout（已扣退货，不再重复扣）；联盟用固定 payout 并扣 shave。payout/CVR 缺失时为 null。 */
  const bidCalc = useMemo(() => {
    const cvrF = Number(networkCvr) / 100;
    const roiF = Number(targetRoiPct) / 100;
    const base = profitMode === "ecommerce"
      ? derivedPayout
      : Number(payout) > 0 ? Number(payout) : null;
    if (base == null || base <= 0 || !Number.isFinite(cvrF) || cvrF <= 0) return null;
    return calcProfit({
      payout: base,
      cpc: 0,
      cvrF,
      refundF: 0,
      shaveF: profitMode === "affiliate" ? Math.min(Math.max(Number(shavePct) || 0, 0), 100) / 100 : 0,
      targetRoiF: Number.isFinite(roiF) && roiF >= 0 ? roiF : 1,
    });
  }, [profitMode, derivedPayout, payout, networkCvr, shavePct, targetRoiPct]);

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

  /** 用 offer 库参数填充 offer 区块（名称/佣金/渠道），并按佣金类型判盈利模式：
      按比例 → 电商（均价/佣金率）；固定 → 联盟（固定 payout）。快照恢复在后，会覆盖这里。 */
  const fillFromOffer = (o: PlannerOffer) => {
    setSelectedOfferId(o.id || null);
    setOfferName(o.name);
    setNetwork(o.network);
    const p = payoutFromOffer(o);
    if (o.commissionType === "percentage") {
      setProfitMode("ecommerce");
      if (o.avgPrice != null) setAvgPrice(String(o.avgPrice));
      if (o.commissionValue != null) setCommissionRate(String(o.commissionValue));
    } else if (o.commissionType === "fixed") {
      setProfitMode("affiliate");
    } else {
      setProfitMode("ecommerce");
    }
    if (p) setPayout(p);
  };

  /** 快照：全部输入（按 offer 隔离保存，刷新/隔夜不丢）。
      各模式字段分开存（电商的均价/佣金率/退货率、联盟的固定 payout/扣量），切换不污染。 */
  const buildSnapshot = () => ({
    version: 1,
    mode,
    brandPolicy,
    profitMode,
    avgPrice,
    commissionRate,
    shavePct,
    targetRoiPct,
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
    ecommerceNotes,
    targetMargin,
    notes,
    keywords: keywords.map(({ id: _id, ...r }) => r),
    negatives,
  });
  const snapshotMeaningful = (s: Record<string, unknown>) =>
    Boolean(
      (s.offerName as string)?.trim() ||
        (s.payout as string)?.toString().trim() ||
        (s.avgPrice as string)?.toString().trim() ||
        (s.commissionRate as string)?.toString().trim() ||
        ((s.keywords as Array<{ keyword?: string }>) ?? []).some((k) =>
          k.keyword?.trim()
        ) ||
        (s.spyfuKeywords as string)?.trim() ||
        (s.competitorAds as string)?.trim() ||
        (s.similarwebNotes as string)?.trim() ||
          (s.ecommerceNotes as string)?.trim()
    );
  const applySnapshot = (s: Record<string, unknown>) => {
    const str = (v: unknown) => (v == null ? "" : String(v));
    if (s.mode === "landing" || s.mode === "direct") setMode(s.mode);
    if (s.brandPolicy === "allowed" || s.brandPolicy === "forbidden")
      setBrandPolicy(s.brandPolicy);
    /* 盈利模式：老快照没有时不覆盖（已按 offer 佣金类型判过默认值）。 */
    if (s.profitMode === "ecommerce" || s.profitMode === "affiliate")
      setProfitMode(s.profitMode);
    /* 模式字段：快照为空时不覆盖（offer 库参数为准；空快照是"没填过"不是"清空"）。 */
    if (str(s.avgPrice)) setAvgPrice(str(s.avgPrice));
    if (str(s.commissionRate)) setCommissionRate(str(s.commissionRate));
    if (str(s.shavePct)) setShavePct(str(s.shavePct));
    if (str(s.targetRoiPct)) setTargetRoiPct(str(s.targetRoiPct));
    /* offer 字段：快照为空时不覆盖（库参数为准；空快照是"没填过"不是"清空"） */
    if (str(s.offerName)) setOfferName(str(s.offerName));
    if (str(s.payout)) setPayout(str(s.payout));
    if (str(s.network)) setNetwork(str(s.network));
    if (str(s.cookieDays)) setCookieDays(str(s.cookieDays));
    setEpc(str(s.epc));
    setNetworkCvr(str(s.networkCvr));
    setRefundRate(str(s.refundRate));
    setBestPayout(str(s.bestPayout));
    setBestPayoutNetwork(str(s.bestPayoutNetwork));
    setSpyfuKeywords(str(s.spyfuKeywords));
    setSpyfuBudgetTrend(str(s.spyfuBudgetTrend));
    setCompetitorAds(str(s.competitorAds));
    setSimilarwebNotes(str(s.similarwebNotes));
    setEcommerceNotes(str(s.ecommerceNotes));
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
      profitMode,
      avgPrice,
      commissionRate,
      shavePct,
      targetRoiPct,
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
      ecommerceNotes,
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

  /** 下拉切换 offer：先清空工作字段，再填库参数，最后恢复该 offer 的 planner 快照（有则覆盖） */
  const onSelectOffer = async (id: string) => {
    const o = (offers ?? []).find((x) => x.id === id) ?? null;
    if (!o) {
      setSelectedOfferId(null);
      return;
    }
    // 先清空：新 offer 没快照时不留上一个 offer 的数据。
    setMode("landing");
    setBrandPolicy("allowed");
    setAvgPrice("");
    setCommissionRate("");
    setShavePct("0");
    setPayout("");
    setCookieDays("");
    setEpc("");
    setNetworkCvr("");
    setRefundRate("");
    setBestPayout("");
    setBestPayoutNetwork("");
    setSpyfuKeywords("");
    setSpyfuBudgetTrend("");
    setCompetitorAds("");
    setSimilarwebNotes("");
    setEcommerceNotes("");
    setTargetMargin("50");
    setNotes("");
    setKeywords([newKwRow()]);
    setNegatives([]);
    setNegInput("");
    setKwImportText("");
    setNegImportText("");
    setResult(null);
    setMsg(null);
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

  /** 需求验证的枚举 → 投流表的值：竞争度 Low/Medium/High；意图用与需求验证页一致的标签 */
  const researchCompetition = (v?: string) =>
    v === "low" ? "Low" : v === "medium" ? "Medium" : v === "high" ? "High" : undefined;
  const researchIntent = (v?: string) => {
    const zhMap: Record<string, string> = { buy: "购买", review: "评测", compare: "对比", info: "纯信息" };
    const enMap: Record<string, string> = { buy: "Buy", review: "Review", compare: "Compare", info: "Informational" };
    return (lang === "en" ? enMap : zhMap)[v ?? ""] ?? undefined;
  };

  /** 从关键词页导入：投放选词（关键词 + 参考 CPC）+ 需求验证（搜索量 / 竞争度 / 意图），
      合并后填表；已有的词只补空参数，不覆盖手填。 */
  const importLaunchKeywords = async () => {
    if (!selectedOfferId) {
      setMsg(d.selectOfferFirst);
      return;
    }
    try {
      const [launchRes, researchRes] = await Promise.all([
        loadWorkStateAction("keyword-launch", selectedOfferId),
        loadWorkStateAction("keyword-research", selectedOfferId),
      ]);
      const launchRows = (launchRes.ok && launchRes.data.state
        ? (launchRes.data.state.rows as Array<{
            keyword?: string;
            refCpc?: string;
          }>)
        : []) as Array<{ keyword?: string; refCpc?: string }>;
      const researchRows = (researchRes.ok && researchRes.data.state
        ? (researchRes.data.state.rows as Array<{
            keyword?: string;
            volume?: string;
            competition?: string;
            intent?: string;
          }>)
        : []) as Array<{
        keyword?: string;
        volume?: string;
        competition?: string;
        intent?: string;
      }>;

      // 需求验证的参数（投放选词里没有这些字段），按关键词归一
      const researchByKw = new Map<
        string,
        { volume?: number; competition?: string; intent?: string }
      >();
      for (const r of researchRows ?? []) {
        const key = r.keyword?.trim().toLowerCase();
        if (!key || researchByKw.has(key)) continue;
        const vol = r.volume != null && r.volume !== "" ? Number(r.volume) : NaN;
        researchByKw.set(key, {
          volume: Number.isFinite(vol) && vol > 0 ? vol : undefined,
          competition: researchCompetition(r.competition),
          intent: researchIntent(r.intent),
        });
      }

      // 合并：投放选词为准（关键词 + 参考 CPC），需求验证补搜索量/竞争度/意图；
      // 需求验证里有、投放选词里没有的词也一并带入。
      type Merged = {
        keyword: string;
        cpc?: number;
        volume?: number;
        competition?: string;
        intent?: string;
      };
      const merged = new Map<string, Merged>();
      for (const r of launchRows ?? []) {
        const kw = r.keyword?.trim();
        if (!kw) continue;
        const key = kw.toLowerCase();
        const prev = merged.get(key) ?? { keyword: kw };
        const cpc = r.refCpc != null && r.refCpc !== "" ? Number(r.refCpc) : NaN;
        const rp = researchByKw.get(key) ?? {};
        merged.set(key, {
          ...prev,
          cpc: prev.cpc ?? (Number.isFinite(cpc) && cpc > 0 ? cpc : undefined),
          volume: prev.volume ?? rp.volume,
          competition: prev.competition ?? rp.competition,
          intent: prev.intent ?? rp.intent,
        });
      }
      for (const [key, rp] of researchByKw) {
        if (merged.has(key)) continue;
        const raw =
          (researchRows ?? []).find((r) => r.keyword?.trim().toLowerCase() === key)?.keyword?.trim() ?? key;
        merged.set(key, { keyword: raw, ...rp });
      }
      if (merged.size === 0) {
        setMsg(d.noLaunchData);
        return;
      }

      const existingByKey = new Map<string, KwRow>();
      for (const k of keywords) {
        const key = k.keyword.trim().toLowerCase();
        if (key) existingByKey.set(key, k);
      }
      const toAdd: KwRow[] = [];
      const patches = new Map<string, Partial<KwRow>>();
      let patched = 0;
      for (const m of merged.values()) {
        const ex = existingByKey.get(m.keyword.toLowerCase());
        if (!ex) {
          toAdd.push({
            ...newKwRow(),
            keyword: m.keyword,
            cpc: m.cpc,
            volume: m.volume,
            competition: m.competition,
            intent: m.intent,
          });
          continue;
        }
        // 已有的词：只补空参数，不覆盖手填
        const patch: Partial<KwRow> = {};
        if (ex.cpc == null && m.cpc != null) patch.cpc = m.cpc;
        if (ex.volume == null && m.volume != null) patch.volume = m.volume;
        if (!ex.competition && m.competition) patch.competition = m.competition;
        if (!ex.intent && m.intent) patch.intent = m.intent;
        if (Object.keys(patch).length > 0) {
          patches.set(ex.id, patch);
          patched++;
        }
      }
      setKeywords((ks) => {
        // 有新词时去掉空白行；只补参数时保留空白行
        const base =
          toAdd.length > 0 && ks.some((k) => !k.keyword.trim())
            ? ks.filter((k) => k.keyword.trim())
            : [...ks];
        const next = patches.size > 0
          ? base.map((k) => (patches.has(k.id) ? { ...k, ...patches.get(k.id) } : k))
          : base;
        return [...next, ...toAdd];
      });
      if (toAdd.length > 0) {
        setMsg(d.importedKeywords.replace("{n}", String(toAdd.length)));
      } else if (patched > 0) {
        setMsg(d.paramsFilled.replace("{n}", String(patched)));
      } else {
        setMsg(d.alreadyImported);
      }
    } catch {
      setMsg(d.noLaunchData);
    }
  };

  /** 插件抓取填入关键词行：解析 SEMrush/Planner 页面，填首个空行或追加新行 */
  /* 抓取选用：Amazon/Keepa/Shopping 页 → 产品数据追加到电商数据框 */
  const fillEcomFromCapture = async (c: OfferCaptureItem) => {
    const r = await parseEcommerceCaptureAction(c.id);
    if (!r.ok) return;
    const data = r.data;
    const parts: string[] = [];
    if (data.price != null) parts.push(`${d.ecomPriceLabel} $${data.price}`);
    if (data.rating != null) parts.push(`${d.ecomRatingLabel} ${data.rating}/5`);
    if (data.reviewCount != null) parts.push(`${d.ecomReviewsLabel} ${data.reviewCount}`);
    if (data.bsr != null)
      parts.push(`${d.ecomBsrLabel} #${data.bsr}${data.bsrCategory ? ` (${data.bsrCategory})` : ""}`);
    if (parts.length === 0) return;
    const line = `${c.title ? `${c.title}：` : ""}${parts.join(" · ")}`;
    setEcommerceNotes((prev) => (prev.trim() ? `${prev.trim()}\n${line}` : line));
  };

  /* 抓取选用：AI 先认表格、提取关键词+购买意图并填表；AI 失败时回落启发式解析 */
  const [kwParsing, setKwParsing] = useState(false);
  const appendKwRows = (rows: Array<{
    keyword: string;
    volume?: number | null;
    cpc?: number | null;
    plannerLow?: number | null;
    plannerHigh?: number | null;
    competition?: string | null;
    intent?: string | null;
  }>) => {
    const existing = new Set(
      keywords.map((k) => k.keyword.trim().toLowerCase()).filter(Boolean)
    );
    const fresh = rows.filter(
      (row) => row.keyword && !existing.has(row.keyword.toLowerCase())
    );
    if (fresh.length === 0) return 0;
    const mapped = fresh.map((row) => ({
      ...newKwRow(),
      keyword: row.keyword,
      volume: row.volume ?? undefined,
      cpc: row.cpc ?? undefined,
      plannerLow: row.plannerLow ?? undefined,
      plannerHigh: row.plannerHigh ?? undefined,
      competition: row.competition ?? undefined,
      intent: row.intent ?? undefined,
    }));
    setKeywords((ks) => {
      // 以最新 state 再去重一次，防连续点两次重复
      const latest = new Set(ks.map((k) => k.keyword.trim().toLowerCase()).filter(Boolean));
      const toAdd = mapped.filter((m) => !latest.has(m.keyword.toLowerCase()));
      if (toAdd.length === 0) return ks;
      const next = [...ks];
      const idx = next.findIndex((k) => !k.keyword.trim());
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...toAdd[0] };
        return [...next, ...toAdd.slice(1)];
      }
      return [...next, ...toAdd];
    });
    return fresh.length;
  };

  /* 情报抓取：AI 只提取该框要的内容（SpyFu/透明度/SimilarWeb/否定词），提不出不塞垃圾 */
  const [intelParsing, setIntelParsing] = useState<string | null>(null);
  const fillIntelFromCapture = async (
    kind: "spyfu" | "transparency" | "similarweb" | "negatives",
    c: OfferCaptureItem
  ) => {
    setIntelParsing(kind);
    try {
      const r = await parseIntelCaptureAction(c.id, kind);
      if (!r.ok || !r.data.summary) {
        setMsg(d.intelNone);
        return;
      }
      const summary = r.data.summary;
      if (kind === "spyfu") setSpyfuKeywords(summary);
      else if (kind === "transparency") setCompetitorAds(summary);
      else if (kind === "similarweb") setSimilarwebNotes(summary);
      else {
        setNegImportText(summary);
        setNegImportOpen(true);
      }
    } finally {
      setIntelParsing(null);
    }
  };

  const fillKwFromCapture = async (c: OfferCaptureItem) => {
    setKwParsing(true);
    setMsg(d.kwAiParsing);
    try {
      // 1) AI 提取：认表格、逐行提取、判断购买意图
      const ai = await parseKeywordCaptureAiAction(c.id);
      if (ai.ok && ai.data.rows.length > 0) {
        const added = appendKwRows(ai.data.rows);
        setMsg(
          added > 0
            ? d.kwAiExtracted.replace("{n}", String(added))
            : d.alreadyImported
        );
        return;
      }
      // 2) 回落启发式：表格多行 / 单词概览
      const r = await parseKeywordCaptureAction(c.id);
      if (!r.ok) {
        setMsg(ai.ok ? d.kwAiNone : d.kwAiFallback);
        return;
      }
      const data = r.data;
      if (data.rows && data.rows.length > 0) {
        const added = appendKwRows(data.rows);
        setMsg(added > 0 ? d.kwAiExtracted.replace("{n}", String(added)) : d.alreadyImported);
        return;
      }
      const added = appendKwRows([
        {
          keyword: data.keyword ?? "",
          volume: data.volume,
          cpc: data.cpc,
          plannerLow: data.plannerLow,
          plannerHigh: data.plannerHigh,
          competition: data.competition,
        },
      ]);
      setMsg(added > 0 ? d.kwAiExtracted.replace("{n}", String(added)) : d.kwAiNone);
    } finally {
      setKwParsing(false);
    }
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

  /* ----- 关键词 AI 检查：相关性 + 政策风险，投流前必查 ----- */
  const [kwChecking, setKwChecking] = useState(false);
  const [kwCheckResults, setKwCheckResults] = useState<KeywordCheckResult[] | null>(null);
  const [kwCheckError, setKwCheckError] = useState<string | null>(null);
  const [kwCheckMsg, setKwCheckMsg] = useState<string | null>(null);

  const kwCheckCounts = useMemo(() => {
    const counts = { relevant: 0, irrelevant: 0, risky: 0 };
    for (const r of kwCheckResults ?? []) {
      if (r.verdict === "irrelevant") counts.irrelevant++;
      else if (r.verdict === "risky") counts.risky++;
      else counts.relevant++;
    }
    return counts;
  }, [kwCheckResults]);

  const onCheckKeywords = async () => {
    const kws = keywords.map((k) => k.keyword.trim()).filter(Boolean);
    if (kws.length === 0) {
      setKwCheckError(d.kwCheckEmpty);
      return;
    }
    setKwChecking(true);
    setKwCheckError(null);
    setKwCheckMsg(null);
    setKwCheckResults(null);
    try {
      const res = await checkKeywordsAction({
        productDescription: [offerName, ecommerceNotes, notes]
          .map((s) => s.trim())
          .filter(Boolean)
          .join("\n"),
        offerName: offerName.trim(),
        keywords: kws,
      });
      if (res.ok) {
        setKwCheckResults(res.data.results);
      } else {
        setKwCheckError(`${d.kwCheckFailed}：${res.error}`);
      }
    } catch {
      setKwCheckError(d.kwCheckFailed);
    } finally {
      setKwChecking(false);
    }
  };

  /** 排除已标记关键词：把 irrelevant / risky 的词从本表（及快照）移除，不流向下游。 */
  const excludeFlaggedKeywords = () => {
    if (!kwCheckResults) return;
    const flagged = new Set(
      kwCheckResults
        .filter((r) => r.verdict !== "relevant")
        .map((r) => r.keyword.trim().toLowerCase())
    );
    if (flagged.size === 0) return;
    setKeywords((ks) => {
      const next = ks.filter((k) => !flagged.has(k.keyword.trim().toLowerCase()));
      return next.length > 0 ? next : [newKwRow()];
    });
    setKwCheckResults(null);
    setKwCheckMsg(d.kwCheckExcluded.replace("{n}", String(flagged.size)));
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
        /* 电商模式发派生 payout（已扣退货）；服务端保本计算不再重复扣退货。 */
        payout: profitMode === "ecommerce"
          ? (derivedPayout != null ? derivedPayout : undefined)
          : numOrUndef(payout),
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
        ecommerceNotes: ecommerceNotes.trim() || undefined,
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
        <p className={labelCls}>{d.profitMode}</p>
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              { v: "ecommerce" as ProfitMode, t: d.profitModeEcommerce, desc: d.profitModeEcommerceDesc },
              { v: "affiliate" as ProfitMode, t: d.profitModeAffiliate, desc: d.profitModeAffiliateDesc },
            ]
          ).map((o) => (
            <button
              key={o.v}
              onClick={() => setProfitMode(o.v)}
              className={`rounded-xl border p-3 text-left transition ${
                profitMode === o.v
                  ? "border-signal bg-signal/5 ring-1 ring-signal"
                  : "border-ink/15 hover:border-ink/30"
              }`}
            >
              <div className="text-sm font-semibold text-ink">{o.t}</div>
              <div className="mt-1 text-xs text-ink/60">{o.desc}</div>
            </button>
          ))}
        </div>
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
            {profitMode === "ecommerce" ? (
              <>
                <label className="block">
                  <span className={labelCls}>{d.avgPrice}</span>
                  <span className={hintCls}>{d.avgPriceHint}</span>
                  <input className={inputCls} type="number" min="0" step="0.01" value={avgPrice} onChange={(e) => setAvgPrice(e.target.value)} placeholder="65.88" />
                </label>
                <label className="block">
                  <span className={labelCls}>{d.commissionRate}</span>
                  <span className={hintCls}>{d.commissionRateHint}</span>
                  <input className={inputCls} type="number" min="0" step="0.1" value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} placeholder="40" />
                </label>
              </>
            ) : null}
            <label className="block">
              <span className={labelCls}>{profitMode === "ecommerce" ? d.derivedPayout : d.payout}</span>
              <span className={hintCls}>{profitMode === "ecommerce" ? d.derivedPayoutHint : d.payoutHint}</span>
              <input
                className={`${inputCls} ${profitMode === "ecommerce" ? "bg-ink/5 text-ink/60" : ""}`}
                type="number" min="0" step="0.01"
                value={profitMode === "ecommerce" ? (derivedPayout != null ? derivedPayout.toFixed(2) : "") : payout}
                onChange={(e) => { if (profitMode === "affiliate") setPayout(e.target.value); }}
                disabled={profitMode === "ecommerce"}
                placeholder="20"
              />
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
            {profitMode === "ecommerce" ? (
              <label className="block">
                <span className={labelCls}>{d.refundRate}</span>
                <span className={hintCls}>{d.refundRateHint}</span>
                <input className={inputCls} type="number" min="0" step="0.1" value={refundRate} onChange={(e) => setRefundRate(e.target.value)} placeholder="5" />
              </label>
            ) : (
              <label className="block">
                <span className={labelCls}>{d.shavePct}</span>
                <span className={hintCls}>{d.shaveHint}</span>
                <input className={inputCls} type="number" min="0" max="100" step="0.1" value={shavePct} onChange={(e) => setShavePct(e.target.value)} placeholder="0" />
              </label>
            )}
          </div>
          {/* 出价参考：EPC / 保本 CPC / 推荐出价（profit-calc 算出，指导值） */}
          <div className="mt-3 rounded-lg border border-ink/10 bg-ink/[0.02] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink">{d.bidGuide}</span>
              <label className="flex items-center gap-1.5 text-xs text-ink/70">
                {d.bidTargetRoi}
                <input
                  className="w-20 rounded-lg border border-ink/15 bg-white px-2 py-1 text-sm text-ink outline-none focus:border-signal"
                  type="number" min="0" step="10" value={targetRoiPct}
                  onChange={(e) => setTargetRoiPct(e.target.value)} placeholder="100"
                />
                %
              </label>
            </div>
            {bidCalc ? (
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-xs text-ink/50">{d.bidEpc}</div>
                  <div className="font-semibold text-ink">${bidCalc.epc.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-ink/50">{d.bidBreakEven}</div>
                  <div className="font-semibold text-ink">
                    ${bidCalc.breakEvenCpc != null ? bidCalc.breakEvenCpc.toFixed(2) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink/50">{d.bidRecommended}</div>
                  <div className="font-semibold text-signal">
                    ${bidCalc.maxCpcAtTargetRoi != null ? bidCalc.maxCpcAtTargetRoi.toFixed(2) : "—"}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-ink/50">{d.bidNoData}</p>
            )}
            <p className="mt-2 text-xs text-ink/50">{d.bidFormulaHint}</p>
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
          {/* 电商数据：插件抓 Amazon/Keepa/Shopping 页后选用填入，进 AI 输入 */}
          <div className="mt-3 border-t border-ink/10 pt-3">
            <label className={labelCls}>{d.ecomNotes}</label>
            <textarea className={`${inputCls} h-16`} value={ecommerceNotes} onChange={(e) => setEcommerceNotes(e.target.value)} placeholder={d.ecomNotesPh} />
            <div className="mt-2">
              <CapturePicker onPick={fillEcomFromCapture} />
            </div>
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
          {kwParsing && (
            <p className="mt-1 text-xs text-ink/55">{d.kwAiParsing}</p>
          )}
          {/* 关键词 AI 检查：相关性 + 政策风险，投流前必查 */}
          <div className="mt-3 border-t border-ink/10 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <button className={btnPrimary} disabled={kwChecking} onClick={onCheckKeywords}>
                {kwChecking ? d.kwChecking : d.kwCheck}
              </button>
              {kwCheckResults && (kwCheckCounts.irrelevant + kwCheckCounts.risky > 0) && (
                <button className={btnGhost} onClick={excludeFlaggedKeywords}>
                  {d.kwCheckExclude}
                </button>
              )}
            </div>
            {kwCheckError && (
              <p className="mt-2 text-xs text-red-600">{kwCheckError}</p>
            )}
            {kwCheckMsg && (
              <p className="mt-2 text-xs text-emerald-700">{kwCheckMsg}</p>
            )}
            {kwCheckResults && (
              <div className="mt-2">
                <p className="text-xs text-ink/60">
                  {d.kwCheckSummary
                    .replace("{relevant}", String(kwCheckCounts.relevant))
                    .replace("{irrelevant}", String(kwCheckCounts.irrelevant))
                    .replace("{risky}", String(kwCheckCounts.risky))}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {kwCheckResults.map((r) => (
                    <li
                      key={r.keyword}
                      className={`flex flex-wrap items-start gap-2 rounded-lg px-2 py-1.5 text-xs ${
                        r.verdict === "relevant"
                          ? "bg-ink/[0.03]"
                          : "bg-red-50"
                      }`}
                    >
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${
                          r.verdict === "relevant"
                            ? "bg-emerald-100 text-emerald-800"
                            : r.verdict === "irrelevant"
                              ? "bg-red-100 text-red-800"
                              : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {r.verdict === "relevant"
                          ? d.kwCheckRelevant
                          : r.verdict === "irrelevant"
                            ? d.kwCheckIrrelevant
                            : d.kwCheckRisky}
                      </span>
                      <span className="font-medium text-ink">{r.keyword}</span>
                      <span className="text-ink/60">{r.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
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
          <CapturePicker onPick={(c) => fillIntelFromCapture("negatives", c)} />
          {intelParsing === "negatives" && (
            <p className="mt-1 text-xs text-ink/55">{d.intelParsing}</p>
          )}
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
          <CapturePicker onPick={(c) => fillIntelFromCapture("spyfu", c)} />
          {intelParsing === "spyfu" && (
            <p className="mt-1 text-xs text-ink/55">{d.intelParsing}</p>
          )}
        </div>

        {/* Transparency */}
        <div className={cardCls}>
          {sectionHead(d.transparencySection, "transparency", d.transparencyHint, offerName)}
          <label className="block">
            <span className={labelCls}>{d.competitorAds}</span>
            <textarea className={`${inputCls} h-20`} value={competitorAds} onChange={(e) => setCompetitorAds(e.target.value)} placeholder={d.competitorAdsHint} />
          </label>
          <CapturePicker onPick={(c) => fillIntelFromCapture("transparency", c)} />
          {intelParsing === "transparency" && (
            <p className="mt-1 text-xs text-ink/55">{d.intelParsing}</p>
          )}
        </div>

        {/* SimilarWeb */}
        <div className={cardCls}>
          {sectionHead(d.similarwebSection, "similarweb", d.similarwebHint, network)}
          <label className="block">
            <span className={labelCls}>{d.similarwebNotes}</span>
            <textarea className={`${inputCls} h-20`} value={similarwebNotes} onChange={(e) => setSimilarwebNotes(e.target.value)} placeholder={lang === "zh" ? "比如：对手搜索流量占 65%，可复制" : "e.g. 65% search traffic, replicable"} />
          </label>
          <CapturePicker onPick={(c) => fillIntelFromCapture("similarweb", c)} />
          {intelParsing === "similarweb" && (
            <p className="mt-1 text-xs text-ink/55">{d.intelParsing}</p>
          )}
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
