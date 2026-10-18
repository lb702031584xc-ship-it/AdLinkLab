import { getCurrentUser } from "@/lib/api/auth";
import { getAiSettingsAction } from "@/lib/api/ai-actions";
import { entityApi } from "@/lib/api/entities";
import { ComplianceClient, type ComplianceOffer } from "@/components/ai/compliance-client";

export const dynamic = "force-dynamic";

/** Direct-link compliance URL checker. */
export default async function AiCompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ offerId?: string }>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const isAdmin = user?.role === "admin";

  // getAiSettings is admin-only; members just type their domains per check.
  let initialOwnedDomains: string[] = [];
  if (isAdmin) {
    const settings = await getAiSettingsAction();
    if (settings.ok) initialOwnedDomains = settings.data.ownedDomains ?? [];
  }

  let initialOffer: ComplianceOffer | null = null;
  if (sp.offerId) {
    try {
      const o = await entityApi.offers.get(sp.offerId);
      initialOffer = { id: o.id, name: o.name, network: o.network, destinationUrl: o.destinationUrl, affiliateUrl: o.affiliateUrl };
    } catch {
      /* invalid id */
    }
  }
  let offers: ComplianceOffer[] = [];
  try {
    const data = await entityApi.offers.list(1, 200);
    offers = (data.items ?? []).map((o) => ({ id: o.id, name: o.name, network: o.network, destinationUrl: o.destinationUrl, affiliateUrl: o.affiliateUrl }));
  } catch {
    /* page still renders */
  }

  return (
    <ComplianceClient
      isAdmin={isAdmin}
      initialOwnedDomains={initialOwnedDomains}
      initialOffer={initialOffer}
      offers={offers}
    />
  );
}
