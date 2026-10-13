-- 工作台状态持久化：AI 分析 worksheet / 投放选词 / 需求验证 的自动保存快照
-- 解决刷新/隔夜后分析进度丢失、无历史记录的问题
CREATE TABLE "work_states" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "page" TEXT NOT NULL,
    "offer_id" UUID,
    "label" TEXT,
    "state" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "work_states_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "work_states_tenant_page_updated_idx" ON "work_states"("tenant_id", "page", "updated_at" DESC);
