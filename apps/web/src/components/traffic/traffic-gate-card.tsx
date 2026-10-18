"use client";

import { useRef, useState } from "react";
import type { TrafficGate } from "@/lib/api/amazon-types";
import {
  ocrScreenshotAction,
  type OcrMetrics,
} from "@/lib/api/traffic-actions";

/**
 * 流量需求门卡片的文案字典（仅纯字符串，不许有函数）。
 * 由各页面从 i18n 字典里传入对应切片。
 */
export interface TrafficGateCardDict {
  /** 卡片标题 */
  title: string;
  /** 三态徽标：通过 */
  passed: string;
  /** 三态徽标：不通过 */
  notPassed: string;
  /** 三态徽标/缺值：暂无数据 */
  noData: string;
  /** gate 为 null 且非 loading 时的占位 */
  notChecked: string;
  /** loading 时的提示 */
  loading: string;
  /** 有官网 */
  officialSiteFound: string;
  /** 无官网 */
  officialSiteNotFound: string;
  /** 信号区小标题 */
  signals: string;
  /** 判定说明小标题 */
  reason: string;
  /** 信号行"阈值"前缀 */
  thresholdLabel: string;
  /** 手动区标题 */
  manualTitle: string;
  /** 品牌名输入框标签 */
  manualBrandLabel: string;
  /** 品牌名输入框 placeholder */
  manualBrandPlaceholder: string;
  /** 手动月访问量输入框标签 */
  manualVisitsLabel: string;
  /** 手动月访问量输入框 placeholder */
  manualVisitsPlaceholder: string;
  /** 手动区说明小字 */
  manualHint: string;
  /** 重新检测按钮 */
  recheck: string;
  /** 重新检测中 */
  rechecking: string;
  /** 手动输入校验错误 */
  manualInvalid: string;
  /** 截图识别按钮 */
  ocrUpload: string;
  /** 截图识别中 */
  ocrUploading: string;
  /** 截图识别说明 */
  ocrHint: string;
  /** 识别值标注 */
  ocrReviewNote: string;
  /** 识别失败 */
  ocrFailed: string;
  /** SEMrush 自然流量输入框标签 */
  semrushOrganicLabel: string;
  /** SEMrush 自然流量输入框 placeholder */
  semrushOrganicPlaceholder: string;
  /** SEMrush 付费流量输入框标签 */
  semrushPaidLabel: string;
  /** SEMrush 付费流量输入框 placeholder */
  semrushPaidPlaceholder: string;
  /** SEMrush 付费关键词数输入框标签 */
  semrushPaidKeywordsLabel: string;
  /** SEMrush 付费关键词数输入框 placeholder */
  semrushPaidKeywordsPlaceholder: string;
  /** SEMrush 三字段说明小字 */
  semrushHint: string;
}

/** 手动重判输入：品牌名（可选）+ 手动月访问量（可选），至少填一个。 */
export interface TrafficGateRecheckInput {
  brand?: string;
  manualMonthlyVisits?: number;
  /**
   * SEMrush 域名概览手动值（全部可选）：自然流量 / 付费流量 / 付费关键词数。
   * organicTraffic + paidTraffic 都填时参与"付费为零规则"判定。
   */
  organicTraffic?: number;
  paidTraffic?: number;
  paidKeywords?: number;
}

function badgeClass(passed: boolean | null): string {
  if (passed === true) return "bg-green-100 text-green-800";
  if (passed === false) return "bg-red-100 text-red-800";
  return "bg-ink/10 text-ink/60";
}

function dotClass(passed: boolean | null): string {
  if (passed === true) return "bg-green-500";
  if (passed === false) return "bg-red-500";
  return "bg-ink/25";
}

function SignalRow({
  source,
  label,
  value,
  threshold,
  passed,
  note,
  dict,
}: {
  source: string;
  label: string;
  value: number | null;
  threshold: number | null;
  passed: boolean | null;
  note?: string;
  dict: TrafficGateCardDict;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass(passed)}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm text-ink/85">
          <span className="font-medium">{label}</span>
          <span className="text-ink/50">（{source}）</span>
          {`：${value ?? dict.noData}`}
          {threshold !== null ? ` / ${dict.thresholdLabel} ${threshold}` : null}
        </p>
        {note ? <p className="text-xs text-ink/50">{note}</p> : null}
      </div>
    </li>
  );
}

