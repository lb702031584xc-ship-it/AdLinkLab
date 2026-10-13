import { getCurrentUser } from "@/lib/api/auth";
import { getAiSettingsAction } from "@/lib/api/ai-actions";
import { BlueprintClient } from "@/components/ai/blueprint-client";

export const dynamic = "force-dynamic";

/** Offer 一键推演报告：输入 offer → 一次生成 7 节投放推演。 */
export default async function AiBlueprintPage() {
  const user = await getCurrentUser();
  const isAdmin = user?.role === "admin";

  let showSetupNudge = false;
  if (isAdmin) {
    const settings = await getAiSettingsAction();
    if (settings.ok && !settings.data.configured) showSetupNudge = true;
  }

  return <BlueprintClient showSetupNudge={showSetupNudge} />;
}
