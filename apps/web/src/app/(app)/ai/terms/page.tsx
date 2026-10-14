import { getCurrentUser } from "@/lib/api/auth";
import { getAiSettingsAction } from "@/lib/api/ai-actions";
import { entityApi } from "@/lib/api/entities";
import { TermsClient, type TermsOffer } from "@/components/ai/terms-client";

export const dynamic = "force-dynamic";

/** Offer terms parsing + batch screening workbench. 支持 ?offerId= 带入 offer 上下文。 */
export default async function AiTermsPage({
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

  let initialOffer: TermsOffer | null = null;
  if (sp.offerId) {
    try {
      const o = await entityApi.offers.get(sp.offerId);
      initialOffer = { id: o.id, name: o.name, network: o.network };
    } catch {
      /* invalid id */
    }
  }
  let offers: TermsOffer[] = [];
  try {
    const data = await entityApi.offers.list(1, 200);
    offers = (data.items ?? []).map((o) => ({ id: o.id, name: o.name, network: o.network }));
  } catch {
    /* page still renders */
  }

  return (
    <TermsClient
      isAdmin={isAdmin}
      showSetupNudge={showSetupNudge}
      initialOffer={initialOffer}
      offers={offers}
    />
  );
}