export function TrafficGateCard({
  gate,
  loading,
  dict: d,
  onRecheck,
  recheckBusy,
}: {
  gate: TrafficGate | null | undefined;
  loading: boolean;
  dict: TrafficGateCardDict;
  /**
   * 手动重判回调（品牌名/手动月访问量至少提供一个）。
   * 不传则不显示手动区。
   */
  onRecheck?: (input: TrafficGateRecheckInput) => void;
  recheckBusy?: boolean;
}) {
  // 手动区默认展开条件：未检测（gate=null）或 unknown（暂无数据）时展开，其他时候折叠。
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? (gate == null || gate.passed === null);
  const [brand, setBrand] = useState("");
  const [visits, setVisits] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [ocr, setOcr] = useState<OcrMetrics | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  // SEMrush 域名概览手动值（全部可选）：自然流量 / 付费流量 / 付费关键词数
  const [semrushOrganic, setSemrushOrganic] = useState("");
  const [semrushPaid, setSemrushPaid] = useState("");
  const [semrushPaidKeywords, setSemrushPaidKeywords] = useState("");
  const [ocrError, setOcrError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onOcrFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    // 允许重复选择同一文件
    e.target.value = "";
    if (!f) return;
    setOcrBusy(true);
    setOcrError(null);
    try {
      const fd = new FormData();
      fd.append("screenshot", f);
      const r = await ocrScreenshotAction(fd);
      if (r.ok) {
        setOcr(r.data);
      } else {
        setOcrError(`${d.ocrFailed}：${r.error}`);
      }
    } finally {
      setOcrBusy(false);
    }
  }

  function submitManual() {
    if (!onRecheck) return;
    const b = brand.trim();
    const vRaw = visits.trim();
    let v: number | undefined;
    if (vRaw) {
      const n = Number(vRaw);
      if (!Number.isInteger(n) || n <= 0 || n > 1e12) {
        setManualError(d.manualInvalid);
        return;
      }
      v = n;
    }
    // SEMrush 三字段：organic 正整数；paid/paidKeywords 非负整数（0 允许）
    const parsePosInt = (raw: string): number | undefined | "invalid" => {
      const t = raw.trim();
      if (!t) return undefined;
      const n = Number(t);
      if (!Number.isInteger(n) || n <= 0 || n > 1e12) return "invalid";
      return n;
    };
    const parseNonNegInt = (raw: string): number | undefined | "invalid" => {
      const t = raw.trim();
      if (!t) return undefined;
      const n = Number(t);
      if (!Number.isInteger(n) || n < 0 || n > 1e12) return "invalid";
      return n;
    };
    const organic = parsePosInt(semrushOrganic);
    const paid = parseNonNegInt(semrushPaid);
    const paidKw = parseNonNegInt(semrushPaidKeywords);
    if (organic === "invalid" || paid === "invalid" || paidKw === "invalid") {
      setManualError(d.manualInvalid);
      return;
    }
    if (!b && v === undefined && organic === undefined && paid === undefined) {
      setManualError(d.manualInvalid);
      return;
    }
    setManualError(null);
    onRecheck({
      ...(b ? { brand: b } : {}),
      ...(v !== undefined ? { manualMonthlyVisits: v } : {}),
      ...(organic !== undefined ? { organicTraffic: organic } : {}),
      ...(paid !== undefined ? { paidTraffic: paid } : {}),
      ...(paidKw !== undefined ? { paidKeywords: paidKw } : {}),
    });
  }

  const manualSection =
    onRecheck ? (
      <div className="mt-3 rounded-lg border border-dashed border-ink/20 p-3">
        <button
          type="button"
          className="flex w-full items-center justify-between text-sm font-medium text-ink"
          onClick={() => setManualOpen(!open)}
          aria-expanded={open}
        >
          <span>{d.manualTitle}</span>
          <span aria-hidden className="text-xs text-ink/50">
            {open ? "▲" : "▼"}
          </span>
        </button>
        {open ? (
          <div className="mt-2 space-y-2">
            <div>
              <label className="mb-1 block text-xs text-ink/60">{d.manualBrandLabel}</label>
              <input
                className="w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
                placeholder={d.manualBrandPlaceholder}
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                maxLength={64}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink/60">{d.manualVisitsLabel}</label>
              <input
                className="w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
                placeholder={d.manualVisitsPlaceholder}
                value={visits}
                onChange={(e) => setVisits(e.target.value)}
                inputMode="numeric"
              />
            </div>
            <p className="text-xs text-ink/50">{d.manualHint}</p>
            <div className="rounded-lg bg-ink/[0.03] p-2">
              <p className="mb-2 text-xs font-medium text-ink/70">
                {d.semrushHint}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-ink/60">
                    {d.semrushOrganicLabel}
                  </label>
                  <input
                    className="w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
                    placeholder={d.semrushOrganicPlaceholder}
                    value={semrushOrganic}
                    onChange={(e) => setSemrushOrganic(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ink/60">
                    {d.semrushPaidLabel}
                  </label>
                  <input
                    className="w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
                    placeholder={d.semrushPaidPlaceholder}
                    value={semrushPaid}
                    onChange={(e) => setSemrushPaid(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ink/60">
                    {d.semrushPaidKeywordsLabel}
                  </label>
                  <input
                    className="w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
                    placeholder={d.semrushPaidKeywordsPlaceholder}
                    value={semrushPaidKeywords}
                    onChange={(e) => setSemrushPaidKeywords(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
              </div>
            </div>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onOcrFile}
              />
              <button
                type="button"
                className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5 disabled:opacity-50"
                disabled={ocrBusy}
                onClick={() => fileRef.current?.click()}
              >
                {ocrBusy ? d.ocrUploading : d.ocrUpload}
              </button>
              <p className="mt-1 text-xs text-ink/50">{d.ocrHint}</p>
              {ocrError ? (
                <p className="mt-1 text-xs text-red-600">{ocrError}</p>
              ) : null}
              {ocr ? (
                <div className="mt-2 rounded-lg bg-ink/[0.03] p-2 text-xs text-ink/70">
                  <p className="font-medium text-ink/80">
                    {d.ocrReviewNote}
                    {ocr.confidence !== null ? `（${ocr.confidence}%）` : null}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    <li>
                      评分：{ocr.rating ?? "—"}　评论数：
                      {ocr.reviewCount ?? "—"}　价格：
                      {ocr.price !== null
                        ? `${ocr.currency ?? ""} ${ocr.price}`
                        : "—"}
                      　月销：{ocr.soldCount ?? "—"}
                    </li>
                  </ul>
                </div>
              ) : null}
            </div>
            {manualError ? (
              <p className="text-xs text-red-600">{manualError}</p>
            ) : null}
            <button
              type="button"
              className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              disabled={recheckBusy}
              onClick={submitManual}
            >
              {recheckBusy ? d.rechecking : d.recheck}
            </button>
          </div>
        ) : null}
      </div>
    ) : null;

  if (loading) {
    return (
      <section className="rounded-xl border border-ink/10 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{d.title}</h3>
          <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs text-ink/60">
            {d.loading}
          </span>
        </div>
        <div className="mt-3 space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-ink/10" />
          ))}
        </div>
      </section>
    );
  }

  if (!gate) {
    return (
      <section className="rounded-xl border border-ink/10 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{d.title}</h3>
          <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs text-ink/60">
            {d.notChecked}
          </span>
        </div>
        <p className="mt-2 text-sm text-ink/50">{d.notChecked}</p>
        {/* 无数据时也给手动区：无历史分析记录也能点"检测"。 */}
        {manualSection}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-ink/10 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{d.title}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(gate.passed)}`}
        >
          {gate.passed === true
            ? d.passed
            : gate.passed === false
              ? d.notPassed
              : d.noData}
        </span>
      </div>

      {gate.officialSite ? (
        <p
          className={`mt-2 text-sm ${gate.officialSite.found ? "text-green-700" : "text-ink/50"}`}
        >
          {gate.officialSite.found ? d.officialSiteFound : d.officialSiteNotFound}
          {gate.officialSite.domain ? `：${gate.officialSite.domain}` : null}
          {gate.officialSite.confidence ? (
            <span className="text-xs text-ink/40">（{gate.officialSite.confidence}）</span>
          ) : null}
        </p>
      ) : null}
      {gate.officialSite?.reason ? (
        <p className="mt-1 text-xs text-ink/55">{gate.officialSite.reason}</p>
      ) : null}

      <div className="mt-2">
        <p className="text-xs font-medium text-ink/55">{d.reason}</p>
        <p className="mt-0.5 text-sm text-ink/80">{gate.reason}</p>
      </div>

      {gate.signals.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-ink/55">{d.signals}</p>
          <ul className="mt-1 space-y-1.5">
            {gate.signals.map((s, i) => (
              <SignalRow
                key={`${s.source}-${i}`}
                source={s.source}
                label={s.label}
                value={s.value}
                threshold={s.threshold}
                passed={s.passed}
                note={s.note}
                dict={d}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {manualSection}
    </section>
  );
}
