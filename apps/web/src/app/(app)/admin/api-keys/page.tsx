import { redirect } from "next/navigation";
import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/admin-api-keys";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  type Column,
} from "@/components/entities/ui";
import { getCurrentUser } from "@/lib/api/auth";
import { listApiKeys, type AdminApiKey } from "@/lib/api/api-keys-actions";
import { formatDateTime } from "@/lib/api/entities-config";
import { CreateApiKeyForm } from "./_components/create-api-key-form";
import { ApiKeyRowActions } from "./_components/api-key-row-actions";

export const dynamic = "force-dynamic";

/** Admin-only: manage DB-backed API keys — create, rotate, revoke. */
export default async function AdminApiKeysPage() {
  const lang = await getLang();
  const t = lang === "en" ? en : zh;

  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/dashboard");

  const rows = await listApiKeys();
  if (rows === null) {
    return (
      <div>
        <EntityPageHeader title={t.title} description={t.description} />
        <ErrorState title={t.title} message={t.errors.loadError} />
      </div>
    );
  }

  const columns: Array<Column<AdminApiKey>> = [
    {
      header: t.table.name,
      render: (k) => <span className="font-medium text-ink">{k.name}</span>,
    },
    {
      header: t.table.prefix,
      render: (k) => (
        <span className="font-mono text-[13px] text-ink/70">{k.keyPrefix}</span>
      ),
    },
    {
      header: t.table.scopes,
      render: (k) => (
        <span className="text-ink/80">
          {k.scopes.length > 0 ? k.scopes.join(", ") : t.rowActions.none}
        </span>
      ),
    },
    {
      header: t.table.ipWhitelist,
      render: (k) => (
        <span className="font-mono text-[13px] text-ink/80">
          {k.ipWhitelist.length > 0 ? k.ipWhitelist.join(", ") : t.rowActions.none}
        </span>
      ),
    },
    {
      header: t.table.expires,
      render: (k) => (
        <span className="whitespace-nowrap text-ink/70">
          {k.expiresAt ? formatDateTime(k.expiresAt) : t.rowActions.none}
        </span>
      ),
    },
    {
      header: t.table.lastUsed,
      render: (k) => (
        <span className="whitespace-nowrap text-ink/70">
          {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : t.rowActions.never}
        </span>
      ),
    },
    {
      header: t.table.status,
      render: (k) => (
        <span className="inline-block rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink/70">
          {t.status[k.status] ?? k.status}
        </span>
      ),
    },
    {
      header: t.table.actions,
      render: (k) => (
        <ApiKeyRowActions keyId={k.id} status={k.status} t={t} />
      ),
    },
  ];

  return (
    <div>
      <EntityPageHeader title={t.title} description={t.description} />
      <CreateApiKeyForm t={t} />
      <DataTable columns={columns} rows={rows} emptyText={t.empty} />
    </div>
  );
}
