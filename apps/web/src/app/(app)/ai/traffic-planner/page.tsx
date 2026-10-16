import { getCurrentUser } from "@/lib/api/auth";
import { getAiSettingsAction } from "@/lib/api/ai-actions";
import { entityApi } from "@/lib/api/entities";
import {
  TrafficPlannerClient,
  type PlannerOffer,
} from "@/components/ai/traffic-planner-client";

export const dynamic = "force-dynamic";

/** 投流决策 AI 分析：2×2 组合 × 多数据源 → 五板块投放方案。支持 ?offerId= 带入 offer 上下文。 */
export default async function TrafficPlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ offerId?: string }>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const isAdmin = user?.role === "admin";

  let showSetupNudge = false;
  if (isAdmin) {
    const settings = await getAiSettingsAction();
    if (settings.ok && !settings.data.configured) showSetupNudge = true;
  }

  const toPlannerOffer = (o: {
    id: string;
    name: string;
    network: string;
    commissionValue?: string | number | null;
    commissionType?: string | null;
    avgPrice?: string | number | null;
  }): PlannerOffer => ({
    id: o.id,
    name: o.name,
    network: o.network,
    commissionValue: o.commissionValue,
    commissionType: o.commissionType,
    avgPrice: o.avgPrice,
  });

  let initialOffer: PlannerOffer | null = null;
  if (sp.offerId) {
    try {
      initialOffer = toPlannerOffer(await entityApi.offers.get(sp.offerId));
    } catch {
      /* invalid id: render empty — no implicit fallback to a previous offer */
    }
  }
  // 没带有效 offerId 时不接上次 offer：输入框保持空，旧数据是历史，
  // 只有明确选了 offer 才载入该 offer 的快照。

  let offers: PlannerOffer[] = [];
  try {
    const data = await entityApi.offers.list(1, 200);
    offers = (data.items ?? []).map(toPlannerOffer);
  } catch {
    /* page still renders; selector will be empty */
  }

  return (
    <TrafficPlannerClient
      showSetupNudge={showSetupNudge}
      initialOffer={initialOffer}
      offers={offers}
    />
  );
}
