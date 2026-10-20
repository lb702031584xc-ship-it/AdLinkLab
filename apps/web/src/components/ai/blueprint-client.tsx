"use client";

/**
 * Offer 一键推演报告：输入表单 → 一次生成 7 节推演 → 报告展示 + Markdown 导出。
 */
import { useEffect, useRef, useState } from "react";
import { OfferPipelineNav } from "@/components/ai/offer-pipeline-nav";
import { loadWorkStateAction, saveWorkStateAction } from "@/lib/api/work-state-actions";
import { useWorkState } from "@/lib/use-work-state";
import { getLastOfferId, setLastOfferId } from "@/lib/current-offer";
import { useI18n } from "@/i18n/I18nProvider";
import OfferLinks from "@/components/entities/offer-links";
import { zh as bpZh, en as bpEn, type AiBlueprintDict } from "@/i18n/dict/ai-blueprint";
import {
  generateBlueprintAction,
  fetchOfferMetaAction,
  fetchOfferOcrAction,
  listOfferCapturesAction,
  type AiActionResult,
} from "@/lib/api/ai-actions";
import type { BlueprintInput, BlueprintResult, OfferCaptureItem, OfferMetaResult } from "@/lib/api/ai";

type Dict = AiBlueprintDict;

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

const inputCls =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-ink/80";
const cardCls = "rounded-xl border border-ink/10 bg-white p-4";
const sectionTitleCls = "mb-2 text-base font-bold text-ink";

function SectionFailed({ d, error }: { d: Dict; error: string | null }) {
  return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
      ⚠️ {d.sectionFailed}{error ? `：${error}` : ""}
    </p>
  );
}

/* ---------- 关键词 AI 判断行：irrelevant / risky 标红/警告 ---------- */
function KeywordCheckRow({
  k,
  d,
}: {
  k: BlueprintResult["keywords"]["items"][number];
  d: Dict;
}) {
  const v = k.check?.verdict ?? "unchecked";
  const label =
    v === "relevant"
      ? d.keywords.verdictRelevant
      : v === "irrelevant"
        ? d.keywords.verdictIrrelevant
        : v === "risky"
          ? d.keywords.verdictRisky
          : d.keywords.verdictUnchecked;
  const badgeCls =
    v === "relevant"
      ? "bg-emerald-50 text-emerald-700"
      : v === "irrelevant"
        ? "bg-amber-50 text-amber-800"
        : v === "risky"
          ? "bg-red-50 text-red-700"
          : "bg-ink/5 text-ink/50";
  const rowCls =
    v === "risky"
      ? "border-t border-red-200 bg-red-50/40"
      : v === "irrelevant"
        ? "border-t border-amber-200 bg-amber-50/40"
        : "border-t border-ink/10";
  return (
    <tr className={rowCls}>
      <td className="py-1 pr-3 font-mono text-xs">{k.matchType === "exact" ? `[${k.keyword}]` : `"${k.keyword}"`}</td>
      <td className="py-1 pr-3 text-ink/70">{k.matchType}</td>
      <td className="py-1 pr-3 text-ink/70">{k.source === "user" ? d.keywords.sourceUser : d.keywords.sourceAi}</td>
      <td className="py-1 pr-3 text-ink/70">{k.reason}</td>
      <td className="py-1">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeCls}`}>
          {v === "risky" ? "⛔ " : v === "irrelevant" ? "⚠️ " : ""}
          {label}
        </span>
        {k.check?.reason ? (
          <span className="mt-0.5 block text-xs text-ink/55" title={k.check.reason}>
            {k.check.reason}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function buildMarkdownExport(bp: BlueprintResult): string {
  const L: string[] = [];
  L.push(`# ${bp.offer.name} —— 投放推演报告`);
  L.push(`> 生成时间：${bp.generatedAt}`);
  L.push("");
  L.push("## 0. Offer 档案");
  L.push(`- 产品均价：${bp.offer.avgPrice ?? "未知"} ${bp.offer.currency}`);
  L.push(`- 佣金：${bp.offer.commissionType === "percentage" ? `${bp.offer.commissionValue}%` : `${bp.offer.currency} ${bp.offer.commissionValue}`}`);
  L.push(`- 单均 payout：${bp.payout != null ? `${bp.payoutCurrency} ${bp.payout}` : "未知"}`);
  L.push(`- 目标市场：${bp.offer.targetMarket} / 投流方式：${bp.offer.landingMode}`);
  L.push("");
  L.push("## 1. 条款解析");
  if (bp.terms.result) {
    const t = bp.terms.result;
    L.push(`- 总结论：${t.overallVerdict}`);
    L.push(`- 搜索广告：${t.traffic.search} / 品牌词竞价：${t.brandBidding} / 直链：${t.directLinking}`);
    for (const f of t.redFlags) L.push(`- [${f.severity}] ${f.title}：${f.detail}`);
    L.push(`- ${t.summary}`);
  } else L.push(bp.terms.skipped ? "未提供条款文本。" : `生成失败：${bp.terms.error ?? ""}`);
  L.push("");
  L.push("## 2. 盈利测算");
  for (const b of bp.profit.breakEven)
    L.push(`- 转化率 ${b.cvrPct}% → 保本 CPC ${b.breakEvenCpc != null ? `${bp.profit.payoutCurrency} ${b.breakEvenCpc}` : "未知"}`);
  L.push(`> ${bp.profit.note}`);
  L.push("");
  L.push("## 3. 关键词计划");
  for (const k of bp.keywords.items) {
    const checkNote =
      k.check && k.check.verdict !== "unchecked"
        ? `【AI判断：${k.check.verdict}${k.check.reason ? `——${k.check.reason}` : ""}】`
        : "";
    L.push(`- ${k.matchType === "exact" ? `[${k.keyword}]` : `"${k.keyword}"`} —— ${k.reason}${checkNote}`);
  }
  L.push("");
  L.push("## 4. 广告文案");
  for (const ag of bp.adPlan.plan?.adGroups ?? []) {
    L.push(`### ${ag.group.name}`);
    L.push(`标题：${ag.rsa.headlines.join(" | ")}`);
    L.push(`描述：${ag.rsa.descriptions.join(" | ")}`);
  }
  L.push("");
  L.push("## 5. 投流决策");
  L.push(bp.traffic.report ?? `生成失败：${bp.traffic.error ?? ""}`);
  L.push("");
  L.push("## 6. 监控规则");
  const m = bp.monitor;
  L.push(`- 单关键词止损：${m.currency} ${m.stopLossPerKeyword}（0 转化则暂停）`);
  L.push(`- 系列止损：${m.currency} ${m.campaignKillSpend}（ROAS<1 则重做）`);
  L.push(`- 放量线：CPA ≤ ${m.currency} ${m.scaleCpa} 连续 3 天 → 加预算 30~50%`);
  L.push(`- 测试期日预算：${m.testDailyBudget}`);
  L.push("");
  L.push("## 7. 综合决策");
  L.push(`**${bp.verdict.level.toUpperCase()}**`);
  for (const r of bp.verdict.reasons) L.push(`- ${r}`);
  return L.join("\n");
}

