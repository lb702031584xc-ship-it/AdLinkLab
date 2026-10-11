import { getCurrentUser } from "@/lib/api/auth";
import { getAiSettingsAction } from "@/lib/api/ai-actions";
import { TrafficPlannerClient } from "@/components/ai/traffic-planner-client";

export const dynamic = "force-dynamic";

/** 投流决策 AI 分析：2×2 组合 × 多数据源 → 五板块投放方案。 */
export default async function TrafficPlannerPage() {
  const user = await getCurrentUser();
  const isAdmin = user?.role === "admin";

  let showSetupNudge = false;
  if (isAdmin) {
    const settings = await getAiSettingsAction();
    if (settings.ok && !settings.data.configured) showSetupNudge = true;
  }

  return <TrafficPlannerClient showSetupNudge={showSetupNudge} />;
}
