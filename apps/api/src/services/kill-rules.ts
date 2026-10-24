/**
 * 清单 #6 — 砍线自动化规则引擎（服务层）。
 *
 * 判定语义：对一条规则，clicks >= clicksThreshold 且
 * (!requireZeroConv || conversions === 0) 即命中。
 * 适用范围：全局规则（offerId=null）+ offerId 匹配的规则。
 *
 * 重要边界：本引擎只做“判定 + 审计落库”。命中时写一条
 * KillRuleEvent（append-only），不实际暂停任何广告系列或链接；
 * 执行动作由调用方 / 后续集成消费审计事件后决定。enabled=false
 * 的命中规则同样写事件，actionTaken=SKIPPED_DISABLED，以留痕
 * “本应触发但被用户关闭了自动执行”。
 *
 * 与原有 kill-switch 的关系（见路由文件头注释）：
 * kill-switch 是花费/政策止损（offer 级配置 + 花费口径）；
 * 本引擎是点击阈值判定 + 审计，两者独立，不互相调用。
 */
import { randomUUID } from "node:crypto";
import { NotFoundError, ValidationError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";

export const KILL_RULE_ACTIONS = [
  "WARN",
  "PAUSE",
  "LOWER_BID",
  "EXCLUDE_ZONE",
] as const;
export type KillRuleAction = (typeof KILL_RULE_ACTIONS)[number];

export type KillRuleEventActionTaken = KillRuleAction | "SKIPPED_DISABLED";

export interface KillRuleRow {
  id: string;
  tenantId: string;
  offerId: string | null;
  name: string;
  clicksThreshold: number;
  requireZeroConv: boolean;
  action: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface KillRuleEventRow {
  id: string;
  tenantId: string;
  ruleId: string;
  offerId: string | null;
  clicks: number;
  conversions: number;
  actionTaken: string;
  snapshot: unknown;
  createdAt: Date;
}

export interface CreateKillRuleInput {
  name: string;
  offerId?: string | null;
  clicksThreshold: number;
  requireZeroConv?: boolean;
  action: KillRuleAction;
  enabled?: boolean;
}

export interface UpdateKillRulePatch {
  name?: string;
  offerId?: string | null;
  clicksThreshold?: number;
  requireZeroConv?: boolean;
  action?: KillRuleAction;
  enabled?: boolean;
}

export function serializeKillRule(row: KillRuleRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    offerId: row.offerId,
    name: row.name,
    clicksThreshold: row.clicksThreshold,
    requireZeroConv: row.requireZeroConv,
    action: row.action,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeKillRuleEvent(row: KillRuleEventRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    ruleId: row.ruleId,
    offerId: row.offerId,
    clicks: row.clicks,
    conversions: row.conversions,
    actionTaken: row.actionTaken,
    snapshot: row.snapshot,
    createdAt: row.createdAt,
  };
}

export function assertValidAction(action: unknown): KillRuleAction {
  if (
    typeof action !== "string" ||
    !(KILL_RULE_ACTIONS as readonly string[]).includes(action)
  ) {
    throw new ValidationError(
      `action must be one of: ${KILL_RULE_ACTIONS.join(", ")}`
    );
  }
  return action as KillRuleAction;
}

export function assertValidClicksThreshold(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new ValidationError("clicksThreshold must be a positive integer");
  }
  return value;
}

export function assertNonNegativeInt(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new ValidationError(`${field} must be a non-negative integer`);
  }
  return value;
}

export async function listKillRules(
  prisma: PrismaClient,
  tenantId: string
): Promise<KillRuleRow[]> {
  const rows = await prisma.killRule.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
  return rows as unknown as KillRuleRow[];
}

export async function createKillRule(
  prisma: PrismaClient,
  tenantId: string,
  input: CreateKillRuleInput
): Promise<KillRuleRow> {
  if (!input.name || !input.name.trim()) {
    throw new ValidationError("name is required");
  }
  const row = await prisma.killRule.create({
    data: {
      id: randomUUID(),
      tenantId,
      offerId: input.offerId ?? null,
      name: input.name.trim(),
      clicksThreshold: assertValidClicksThreshold(input.clicksThreshold),
      requireZeroConv: input.requireZeroConv ?? true,
      action: assertValidAction(input.action),
      enabled: input.enabled ?? true,
    },
  });
  return row as unknown as KillRuleRow;
}

export async function getKillRuleOr404(
  prisma: PrismaClient,
  tenantId: string,
  id: string
): Promise<KillRuleRow> {
  const row = await prisma.killRule.findFirst({
    where: { id, tenantId },
  });
  if (!row) {
    throw new NotFoundError("KillRule", id);
  }
  return row as unknown as KillRuleRow;
}

