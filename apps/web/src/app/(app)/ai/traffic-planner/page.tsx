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
      /* invalid id: fall through to last-used offer */
    }
  }
  if (!initialOffer) {
    // 没带有效 offerId：接上上次在这个页工作过的 offer（而不是全空）
    try {
      const { listWorkStateHistory } = await import("@/lib/api/work-state");
      const hist = await listWorkStateHistory("traffic-planner", { limit: 5 });
      const lastOfferId = hist.find((h) => h.offerId)?.offerId;
      if (lastOfferId) {
        initialOffer = toPlannerOffer(await entityApi.offers.get(lastOfferId));
      }
    } catch {
      /* no history / offer gone: render empty */
    }
  }

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
