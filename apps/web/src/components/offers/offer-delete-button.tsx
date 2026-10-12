"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { entityApi } from "@/lib/api/entities";

export function OfferDeleteButton({
  offerId,
  offerName,
  dict,
}: {
  offerId: string;
  offerName: string;
  dict: { delete: string; deleteConfirm: string; deleting: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    if (!window.confirm(`${dict.deleteConfirm}\n${offerName}`)) return;
    setBusy(true);
    try {
      await entityApi.offers.remove(offerId);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={onDelete}
      disabled={busy}
      className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 transition hover:bg-red-50 disabled:opacity-50"
    >
      {busy ? dict.deleting : dict.delete}
    </button>
  );
}
