/**
 * 广告活动体检（2026-10-28，纯函数）。
 *
 * 回答一个问题：现在跑着的这些广告，哪些该暂停、哪些该修、哪些该加钱。
 *
 * 复用测试阶段判定（test-verdict）——一条广告和一个 offer 的判定逻辑本来
 * 就是同一件事：花了多少、拿到多少点击、有没有转化、和保本线差多少。
 * 这里只做「按动作分组 + 按浪费金额排序」，不重新发明判定规则。
 *
 * 纪律：
 *   - 只对「有花费」的项算浪费金额；没花钱的不算浪费；
 *   - 暂停建议永远带原因，不允许只给一个红色按钮；
 *   - 数据不足的归 keep（继续观察），不因为「看不懂」就建议关掉。
 */
import { judgeTestStage, type TestStage } from "./test-verdict.js";

export interface CampaignRow {
  id: string;
  name: string;
  /** 账户里的状态（ENABLED / PAUSED …），仅作回显，不参与判定。 */
  status?: string | null;
  impressions: number;
  clicks: number;
  costUsd: number;
  conversions: number;
  revenueUsd: number;
  daysRunning?: number | null;
  /** 单笔佣金（美元）；用于止损线与保本 CVR。 */
  payoutUsd?: number | null;
  /** 保本 CVR（%）；给了就不用再按 payout 推。 */
  breakevenCvrPct?: number | null;
}

export type CampaignAction = "pause" | "fix" | "keep" | "scale";

export interface CampaignAuditItem {
  id: string;
  name: string;
  action: CampaignAction;
  stage: TestStage;
  reason: string;
  /** 建议暂停时，这条已经花掉的钱（其他动作为 0）。 */
  wastedUsd: number;
  metrics: {
    costUsd: number;
    clicks: number;
    ctrPct: number | null;
    cvrPct: number | null;
    roas: number | null;
  };
}

export interface CampaignAuditResult {
  items: CampaignAuditItem[];
  summary: {
    pause: number;
    fix: number;
    keep: number;
    scale: number;
    totalWastedUsd: number;
  };
  notes: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const numOr = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function actionOf(action: string): CampaignAction {
  if (action === "stop") return "pause";
  if (action === "fix_delivery" || action === "fix_creatives") return "fix";
  if (action === "scale_20" || action === "scale_50") return "scale";
  return "keep";
}

const ACTION_ORDER: Record<CampaignAction, number> = {
  pause: 0,
  fix: 1,
  keep: 2,
  scale: 3,
};

export function auditCampaigns(rows: CampaignRow[]): CampaignAuditResult {
  const items: CampaignAuditItem[] = [];

  for (const r of rows) {
    const cost = numOr(r.costUsd);
    const clicks = numOr(r.clicks);
    const conversions = numOr(r.conversions);
    const revenue = numOr(r.revenueUsd);
    const impressions = numOr(r.impressions);

    const verdict = judgeTestStage({
      clicks,
      spendUsd: cost,
      conversions,
      revenueUsd: revenue,
      impressions,
      payoutUsd: r.payoutUsd ?? null,
      breakevenCvrPct: r.breakevenCvrPct ?? null,
    });

    const action = actionOf(verdict.action);
    items.push({
      id: r.id,
      name: r.name,
      action,
      stage: verdict.stage,
      reason: verdict.reasons[0] ?? "",
      wastedUsd: action === "pause" ? round2(cost) : 0,
      metrics: {
        costUsd: round2(cost),
        clicks,
        ctrPct: verdict.ctrPct,
        cvrPct: verdict.actualCvrPct,
        roas: cost > 0 ? round2(revenue / cost) : null,
      },
    });
  }

  // 先按动作分组（暂停最前），组内按花费降序——先处理最烧钱的。
  items.sort(
    (a, b) =>
      ACTION_ORDER[a.action] - ACTION_ORDER[b.action] ||
      b.wastedUsd - a.wastedUsd ||
      b.metrics.costUsd - a.metrics.costUsd
  );

  const summary = {
    pause: items.filter((x) => x.action === "pause").length,
    fix: items.filter((x) => x.action === "fix").length,
    keep: items.filter((x) => x.action === "keep").length,
    scale: items.filter((x) => x.action === "scale").length,
    totalWastedUsd: round2(
      items.reduce((s, x) => s + (x.action === "pause" ? x.wastedUsd : 0), 0)
    ),
  };

  const notes: string[] = [];
  if (summary.pause > 0) {
    notes.push(
      `有 ${summary.pause} 条建议暂停，合计已花 $${summary.totalWastedUsd}。建议逐条暂停并记录原因，不要一次全关——全关会让账户失去投放历史`
    );
  }
  if (summary.fix > 0) {
    notes.push(
      `${summary.fix} 条属于「投放设置或文案问题」：改文案/换词/调出价，而不是直接关掉`
    );
  }
  if (summary.keep > 0) {
    notes.push(`${summary.keep} 条数据不足，继续跑到 200 点击再判，别急着动`);
  }
  if (summary.pause === 0 && summary.fix === 0) {
    notes.push("没有明显该停的项：当前所有在跑的活动都还没到可以下结论的程度");
  }
  notes.push(
    "判定门槛：<50 点击＝没拿到量；<200 点击＝样本不足；CTR<1%＝文案问题；花费≥3×佣金且 0 转化＝判死"
  );

  return { items, summary, notes };
}
