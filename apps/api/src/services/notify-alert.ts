/**
 * P1-22：出站通知（Webhook 优先，邮件延后）。
 *
 * notifyAlert(prisma, alert, { webhookFetch? })：
 * - 按 alert.ruleId 查 AlertRule：channels 含 "webhook" 且 webhookUrl 已配
 *   → POST 通用 JSON（5s 超时）。
 * - Best-effort：Webhook 失败绝不阻塞 Alert 创建，只记 log。
 * - Email 明确延后（本函数不发邮件）。
 */
import type { PrismaClient } from "@adlinklab/database";

export interface AlertLike {
  id: string;
  tenantId: string;
  ruleId: string | null;
  metric: string;
  severity: string;
  message: string;
  createdAt: Date;
}

export interface NotifyAlertDeps {
  webhookFetch?: typeof fetch;
}

const WEBHOOK_TIMEOUT_MS = 5000;

export async function notifyAlert(
  prisma: PrismaClient,
  alert: AlertLike,
  deps: NotifyAlertDeps = {}
): Promise<void> {
  try {
    if (!alert.ruleId) return;
    const rule = await prisma.alertRule.findUnique({
      where: { id: alert.ruleId },
      select: { name: true, channels: true, webhookUrl: true },
    });
    if (!rule) return;
    const channels = (rule.channels ?? []) as string[];
    if (!channels.includes("webhook")) return;
    if (!rule.webhookUrl) return;
    const fetchImpl = deps.webhookFetch ?? fetch;
    const payload = {
      event: "alert.created",
      alertId: alert.id,
      tenantId: alert.tenantId,
      ruleName: rule.name,
      metric: alert.metric,
      severity: alert.severity,
      message: alert.message,
      createdAt: alert.createdAt.toISOString(),
    };
    const res = await fetchImpl(rule.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(
        `[notify] webhook failed for alert ${alert.id}: HTTP ${res.status}`
      );
    }
  } catch (e) {
    // Best-effort：通知失败绝不阻塞 Alert 创建。
    console.error(`[notify] notifyAlert failed for alert ${alert.id}`, e);
  }
}