export interface BlueprintOffer {
  id: string;
  name: string;
  network?: string | null;
  destinationUrl: string;
  affiliateUrl?: string | null;
  commissionValue?: string | number | null;
  commissionType?: string | null;
  avgPrice?: string | number | null;
}

export function BlueprintClient({
  showSetupNudge,
  initialOffer,
  offers,
}: {
  showSetupNudge: boolean;
  /** Offer 上下文：?offerId= 带入，自动填表。 */
  initialOffer?: BlueprintOffer | null;
  /** offer 下拉列表。 */
  offers?: BlueprintOffer[];
}) {
  const { lang } = useI18n();
  const d: Dict = lang === "en" ? bpEn : bpZh;

  const [offerName, setOfferName] = useState(initialOffer?.name ?? "");
  const [productDescription, setProductDescription] = useState("");
  const [avgPrice, setAvgPrice] = useState(
    initialOffer?.avgPrice != null ? String(initialOffer.avgPrice) : ""
  );
  const [commissionType, setCommissionType] = useState<"percentage" | "fixed">(
    initialOffer?.commissionType === "fixed" ? "fixed" : "percentage"
  );
  const [commissionValue, setCommissionValue] = useState(
    initialOffer?.commissionValue != null ? String(initialOffer.commissionValue) : ""
  );
  const [currency, setCurrency] = useState("USD");
  const [targetMarket, setTargetMarket] = useState("US");
  const [offerUrl, setOfferUrl] = useState(initialOffer?.destinationUrl ?? "");
  /** 当前选中 offer 的联盟链接（展示 + 一键直达；抓取分析仍用目标 URL）。 */
  const [offerAffUrl, setOfferAffUrl] = useState(initialOffer?.affiliateUrl ?? "");
  const [termsText, setTermsText] = useState("");
  /** 你的关键词：手动输入或从该 offer 的关键词页导入，推演优先评估它们。 */
  const [seedKeywords, setSeedKeywords] = useState("");
  const [landingMode, setLandingMode] = useState<"landing" | "direct">("landing");
  const [brandPolicy, setBrandPolicy] = useState<"allowed" | "forbidden">("forbidden");
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(
    initialOffer?.id ?? null
  );
  const [selectedOfferName, setSelectedOfferName] = useState<string | null>(
    initialOffer?.name ?? null
  );
  const [selectedOfferNetwork, setSelectedOfferNetwork] = useState<string | null>(
    initialOffer?.network ?? null
  );
  const appliedOfferRef = useRef<string | null>(initialOffer?.id ?? null);

  /* Offer 主线：按 offer 自动保存/恢复整张表单 */
  useWorkState({
    page: "ai-blueprint",
    offerId: selectedOfferId,
    label: selectedOfferName,
    buildSnapshot: () => ({
      version: 1,
      offerName, productDescription, avgPrice, commissionType, commissionValue,
      currency, targetMarket, offerUrl, termsText, landingMode, brandPolicy,
      seedKeywords,
    }),
    isMeaningful: (snap) =>
      Boolean(
        (snap.offerName as string)?.trim() ||
          (snap.offerUrl as string)?.trim() ||
          (snap.termsText as string)?.trim() ||
          (snap.seedKeywords as string)?.trim()
      ),
    applySnapshot: (snap) => {
      const str = (v: unknown) => (v == null ? "" : String(v));
      setOfferName(str(snap.offerName));
      setProductDescription(str(snap.productDescription));
      setAvgPrice(str(snap.avgPrice));
      if (snap.commissionType === "fixed" || snap.commissionType === "percentage")
        setCommissionType(snap.commissionType);
      setCommissionValue(str(snap.commissionValue));
      if (typeof snap.currency === "string") setCurrency(snap.currency);
      if (typeof snap.targetMarket === "string") setTargetMarket(snap.targetMarket);
      setOfferUrl(str(snap.offerUrl));
      setTermsText(str(snap.termsText));
      setSeedKeywords(str(snap.seedKeywords));
      if (snap.landingMode === "landing" || snap.landingMode === "direct")
        setLandingMode(snap.landingMode);
      if (snap.brandPolicy === "allowed" || snap.brandPolicy === "forbidden")
        setBrandPolicy(snap.brandPolicy);
    },
    watch: [
      selectedOfferId, offerName, productDescription, avgPrice, commissionType,
      commissionValue, currency, targetMarket, offerUrl, termsText,
      landingMode, brandPolicy, seedKeywords,
    ],
  });

  const fillFromOffer = (o: BlueprintOffer) => {
    setSelectedOfferId(o.id);
    setSelectedOfferName(o.name);
    setSelectedOfferNetwork(o.network ?? null);
    setOfferName(o.name);
    setOfferUrl(o.destinationUrl);
    setOfferAffUrl(o.affiliateUrl ?? "");
    if (o.avgPrice != null) setAvgPrice(String(o.avgPrice));
    if (o.commissionType === "fixed" || o.commissionType === "percentage")
      setCommissionType(o.commissionType);
    if (o.commissionValue != null) setCommissionValue(String(o.commissionValue));
  };

  /* 关键词联动：取该 offer 在关键词页已选的词（投放选词 + 投流决策关键词表） */
  const loadKeywordsFromSnapshots = async (offerId: string): Promise<string[]> => {
    const out: string[] = [];
    for (const page of ["keyword-launch", "traffic-planner"] as const) {
      try {
        const res = await loadWorkStateAction(page, offerId);
        if (!res.ok || !res.data.state) continue;
        const rows = (res.data.state.rows ?? res.data.state.keywords ?? []) as Array<{
          keyword?: unknown;
        }>;
        for (const r of rows) {
          const kw = typeof r.keyword === "string" ? r.keyword.trim() : "";
          if (kw && !out.some((x) => x.toLowerCase() === kw.toLowerCase())) out.push(kw);
        }
      } catch {
        /* 取不到就跳过 */
      }
    }
    return out;
  };

  /* 条款联动：为空时从该 offer 的条款解读快照取正文（前面页面已解析过的不用重贴）。
     批量模式的条款在 rows 里（按 offer 名匹配；只有一行时直接取）。 */
  const fillTermsFromSnapshot = async (offerId: string, offerName?: string) => {
    try {
      const res = await loadWorkStateAction("ai-terms", offerId);
      const snap = res.ok ? res.data.state : null;
      if (!snap) return;
      const txt = typeof snap.text === "string" ? snap.text.trim() : "";
      if (txt) {
        setTermsText((prev) => (prev.trim() ? prev : txt));
        return;
      }
      const rows = Array.isArray(snap.rows)
        ? (snap.rows as Array<{ name?: unknown; text?: unknown }>)
        : [];
      const name = (offerName ?? "").trim().toLowerCase();
      const matched = name
        ? rows.find((r) => String(r.name ?? "").trim().toLowerCase() === name)
        : undefined;
      const row = matched ?? (rows.length === 1 ? rows[0] : undefined);
      const rowTxt = row && typeof row.text === "string" ? row.text.trim() : "";
      if (rowTxt) setTermsText((prev) => (prev.trim() ? prev : rowTxt));
    } catch {
      /* 取不到就不填 */
    }
  };

  /* 佣金联动：Offer 实体 + 本页快照都没有佣金数值时，从兄弟页快照取：
     工作表 ④ 盈利测算的 profitState.inputs（commissionRate / payout + mode 最准），
     回落投流页快照的 payout（按已知的佣金类型折算）。只补空，不覆盖；
     兄弟页类型与已知类型冲突时不猜。 */
  const fillCommissionFromSnapshots = async (
    offerId: string,
    authoritativeType: "percentage" | "fixed" | null,
    avgPriceStr: string,
  ) => {
    const num = (v: unknown) => {
      const n = typeof v === "string" ? Number(v.trim()) : typeof v === "number" ? v : NaN;
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    let derived: { type: "percentage" | "fixed"; value: string } | null = null;
    try {
      const res = await loadWorkStateAction("ai-worksheet", offerId);
      const snap = res.ok ? (res.data.state as Record<string, unknown> | null) : null;
      const inputs = (snap?.profitState as { inputs?: Record<string, unknown> } | null)?.inputs;
      if (inputs) {
        const rate = num(inputs.commissionRate);
        const payout = num(inputs.payout);
        if (inputs.mode === "ecommerce" && rate != null) {
          derived = { type: "percentage", value: String(rate) };
        } else if (inputs.mode === "other" && payout != null) {
          derived = { type: "fixed", value: String(payout) };
        }
      }
    } catch {
      /* 取不到就回落 */
    }
    if (!derived) {
      try {
        const res = await loadWorkStateAction("traffic-planner", offerId);
        const snap = res.ok ? (res.data.state as Record<string, unknown> | null) : null;
        const payout = num(snap?.payout);
        if (payout != null && authoritativeType) {
          if (authoritativeType === "fixed") {
            derived = { type: "fixed", value: String(payout) };
          } else {
            const avg = num(avgPriceStr);
            if (avg != null) {
              derived = {
                type: "percentage",
                value: String(Math.round((payout / avg) * 100 * 100) / 100),
              };
            }
          }
        }
      } catch {
        /* 取不到就不填 */
      }
    }
    if (!derived) return;
    if (authoritativeType && derived.type !== authoritativeType) return;
    if (!authoritativeType) setCommissionType(derived.type);
    setCommissionValue((prev) => (prev.trim() ? prev : derived!.value));
  };

  useEffect(() => {
    const key = initialOffer ? initialOffer.id : null;
    if (key && appliedOfferRef.current !== key) {
      appliedOfferRef.current = key;
      fillFromOffer(initialOffer!);
      setLastOfferId(initialOffer!.id);
      void fillTermsFromSnapshot(initialOffer!.id, initialOffer!.name);
      void (async () => {
        const kws = await loadKeywordsFromSnapshots(initialOffer!.id);
        if (kws.length > 0) {
          setSeedKeywords((prev) => (prev.trim() ? prev : kws.join("\n")));
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOffer]);

  const onSelectOffer = async (id: string) => {
    const o = (offers ?? []).find((x) => x.id === id) ?? null;
    if (!o) return;
    setLastOfferId(o.id);
    // 先清空工作字段：新 offer 没历史时不留上一个 offer 的数据；
    // 再由下方 fillFromOffer / 快照恢复填入该 offer 自己的数据。
    setProductDescription("");
    setTermsText("");
    setSeedKeywords("");
    setCurrency("USD");
    setTargetMarket("US");
    setLandingMode("landing");
    setBrandPolicy("forbidden");
    setResult(null);
    setPageText(null);
    setFetchMsg(null);
    setFetchOk(false);
    fillFromOffer(o);
    void fillTermsFromSnapshot(o.id, o.name);
    void (async () => {
      const kws = await loadKeywordsFromSnapshots(o.id);
      if (kws.length > 0) {
        setSeedKeywords((prev) => {
          if (prev.trim()) {
            const existing = prev.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
            const merged = [...existing];
            for (const kw of kws) {
              if (!merged.some((x) => x.toLowerCase() === kw.toLowerCase())) merged.push(kw);
            }
            return merged.join("\n");
          }
          return kws.join("\n");
        });
      }
    })();
    let snapCommissionType: "percentage" | "fixed" | null = null;
    let snapAvgPrice = "";
    try {
      const res = await loadWorkStateAction("ai-blueprint", o.id);
      if (res.ok && res.data.state) {
        const snap = res.data.state as Record<string, unknown>;
        if ((snap.offerName as string)?.trim() || (snap.offerUrl as string)?.trim()) {
          const str = (v: unknown) => (v == null ? "" : String(v));
          setOfferName(str(snap.offerName));
          setProductDescription(str(snap.productDescription));
          setAvgPrice(str(snap.avgPrice));
          if (snap.commissionType === "fixed" || snap.commissionType === "percentage") {
            snapCommissionType = snap.commissionType;
            setCommissionType(snap.commissionType as "fixed" | "percentage");
          }
          /* 快照佣金为空时不覆盖 Offer 实体已有的值（否则后续兄弟页补填会用错来源）。 */
          const snapCv = str(snap.commissionValue);
          if (snapCv.trim()) setCommissionValue(snapCv);
          snapAvgPrice = str(snap.avgPrice);
          if (typeof snap.currency === "string") setCurrency(snap.currency);
          if (typeof snap.targetMarket === "string") setTargetMarket(snap.targetMarket);
          setOfferUrl(str(snap.offerUrl));
          setTermsText(str(snap.termsText));
          if (snap.landingMode === "landing" || snap.landingMode === "direct")
            setLandingMode(snap.landingMode as "landing" | "direct");
          if (snap.brandPolicy === "allowed" || snap.brandPolicy === "forbidden")
            setBrandPolicy(snap.brandPolicy as "allowed" | "forbidden");
        }
      }
    } catch {
      /* 恢复失败不打断 */
    }
    /* 佣金仍为空时，从工作表 / 投流页快照补（本页快照优先于 Offer 实体）。 */
    const offerType =
      o.commissionType === "fixed" || o.commissionType === "percentage" ? o.commissionType : null;
    const authoritativeType = snapCommissionType ?? offerType;
    const avgPriceStr = snapAvgPrice || (o.avgPrice != null ? String(o.avgPrice) : "");
    void fillCommissionFromSnapshots(o.id, authoritativeType, avgPriceStr);
  };

  /** 全局当前 offer：没带 ?offerId= 时用上次选的 offer（选一次，到处带）。 */
  const lastOfferFallbackRef = useRef(false);
  useEffect(() => {
    if (initialOffer || lastOfferFallbackRef.current) return;
    lastOfferFallbackRef.current = true;
    const last = getLastOfferId();
    const found = last ? (offers ?? []).find((x) => x.id === last) : undefined;
    if (found) void onSelectOffer(found.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BlueprintResult | null>(null);
  /* 送去投放选词：idle 未送 / sending 送词中 / sent 已送（count = 新增词数）/ error 失败。 */
  const [sendLaunch, setSendLaunch] = useState<
    { status: "idle" } | { status: "sending" } | { status: "sent"; count: number } | { status: "error" }
  >({ status: "idle" });
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<string | null>(null);
  const [fetchOk, setFetchOk] = useState(false);
  const [pageText, setPageText] = useState<string | null>(null);
  const [captures, setCaptures] = useState<OfferCaptureItem[]>([]);
  const [capturesLoading, setCapturesLoading] = useState(false);
  const [capturesLoaded, setCapturesLoaded] = useState(false);
  const [showCaptures, setShowCaptures] = useState(false);
  const [showExtHelp, setShowExtHelp] = useState(false);

  async function loadCaptures() {
    setCapturesLoading(true);
    const res = await listOfferCapturesAction();
    setCapturesLoading(false);
    setCapturesLoaded(true);
    if (res.ok) setCaptures(res.data);
  }

  function useCapture(c: OfferCaptureItem) {
    setOfferUrl(c.finalUrl);
    applyMeta(c);
  }

  const canSubmit =
    offerName.trim() && productDescription.trim() && Number(commissionValue) > 0 && !busy;

  async function onFetch() {
    const url = offerUrl.trim();
    if (!url || fetching) return;
    setFetching(true);
    setFetchMsg(null);
    setFetchOk(false);
    const res = await fetchOfferMetaAction(url);
    setFetching(false);
    if (!res.ok) {
      setFetchMsg(d.form.fetchFailed + (res.error ? `：${res.error}` : ""));
      return;
    }
    applyMeta(res.data);
  }

  function applyMeta(meta: OfferMetaResult) {
    if (meta.title && !offerName.trim()) setOfferName(meta.title);
    if (meta.description && !productDescription.trim()) setProductDescription(meta.description);
    if (meta.price != null && !avgPrice.trim()) setAvgPrice(String(meta.price));
    if (meta.currency && currency === "USD") setCurrency(meta.currency);
    if (meta.text) setPageText(meta.text);
    setFetchOk(true);
    setFetchMsg(
      meta.source === "screenshot" ? d.form.fetchedByScreenshot
      : meta.source === "extension" ? d.form.capturedUsed
      : d.form.fetched
    );
  }

  async function onOcrFile(file: File | undefined) {
    if (!file || fetching) return;
    setFetching(true);
    setFetchMsg(null);
    setFetchOk(false);
    const fd = new FormData();
    fd.append("screenshot", file);
    const res = await fetchOfferOcrAction(fd);
    setFetching(false);
    if (!res.ok) {
      setFetchMsg((lang === "en" ? "Screenshot OCR failed: " : "截图识别失败：") + res.error);
      return;
    }
    applyMeta(res.data);
  }

  async function onGenerate() {
    setBusy(true);
    setError(null);
    setResult(null);
    setSendLaunch({ status: "idle" });
    const input: BlueprintInput = {
      offerName: offerName.trim(),
      productDescription: productDescription.trim(),
      avgPrice: avgPrice.trim() ? Number(avgPrice) : null,
      commissionType,
      commissionValue: Number(commissionValue),
      currency: currency.trim() || "USD",
      targetMarket: targetMarket.trim() || "US",
      offerUrl: offerUrl.trim() || undefined,
      pageText: pageText || undefined,
      termsText: termsText.trim() || undefined,
      landingMode,
      brandPolicy,
      keywordCount: 12,
      seedKeywords: seedKeywords
        .split(/[\n,]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    };
    const res: AiActionResult<{ blueprint: BlueprintResult }> = await generateBlueprintAction(input);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.data.blueprint);
  }

  function onExport() {
    if (!result) return;
    const blob = new Blob([buildMarkdownExport(result)], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `blueprint-${result.offer.name.replace(/[^\w\-]+/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* 送去投放选词：把推演广告计划的关键词/否词合并进该 offer 的 keyword-launch 快照
     （与选词页同 page key、同 offer 上下文）。先读已有快照再合并：已有行优先，
     新词按词面（小写）去重追加，绝不覆盖用户已选的词和已填的出价。 */
  async function onSendToLaunch() {
    if (!result?.adPlan.plan || !selectedOfferId) return;
    setSendLaunch({ status: "sending" });
    try {
      const ts = Date.now();
      let seq = 0;
      const newRows: Array<{
        id: string;
        keyword: string;
        adGroup: string;
        matchType: "exact" | "phrase" | "broad";
        bid: string;
        refCpc: string;
      }> = [];
      const newNegatives: string[] = [];
      for (const ag of result.adPlan.plan.adGroups) {
        const groupName = (ag.group.name ?? "").trim();
        for (const k of ag.group.keywords ?? []) {
          const text = (k.text ?? "").trim();
          if (!text) continue;
          const mt = String(k.matchType ?? "").toLowerCase();
          newRows.push({
            id: `bp-${ts}-${++seq}`,
            keyword: text,
            adGroup: groupName,
            matchType: mt === "phrase" || mt === "broad" ? mt : "exact",
            bid: "",
            refCpc: "",
          });
        }
        for (const n of ag.group.negativeKeywords ?? []) {
          const text = (n.text ?? "").trim();
          if (text) newNegatives.push(text);
        }
      }
      let existingRows: Array<Record<string, unknown>> = [];
      let existingNegatives: string[] = [];
      const loadRes = await loadWorkStateAction("keyword-launch", selectedOfferId);
      if (loadRes.ok && loadRes.data.state) {
        const s = loadRes.data.state;
        if (Array.isArray(s.rows)) {
          existingRows = (s.rows as Array<Record<string, unknown>>).filter(
            (r) => r && typeof r.keyword === "string" && (r.keyword as string).trim()
          );
        }
        if (Array.isArray(s.negatives)) {
          existingNegatives = s.negatives.filter(
            (x): x is string => typeof x === "string" && x.trim().length > 0
          );
        }
      }
      const have = new Set(
        existingRows.map((r) => (r.keyword as string).trim().toLowerCase())
      );
      const appended: typeof newRows = [];
      for (const r of newRows) {
        const key = r.keyword.trim().toLowerCase();
        if (have.has(key)) continue;
        have.add(key);
        appended.push(r);
      }
      const negHave = new Set(existingNegatives.map((x) => x.trim().toLowerCase()));
      const mergedNegatives = [...existingNegatives];
      for (const n of newNegatives) {
        const key = n.trim().toLowerCase();
        if (negHave.has(key)) continue;
        negHave.add(key);
        mergedNegatives.push(n);
      }
      const saveRes = await saveWorkStateAction(
        "keyword-launch",
        { version: 1, rows: [...existingRows, ...appended], negatives: mergedNegatives },
        { offerId: selectedOfferId, label: selectedOfferName }
      );
      if (!saveRes.ok) {
        setSendLaunch({ status: "error" });
        return;
      }
      setSendLaunch({ status: "sent", count: appended.length });
    } catch {
      setSendLaunch({ status: "error" });
    }
  }

  const verdictColor =
    result?.verdict.level === "go"
      ? "border-green-500 bg-green-50 text-green-800"
      : result?.verdict.level === "stop"
        ? "border-red-400 bg-red-50 text-red-800"
        : "border-amber-400 bg-amber-50 text-amber-800";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink">{d.title}</h1>
        <p className="mt-1 text-sm text-ink/60">{d.subtitle}</p>
      </div>

      <OfferPipelineNav
        current="blueprint"
        offerId={selectedOfferId}
        offerName={selectedOfferName}
        offerNetwork={selectedOfferNetwork}
        offers={offers}
        onSelectOffer={onSelectOffer}
      />

      {showSetupNudge ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {d.setupNudge}{" "}
          <a href="/admin/ai-settings" className="font-medium underline">{d.goSettings}</a>
        </div>
      ) : null}

      {/* 输入表单 */}
      <div className={`${cardCls} grid gap-3 md:grid-cols-2`}>
        <div>
          <label className={labelCls}>{d.form.offerName} *</label>
          <input className={inputCls} value={offerName} onChange={(e) => setOfferName(e.target.value)} placeholder={d.form.offerNamePh} />
        </div>
        <div>
          <label className={labelCls}>{d.form.offerUrl}</label>
          <div className="flex gap-2">
            <input className={inputCls} value={offerUrl} onChange={(e) => { setOfferUrl(e.target.value); setFetchOk(false); setPageText(null); }} placeholder={d.form.offerUrlPh} />
            <button type="button" onClick={onFetch} disabled={!offerUrl.trim() || fetching}
              className="shrink-0 rounded-lg border border-ink/15 px-3 py-2 text-sm text-ink hover:bg-ink/5 disabled:opacity-50">
              {fetching ? d.form.fetching : d.form.fetch}
            </button>
            <label className={`shrink-0 cursor-pointer rounded-lg border border-ink/15 px-3 py-2 text-sm text-ink hover:bg-ink/5 ${fetching ? "pointer-events-none opacity-50" : ""}`}>
              📷 {d.form.ocr}
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => { onOcrFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <button type="button" onClick={() => setShowExtHelp((v) => !v)}
              className="shrink-0 rounded-lg border border-ink/15 px-3 py-2 text-sm text-ink hover:bg-ink/5"
              title={d.form.extHelpTitle}>
              🧩 {d.form.extBtn}
            </button>
          </div>
          {offerAffUrl.trim() ? (
            <div className="mt-1.5">
              <OfferLinks affiliateUrl={offerAffUrl} destinationUrl={offerUrl} />
            </div>
          ) : null}
          {showExtHelp ? (
            <div className="mt-2 rounded-lg border border-ink/10 bg-ink/[0.02] p-3 text-xs leading-6 text-ink/70">
              <p className="font-medium text-ink">{d.form.extHelpTitle}</p>
              <p>{d.form.extHelpBody}</p>
              <ol className="list-decimal pl-4">
                <li>{d.form.extStep1}</li>
                <li>{d.form.extStep2}</li>
                <li>{d.form.extStep3}</li>
                <li>{d.form.extStep4}</li>
              </ol>
              <a className="text-blue-700 underline" href="https://github.com/lb702031584xc-ship-it/adsgoogleHL/tree/main/apps/extension" target="_blank" rel="noreferrer">
                {d.form.extRepoLink}
              </a>
            </div>
          ) : null}
          {fetchMsg ? (
            <p className={`mt-1 text-xs ${fetchOk ? "text-green-700" : "text-amber-700"}`}>{fetchMsg}</p>
          ) : null}
          {pageText ? (
            <p className="mt-1 text-xs text-ink/50">📄 {d.form.pageTextNote}</p>
          ) : null}
          <div className="mt-2">
            <button type="button" onClick={() => { setShowCaptures((v) => !v); if (!capturesLoaded) loadCaptures(); }}
              className="text-xs text-ink/60 hover:text-ink">
              🧩 {d.form.capturesToggle} {showCaptures ? "▲" : "▼"}
            </button>
            {showCaptures ? (
              <div className="mt-2 space-y-1.5 rounded-lg border border-ink/10 bg-ink/[0.02] p-2">
                {capturesLoading ? (
                  <p className="text-xs text-ink/50">{d.form.capturesLoading}</p>
                ) : captures.length === 0 ? (
                  <p className="text-xs text-ink/50">{d.form.capturesEmpty}</p>
                ) : captures.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-md bg-white/60 px-2 py-1.5">
                    <div className="min-w-0 text-xs">
                      <p className="truncate font-medium text-ink">{c.title || c.finalUrl}</p>
                      <p className="truncate text-ink/50">
                        {c.price != null ? `${c.price} ${c.currency ?? ""} · ` : ""}{new Date(c.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <button type="button" onClick={() => useCapture(c)}
                      className="shrink-0 rounded-md border border-ink/15 px-2 py-1 text-xs text-ink hover:bg-ink/5">
                      {d.form.useCapture}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>{d.form.productDescription} *</label>
          <textarea className={inputCls} rows={2} value={productDescription} onChange={(e) => setProductDescription(e.target.value)} placeholder={d.form.productDescriptionPh} />
        </div>
        {commissionType === "percentage" ? (
          <div>
            <label className={labelCls}>{d.form.avgPrice} *</label>
            <input className={inputCls} type="number" min="0" step="0.01" value={avgPrice} onChange={(e) => setAvgPrice(e.target.value)} placeholder="65.88" />
          </div>
        ) : null}
        <div>
          <label className={labelCls}>{d.form.currency}</label>
          <input className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD" />
        </div>
        <div>
          <label className={labelCls}>{d.form.commissionType}</label>
          <div className="flex gap-2">
            {(["percentage", "fixed"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setCommissionType(t)}
                className={`rounded-lg border px-3 py-2 text-sm ${commissionType === t ? "border-signal bg-signal/10 font-medium text-ink" : "border-ink/15 text-ink/60"}`}>
                {t === "percentage" ? d.form.pct : d.form.fixed}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>{commissionType === "percentage" ? d.form.commissionRate : d.form.fixedCommission} *</label>
          <input className={inputCls} type="number" min="0" step="0.01" value={commissionValue} onChange={(e) => setCommissionValue(e.target.value)} placeholder={commissionType === "percentage" ? d.form.commissionRatePh : d.form.fixedCommissionPh} />
        </div>
        <div>
          <label className={labelCls}>{d.form.targetMarket}</label>
          <input className={inputCls} value={targetMarket} onChange={(e) => setTargetMarket(e.target.value)} placeholder="US" />
        </div>
        <div>
          <label className={labelCls}>{d.form.landingMode}</label>
          <div className="flex gap-2">
            {(["landing", "direct"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setLandingMode(m)}
                className={`rounded-lg border px-3 py-2 text-sm ${landingMode === m ? "border-signal bg-signal/10 font-medium text-ink" : "border-ink/15 text-ink/60"}`}>
                {m === "landing" ? d.form.modeLanding : d.form.modeDirect}
              </button>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>{d.form.brandPolicy}</label>
          <div className="flex gap-2">
            {(["allowed", "forbidden"] as const).map((b) => (
              <button key={b} type="button" onClick={() => setBrandPolicy(b)}
                className={`rounded-lg border px-3 py-2 text-sm ${brandPolicy === b ? "border-signal bg-signal/10 font-medium text-ink" : "border-ink/15 text-ink/60"}`}>
                {b === "allowed" ? d.form.brandAllowed : d.form.brandForbidden}
              </button>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>{d.form.termsText}</label>
          <textarea className={inputCls} rows={3} value={termsText} onChange={(e) => setTermsText(e.target.value)} placeholder={d.form.termsTextPh} />
        </div>
        <div className="md:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <label className={labelCls}>{d.form.seedKeywords}</label>
            {selectedOfferId ? (
              <button type="button" onClick={async () => {
                const kws = await loadKeywordsFromSnapshots(selectedOfferId);
                if (kws.length === 0) return;
                setSeedKeywords((prev) => {
                  const existing = prev.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
                  const merged = [...existing];
                  for (const kw of kws) {
                    if (!merged.some((x) => x.toLowerCase() === kw.toLowerCase())) merged.push(kw);
                  }
                  return merged.join("\n");
                });
              }} className="text-xs text-ink/60 hover:text-ink">
                {d.form.importKeywords}
              </button>
            ) : null}
          </div>
          <textarea className={inputCls} rows={3} value={seedKeywords} onChange={(e) => setSeedKeywords(e.target.value)} placeholder={d.form.seedKeywordsPh} />
          <p className="mt-1 text-xs text-ink/50">{d.form.seedKeywordsHint}</p>
        </div>
        <div className="md:col-span-2">
          <button type="button" onClick={onGenerate} disabled={!canSubmit}
            className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50">
            {busy ? d.form.generating : d.form.generate}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {d.error}：{error}
        </div>
      ) : null}

      {/* 报告 */}
      {result ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-ink">{result.offer.name}</h2>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onSendToLaunch}
                disabled={!selectedOfferId || !result.adPlan.plan || sendLaunch.status === "sending"}
                title={!selectedOfferId ? d.sendToLaunchNeedOffer : undefined}
                className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50">
                🚀 {sendLaunch.status === "sending" ? d.sendingToLaunch : d.sendToLaunch}
              </button>
              <button type="button" onClick={onExport}
                className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink hover:bg-ink/5">
                📥 {d.exportMd}
              </button>
            </div>
          </div>
          {!selectedOfferId ? (
            <p className="text-xs text-ink/50">{d.sendToLaunchNeedOffer}</p>
          ) : null}
          {sendLaunch.status === "sent" ? (
            <p className="text-sm text-green-700">
              ✅ {d.sentToLaunch.replace("{count}", String(sendLaunch.count))}{" "}
              <a className="underline"
                href={`/keywords/starter?tab=launch&offerId=${encodeURIComponent(selectedOfferId ?? "")}`}>
                {d.goToLaunch}
              </a>
            </p>
          ) : null}
          {sendLaunch.status === "error" ? (
            <p className="text-sm text-red-700">{d.sendToLaunchFailed}</p>
          ) : null}

          {/* 7. 综合决策置顶 */}
          <div className={`rounded-xl border p-4 ${verdictColor}`}>
            <p className="text-base font-bold">{d.verdict[result.verdict.level]}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {result.verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>

          {/* 0. Offer 档案 */}
          <div className={cardCls}>
            <h3 className={sectionTitleCls}>{d.sections.profile}</h3>
            <dl className="grid gap-1 text-sm md:grid-cols-2">
              <div><dt className="inline text-ink/55">{d.profile.payout}：</dt>
                <dd className="inline font-semibold text-ink">{result.payout != null ? `${result.payoutCurrency} ${result.payout}` : d.profile.unknown}</dd></div>
              <div><dt className="inline text-ink/55">{d.form.targetMarket}：</dt>
                <dd className="inline text-ink">{result.offer.targetMarket} / {result.offer.landingMode}</dd></div>
            </dl>
          </div>

          {/* 1. 条款解析 */}
          <div className={cardCls}>
            <h3 className={sectionTitleCls}>{d.sections.terms}</h3>
            {result.terms.result ? (
              <div className="text-sm">
                <p><span className="font-medium">总结论：</span>{d.verdict[result.terms.result.overallVerdict === "go" ? "go" : result.terms.result.overallVerdict === "stop" ? "stop" : "caution"]}</p>
                <p className="mt-1 text-ink/70">搜索 {result.terms.result.traffic.search} · 品牌词 {result.terms.result.brandBidding} · 直链 {result.terms.result.directLinking}</p>
                {result.terms.result.redFlags.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {result.terms.result.redFlags.map((f, i) => <li key={i}>[{f.severity}] <strong>{f.title}</strong>：{f.detail}</li>)}
                  </ul>
                ) : null}
                <p className="mt-1 text-ink/70">{result.terms.result.summary}</p>
              </div>
            ) : result.terms.skipped ? (
              <p className="text-sm text-ink/60">{d.termsSkipped}</p>
            ) : (
              <SectionFailed d={d} error={result.terms.error} />
            )}
          </div>

          {/* 2. 盈利测算 */}
          <div className={cardCls}>
            <h3 className={sectionTitleCls}>{d.sections.profit}</h3>
            <table className="w-full max-w-md text-sm">
              <thead><tr className="text-left text-ink/55">
                <th className="py-1 pr-3 font-medium">{d.profit.colCvr}</th>
                <th className="py-1 font-medium">{d.profit.colCpc}</th>
              </tr></thead>
              <tbody>
                {result.profit.breakEven.map((b) => (
                  <tr key={b.cvrPct} className="border-t border-ink/10">
                    <td className="py-1 pr-3">{b.cvrPct}%</td>
                    <td className="py-1 font-medium">{b.breakEvenCpc != null ? `${result.profit.payoutCurrency} ${b.breakEvenCpc}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink/55">{d.profit.note}</p>
          </div>

          {/* 3. 关键词 */}
          <div className={cardCls}>
            <h3 className={sectionTitleCls}>{d.sections.keywords}</h3>
            {result.keywords.error ? <SectionFailed d={d} error={result.keywords.error} /> : (
              <>
                <p className="mb-2 text-xs text-ink/55">{d.keywords.hint}</p>
                <p className="mb-2 text-xs text-ink/45">{d.keywords.verdictHint}</p>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-ink/55">
                    <th className="py-1 pr-3 font-medium">{d.keywords.colKeyword}</th>
                    <th className="py-1 pr-3 font-medium">{d.keywords.colMatch}</th>
                    <th className="py-1 pr-3 font-medium">{d.keywords.colSource}</th>
                    <th className="py-1 pr-3 font-medium">{d.keywords.colReason}</th>
                    <th className="py-1 font-medium">{d.keywords.colVerdict}</th>
                  </tr></thead>
                  <tbody>
                    {result.keywords.items.map((k, i) => (
                      <KeywordCheckRow key={i} k={k} d={d} />
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          {/* 4. 广告文案 */}
          <div className={cardCls}>
            <h3 className={sectionTitleCls}>{d.sections.ads}</h3>
            {result.adPlan.plan ? (
              <>
                <p className="mb-2 text-xs text-ink/55">{d.ads.hint}</p>
                {result.adPlan.plan.adGroups.map((ag, i) => (
                  <div key={i} className="mb-3 last:mb-0">
                    <p className="text-sm font-medium text-ink">{ag.group.name}</p>
                    <p className="mt-1 text-xs font-medium text-ink/55">{d.ads.headlines}</p>
                    <ol className="list-decimal space-y-0.5 pl-5 text-sm">
                      {ag.rsa.headlines.map((h, j) => <li key={j}>{h}</li>)}
                    </ol>
                    <p className="mt-1 text-xs font-medium text-ink/55">{d.ads.descriptions}</p>
                    <ol className="list-decimal space-y-0.5 pl-5 text-sm">
                      {ag.rsa.descriptions.map((x, j) => <li key={j}>{x}</li>)}
                    </ol>
                  </div>
                ))}
              </>
            ) : <SectionFailed d={d} error={result.adPlan.error} />}
          </div>

          {/* 5. 投流决策 */}
          <div className={cardCls}>
            <h3 className={sectionTitleCls}>{d.sections.traffic}</h3>
            {result.traffic.report ? renderMarkdown(result.traffic.report) : <SectionFailed d={d} error={result.traffic.error} />}
          </div>

          {/* 6. 监控规则 */}
          <div className={cardCls}>
            <h3 className={sectionTitleCls}>{d.sections.monitor}</h3>
            <ul className="space-y-1 text-sm">
              <li><strong>{d.monitor.stopLoss}</strong>：{result.monitor.currency} {result.monitor.stopLossPerKeyword} <span className="text-ink/55">({d.monitor.stopLossDesc})</span></li>
              <li><strong>{d.monitor.kill}</strong>：{result.monitor.currency} {result.monitor.campaignKillSpend} <span className="text-ink/55">({d.monitor.killDesc})</span></li>
              <li><strong>{d.monitor.scale}</strong>：{result.monitor.currency} {result.monitor.scaleCpa} <span className="text-ink/55">({d.monitor.scaleDesc})</span></li>
              <li><strong>{d.monitor.budget}</strong>：{result.monitor.testDailyBudget}</li>
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
