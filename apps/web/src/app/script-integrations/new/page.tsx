import { adminScriptApi } from "@/lib/api/admin-script";
import { mapAdminErrorMessage } from "@/lib/api/admin-script-config";
import { CreateIntegrationForm } from "@/components/admin/create-integration-form";

export const dynamic = "force-dynamic";

export default async function NewScriptIntegrationPage() {
  let error: string | null = null;
  let accounts: Array<{ id: string; name: string }> = [];
  try {
    const res = await adminScriptApi.listGoogleAccounts();
    accounts = (res.items ?? []).map((a) => ({
      id: a.id,
      name: a.name || a.id,
    }));
  } catch (e) {
    error = mapAdminErrorMessage(e);
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="font-display text-3xl font-semibold text-ink">
        Create Integration
      </h1>
      <p className="mt-2 text-ink/70">
        Name + Google Account only. No proxy, UA, or Referer fields.
      </p>
      {error ? (
        <p className="mt-4 text-sm text-red-700">{error}</p>
      ) : (
        <div className="mt-6">
          <CreateIntegrationForm accounts={accounts} />
        </div>
      )}
    </div>
  );
}
