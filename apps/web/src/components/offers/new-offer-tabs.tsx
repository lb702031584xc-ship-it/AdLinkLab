"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader } from "@/components/entities/ui";
import { OfferForm } from "@/components/entities/offer-form";
import { OfferImportClient } from "@/components/offers/import-client";

export function NewOfferTabs() {
  const t = useDict();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "import" ? "import" : "manual";
  const initialSource = searchParams.get("source") ?? undefined;
  /* 亚马逊流水线「建 Offer」带入：name→名称、price→均价、asin→名称下方来源提示。 */
  const initialName = searchParams.get("name") ?? undefined;
  const initialPrice = searchParams.get("price") ?? undefined;
  const initialAsin = searchParams.get("asin") ?? undefined;
  const [tab, setTab] = useState<"manual" | "import">(initialTab);

  const tabClass = (active: boolean) =>
    `rounded-lg px-4 py-2 text-sm font-medium transition ${
      active ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
    }`;

  return (
    <div className="mx-auto max-w-2xl">
      <EntityPageHeader
        title={t.entities.offers.new.title}
        description={t.entities.offers.new.description}
      />
      <div className="mt-4 inline-flex rounded-xl bg-ink/5 p-1">
        <button
          type="button"
          onClick={() => setTab("manual")}
          className={tabClass(tab === "manual")}
        >
          手动新建
        </button>
        <button
          type="button"
          onClick={() => setTab("import")}
          className={tabClass(tab === "import")}
        >
          批量导入
        </button>
      </div>
      <div className="mt-6">
        {tab === "manual" ? (
          <OfferForm
            initialSource={initialSource}
            initialName={initialName}
            initialPrice={initialPrice}
            initialAsin={initialAsin}
          />
        ) : (
          <OfferImportClient />
        )}
      </div>
    </div>
  );
}
