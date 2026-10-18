import { getCurrentUser } from "@/lib/api/auth";
import { getAiSettingsAction } from "@/lib/api/ai-actions";
import { entityApi } from "@/lib/api/entities";
import { BlueprintClient, type BlueprintOffer } from "@/components/ai/blueprint-client";

export const dynamic = "force-dynamic";

/** Offer 一键推演报告：输入 offer → 一次生成 7 节投放推演。 */
export default async function AiBlueprintPage({
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

  let initialOffer: BlueprintOffer | null = null;
  if (sp.offerId) {
    try {
      const o = await entityApi.offers.get(sp.offerId);
      initialOffer = {
        id: o.id, name: o.name, network: o.network,
        destinationUrl: o.destinationUrl, affiliateUrl: o.affiliateUrl,
        commissionValue: o.commissionValue, commissionType: o.commissionType,
        avgPrice: o.avgPrice,
      };
    } catch {
      /* invalid id */
    }
  }
  let offers: BlueprintOffer[] = [];
  try {
    const data = await entityApi.offers.list(1, 200);
    offers = (data.items ?? []).map((o) => ({
      id: o.id, name: o.name, network: o.network,
      destinationUrl: o.destinationUrl, affiliateUrl: o.affiliateUrl,
      commissionValue: o.commissionValue, commissionType: o.commissionType,
      avgPrice: o.avgPrice,
    }));
  } catch {
    /* page still renders */
  }

  return (
    <BlueprintClient
      showSetupNudge={showSetupNudge}
      initialOffer={initialOffer}
      offers={offers}
    />
  );
}
