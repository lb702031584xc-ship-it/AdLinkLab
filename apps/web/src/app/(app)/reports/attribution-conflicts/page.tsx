import { getLang } from "@/i18n/lang";
import { AttributionConflictsClient } from "@/components/reports/attribution-conflicts-client";

export const dynamic = "force-dynamic";

/** P1-11：归因冲突（归因设置 + 冲突手动解决 + 可归因/不可归因拆分）。 */
export default async function AttributionConflictsPage() {
  const lang = await getLang();
  const dict =
    lang === "en"
      ? {
          title: "Attribution conflicts",
          settingsTitle: "Attribution settings",
          windowDays: "Attribution window (days)",
          dedupeMinutes: "GCLID dedupe (minutes)",
          dupCounts: "Duplicate clicks count as conversions",
          save: "Save",
          saving: "Saving…",
          saved: "Saved.",
          conflictsTitle: "Conflicts",
          empty: "No attribution conflicts.",
          order: "Order",
          candidates: "Candidate offers",
          reason: "Reason",
          status: "Status",
          resolve: "Attribute to",
          resolving: "Resolving…",
          resolved: "Resolved.",
          resolveConfirm: "Attribute this order to the selected offer? This writes an audit log.",
          reportTitle: "Attributable vs unattributable",
          attributable: "Attributable",
          unattributable: "Unattributable",
          unattributableNote: "Unattributable orders (e.g. bought a non-promoted product) count toward the brand only, not a single product.",
          byOffer: "By offer",
          orders: "Orders",
          value: "Value",
        }
      : {
          title: "归因冲突",
          settingsTitle: "归因设置",
          windowDays: "归因窗口（天）",
          dedupeMinutes: "GCLID 去重（分钟）",
          dupCounts: "重复点击计为转化",
          save: "保存",
          saving: "保存中…",
          saved: "已保存。",
          conflictsTitle: "冲突列表",
          empty: "暂无归因冲突。",
          order: "订单",
          candidates: "候选 Offer",
          reason: "原因",
          status: "状态",
          resolve: "归属到",
          resolving: "处理中…",
          resolved: "已解决。",
          resolveConfirm: "把该订单归属到所选 Offer？操作会写审计日志。",
          reportTitle: "可归因 vs 不可归因",
          attributable: "可归因",
          unattributable: "不可归因",
          unattributableNote: "不可归因订单（如“买了未投商品”）只归品牌，不归到某个商品；佣金按品牌口径统计，不进单品 ROI。",
          byOffer: "按 Offer",
          orders: "订单数",
          value: "金额",
        };
  return <AttributionConflictsClient dict={dict} />;
}
