import { AiPromptsAdminClient } from "@/components/admin/ai-prompts-admin-client";

export const dynamic = "force-dynamic";

/** P1-18：提示词 DB 化 — 管理页（admin/owner）。 */
export default function AiPromptsAdminPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">AI 提示词管理</h1>
      <div className="mt-4">
        <AiPromptsAdminClient />
      </div>
    </div>
  );
}
