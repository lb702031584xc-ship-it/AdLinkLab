import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/arb-coach";
import { ArbCoachBoard } from "@/components/arb-coach/arb-coach-board";

export const dynamic = "force-dynamic";

/**
 * ⚡套利教练 / 速测看板独立页：与总览页 Phase 4 共用 ArbCoachBoard 组件、
 * 同一份 localStorage 数据，跨页实时同步。
 */
export default async function ArbCoachBoardPage() {
  const lang = await getLang();
  const l = lang === "en" ? "en" : "zh";
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">
          {(l === "en" ? en : zh).board.title}
        </h1>
        <p className="mt-2 text-sm text-ink/60">
          {(l === "en" ? en : zh).board.desc}
        </p>
      </div>
      <div className="rounded-xl border border-ink/10 bg-white p-5">
        <ArbCoachBoard dict={l === "en" ? en : zh} />
      </div>
    </div>
  );
}