export async function updateKillRule(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
  patch: UpdateKillRulePatch
): Promise<KillRuleRow> {
  await getKillRuleOr404(prisma, tenantId, id);
  const data: {
    name?: string;
    offerId?: string | null;
    clicksThreshold?: number;
    requireZeroConv?: boolean;
    action?: string;
    enabled?: boolean;
  } = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) {
      throw new ValidationError("name is required");
    }
    data.name = patch.name.trim();
  }
  if (patch.offerId !== undefined) data.offerId = patch.offerId;
  if (patch.clicksThreshold !== undefined) {
    data.clicksThreshold = assertValidClicksThreshold(patch.clicksThreshold);
  }
  if (patch.requireZeroConv !== undefined) {
    data.requireZeroConv = patch.requireZeroConv;
  }
  if (patch.action !== undefined) {
    data.action = assertValidAction(patch.action);
  }
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  const row = await prisma.killRule.update({
    where: { id },
    data,
  });
  return row as unknown as KillRuleRow;
}

export async function deleteKillRule(
  prisma: PrismaClient,
  tenantId: string,
  id: string
): Promise<void> {
  await getKillRuleOr404(prisma, tenantId, id);
  await prisma.killRule.delete({ where: { id } });
}

export const DEFAULT_KILL_RULES = [
  {
    name: "300 点击 0 转化预警",
    clicksThreshold: 300,
    action: "WARN" as KillRuleAction,
  },
  {
    name: "500 点击 0 转化暂停",
    clicksThreshold: 500,
    action: "PAUSE" as KillRuleAction,
  },
] as const;

/**
 * 幂等创建默认规则：本租户尚无任何规则时创建两条全局默认规则；
 * 已有规则时不重复创建，返回现有规则。
 */
export async function seedDefaultKillRules(
  prisma: PrismaClient,
  tenantId: string
): Promise<{ created: boolean; rules: KillRuleRow[] }> {
  const existing = await listKillRules(prisma, tenantId);
  if (existing.length > 0) {
    return { created: false, rules: existing };
  }
  const created: KillRuleRow[] = [];
  for (const def of DEFAULT_KILL_RULES) {
    created.push(
      await createKillRule(prisma, tenantId, {
        name: def.name,
        offerId: null,
        clicksThreshold: def.clicksThreshold,
        requireZeroConv: true,
        action: def.action,
        enabled: true,
      })
    );
  }
  return { created: true, rules: created };
}

export interface KillRuleEvaluationInput {
  offerId: string;
  clicks: number;
  conversions: number;
}

export interface KillRuleHit {
  rule: KillRuleRow;
  event: KillRuleEventRow;
}

/**
 * 对本租户所有适用规则逐条判定；每条命中规则写一条审计事件
 * （enabled=true 写规则 action；enabled=false 写 SKIPPED_DISABLED）。
 * 未命中规则不写事件。
 */
export async function evaluateKillRules(
  prisma: PrismaClient,
  tenantId: string,
  input: KillRuleEvaluationInput
): Promise<{ hits: KillRuleHit[]; events: KillRuleEventRow[] }> {
  const rules = (await prisma.killRule.findMany({
    where: {
      tenantId,
      OR: [{ offerId: null }, { offerId: input.offerId }],
    },
    orderBy: { createdAt: "asc" },
  })) as unknown as KillRuleRow[];

  const hits: KillRuleHit[] = [];
  for (const rule of rules) {
    const hit =
      input.clicks >= rule.clicksThreshold &&
      (!rule.requireZeroConv || input.conversions === 0);
    if (!hit) continue;
    const actionTaken: KillRuleEventActionTaken = rule.enabled
      ? (rule.action as KillRuleAction)
      : "SKIPPED_DISABLED";
    const event = (await prisma.killRuleEvent.create({
      data: {
        id: randomUUID(),
        tenantId,
        ruleId: rule.id,
        offerId: input.offerId,
        clicks: input.clicks,
        conversions: input.conversions,
        actionTaken,
        snapshot: {
          rule: {
            id: rule.id,
            name: rule.name,
            offerId: rule.offerId,
            clicksThreshold: rule.clicksThreshold,
            requireZeroConv: rule.requireZeroConv,
            action: rule.action,
            enabled: rule.enabled,
          },
          evaluation: {
            offerId: input.offerId,
            clicks: input.clicks,
            conversions: input.conversions,
          },
        },
      },
    })) as unknown as KillRuleEventRow;
    hits.push({ rule, event });
  }
  return { hits, events: hits.map((h) => h.event) };
}

export async function listKillRuleEvents(
  prisma: PrismaClient,
  tenantId: string,
  offerId?: string | null
): Promise<KillRuleEventRow[]> {
  const rows = await prisma.killRuleEvent.findMany({
    where: offerId
      ? { tenantId, offerId }
      : { tenantId },
    orderBy: { createdAt: "desc" },
  });
  return rows as unknown as KillRuleEventRow[];
}
