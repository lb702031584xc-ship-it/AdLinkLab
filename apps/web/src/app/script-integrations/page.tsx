import Link from "next/link";
import { adminScriptApi } from "@/lib/api/admin-script";
import { mapAdminErrorMessage } from "@/lib/api/admin-script-config";

export const dynamic = "force-dynamic";

export default async function ScriptIntegrationsPage() {
  let error: string | null = null;
  let items: Awaited<
    ReturnType<typeof adminScriptApi.listIntegrations>
  >["items"] = [];

  try {
    const res = await adminScriptApi.listIntegrations();
    items = res.items;
  } catch (e) {
    error = mapAdminErrorMessage(e);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-ink/50">
            Script Integrations
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold text-ink">
            Integrations
          </h1>
          <p className="mt-2 max-w-2xl text-ink/70">
            Manage Google Ads Script Integrations, targets, and secure script
            generation. Desired URLs come from ACTIVE UrlVersion only.
          </p>
        </div>
        <Link
          href="/script-integrations/new"
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper"
        >
          Create Integration
        </Link>
      </div>

      {error ? (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-8 overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-ink/5 text-ink/60">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Google Account</th>
              <th className="px-3 py-2">Targets</th>
              <th className="px-3 py-2">Token</th>
              <th className="px-3 py-2">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.integrationId} className="border-t border-ink/10">
                <td className="px-3 py-2">
                  <Link
                    className="font-medium underline-offset-2 hover:underline"
                    href={`/script-integrations/${i.integrationId}`}
                  >
                    {i.name}
                  </Link>
                </td>
                <td className="px-3 py-2">{i.status}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {i.googleAccountId.slice(0, 8)}…
                </td>
                <td className="px-3 py-2">{i.targetCount}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {i.tokenStatus} · {i.tokenPrefix}…
                </td>
                <td className="px-3 py-2 text-xs">{i.lastSeenAt ?? "—"}</td>
              </tr>
            ))}
            {items.length === 0 && !error ? (
              <tr>
                <td className="px-3 py-6 text-ink/50" colSpan={6}>
                  No integrations yet. Create one to get started.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-sm text-ink/55">
        Read-only sync health also available on{" "}
        <Link href="/dashboard" className="underline">
          Dashboard
        </Link>
        .
      </p>
    </div>
  );
}
