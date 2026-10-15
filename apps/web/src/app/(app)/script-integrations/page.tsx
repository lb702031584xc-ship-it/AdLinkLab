import Link from "next/link";
import { adminScriptApi } from "@/lib/api/admin-script";
import { mapAdminErrorMessage } from "@/lib/api/admin-script-config";
import { IntegrationDeleteButton } from "@/components/admin/integration-delete-button";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

export default async function ScriptIntegrationsPage() {
  const lang = await getLang();
  const t = getDictionary(lang);
  let error: string | null = null;
  let items: Awaited<
    ReturnType<typeof adminScriptApi.listIntegrations>
  >["items"] = [];

  try {
    const res = await adminScriptApi.listIntegrations();
    items = res.items;
  } catch (e) {
    error = mapAdminErrorMessage(e, lang);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-ink/50">
            {t.common.nav.scriptIntegrations}
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold text-ink">
            {t.integrations.list.title}
          </h1>
          <p className="mt-2 max-w-2xl text-ink/70">
            {t.integrations.list.description}
          </p>
        </div>
        <Link
          href="/script-integrations/new"
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper"
        >
          {t.integrations.list.create}
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
              <th className="px-3 py-2">{t.common.misc.name}</th>
              <th className="px-3 py-2">{t.common.misc.status}</th>
              <th className="px-3 py-2">{t.integrations.list.columns.googleAccount}</th>
              <th className="px-3 py-2">{t.integrations.list.columns.targets}</th>
              <th className="px-3 py-2">{t.integrations.list.columns.token}</th>
              <th className="px-3 py-2">{t.integrations.list.columns.lastSeen}</th>
              <th className="px-3 py-2">{t.common.misc.actions}</th>
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
                <td className="px-3 py-2">
                  <IntegrationDeleteButton integrationId={i.integrationId} />
                </td>
              </tr>
            ))}
            {items.length === 0 && !error ? (
              <tr>
                <td className="px-3 py-6 text-ink/50" colSpan={7}>
                  {t.integrations.list.empty}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-sm text-ink/55">
        {t.integrations.list.footerPrefix}{" "}
        <Link href="/dashboard" className="underline">
          {t.common.nav.dashboard}
        </Link>
        {t.integrations.list.footerSuffix}
      </p>
    </div>
  );
}
