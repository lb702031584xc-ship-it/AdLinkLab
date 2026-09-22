import Link from "next/link";
import { adminScriptApi } from "@/lib/api/admin-script";
import { mapAdminErrorMessage } from "@/lib/api/admin-script-config";
import { IntegrationDetailClient } from "@/components/admin/integration-detail-client";

export const dynamic = "force-dynamic";

export default async function ScriptIntegrationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let error: string | null = null;
  let integration = null;
  let targets: Awaited<
    ReturnType<typeof adminScriptApi.listTargets>
  >["items"] = [];
  let ads: Array<{ id: string; name: string; googleAdId: string }> = [];

  try {
    const [detail, targetRes, adsRes] = await Promise.all([
      adminScriptApi.getIntegration(id),
      adminScriptApi.listTargets(id),
      adminScriptApi.listAds(),
    ]);
    integration = detail;
    targets = targetRes.items;
    ads = (adsRes.items ?? []).map((a) => ({
      id: a.id,
      name: a.name || a.googleAdId,
      googleAdId: a.googleAdId,
    }));
  } catch (e) {
    error = mapAdminErrorMessage(e);
  }

  if (error || !integration) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-red-700">{error ?? "Integration not found"}</p>
        <Link href="/script-integrations" className="mt-4 inline-block underline">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Link
        href="/script-integrations"
        className="text-sm text-ink/60 hover:underline"
      >
        ← Integrations
      </Link>
      <h1 className="mt-3 font-display text-4xl font-semibold text-ink">
        {integration.name}
      </h1>
      <div className="mt-8">
        <IntegrationDetailClient
          integration={integration}
          targets={targets}
          ads={ads}
        />
      </div>
    </div>
  );
}
