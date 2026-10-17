import { getCurrentUser } from "@/lib/api/auth";
import { getAiSettingsAction } from "@/lib/api/ai-actions";
import { entityApi } from "@/lib/api/entities";
import {
  WorksheetClient,
  type WorksheetOffer,
  type WorksheetSource,
} from "@/components/ai/worksheet-client";

export const dynamic = "force-dynamic";

/**
 * AI analysis worksheet: 4 steps in workflow order
 * (terms → compliance → profit → traffic planning) + overall verdict.
 * Supports ?offerId= (prefills the subject header) and
 * ?source=affiliate|amazon|cashback.
 */
export default async function AiAnalyzePage({
  searchParams,
}: {
  searchParams: Promise<{ offerId?: string; source?: string }>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const isAdmin = user?.role === "admin";

  let showSetupNudge = false;
  let initialOwnedDomains: string[] = [];
  if (isAdmin) {
    const settings = await getAiSettingsAction();
    if (settings.ok) {
      if (!settings.data.configured) showSetupNudge = true;
      initialOwnedDomains = settings.data.ownedDomains ?? [];
    }
  }

  let initialOffer: WorksheetOffer | null = null;
  if (sp.offerId) {
    try {
      const o = await entityApi.offers.get(sp.offerId);
      initialOffer = {
        id: o.id,
        name: o.name,
        network: o.network,
        destinationUrl: o.destinationUrl,
        commissionValue: o.commissionValue,
        commissionType: o.commissionType,
        avgPrice: o.avgPrice,
        source: o.source,
      };
    } catch {
      /* invalid id: render worksheet without a subject */
    }
  }

  // Offer 选择器用：拉取 offer 库列表
  let offers: WorksheetOffer[] = [];
  try {
    const data = await entityApi.offers.list(1, 200);
    offers = (data.items ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      network: o.network,
      destinationUrl: o.destinationUrl,
      commissionValue: o.commissionValue,
      commissionType: o.commissionType,
      avgPrice: o.avgPrice,
      source: o.source,
    }));
  } catch {
    /* page still renders; selector will be empty */
  }

  const s = sp.source;
  const initialSource: WorksheetSource =
    s === "amazon" || s === "cashback" ? s : "affiliate";

  return (
    <WorksheetClient
      isAdmin={isAdmin}
      showSetupNudge={showSetupNudge}
      initialOwnedDomains={initialOwnedDomains}
      initialOffer={initialOffer}
      initialSource={initialSource}
      offers={offers}
    />
  );
}
