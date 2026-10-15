"use client";

import { useState, useTransition } from "react";
import { deleteIntegrationAction } from "@/lib/api/admin-script-actions";
import { useDict } from "@/i18n/use-dict";

export function IntegrationDeleteButton({
  integrationId,
}: {
  integrationId: string;
}) {
  const t = useDict();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className="text-xs text-red-700 underline disabled:opacity-50"
        onClick={() => {
          if (!window.confirm(t.integrations.detail.deleteConfirm)) return;
          setError(null);
          start(async () => {
            const r = await deleteIntegrationAction(integrationId);
            if (!r.ok) setError(r.error);
            else window.location.reload();
          });
        }}
      >
        {t.common.actions.delete}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}
