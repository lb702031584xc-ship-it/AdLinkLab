"use server";

/**
 * 砍线规则引擎 server actions（server-side only）。
 * Forwards the user's `alk_session` cookie to the API. Never logs tokens.
 * 注意：evaluate 只做判定 + 审计落库，不实际暂停任何广告系列或链接。
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface KillRule {
  id: string;
  tenantId: string;
  offerId: string | null;
  name: string;
  clicksThreshold: number;
  requireZeroConv: boolean;
  action: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KillRuleEvent {
  id: string;
  tenantId: string;
  ruleId: string;
  offerId: string | null;
  clicks: number;
  conversions: number;
  actionTaken: string;
  snapshot: unknown;
  createdAt: string;
}

export interface KillRuleEvaluation {
  offerId: string;
  clicks: number;
  conversions: number;
  hits: Array<{ rule: KillRule; event: KillRuleEvent }>;
  events: KillRuleEvent[];
}

export type KillRuleActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function killRuleFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...authHeaders,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `Kill rule API ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

function toError(e: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : "Unknown error",
  };
}

export async function listKillRulesAction(): Promise<
  KillRuleActionResult<KillRule[]>
> {
  try {
    const data = await killRuleFetch<{ rules: KillRule[] }>("/api/v1/kill-rules");
    return { ok: true, data: data.rules };
  } catch (e) {
    return toError(e);
  }
}

export async function createKillRuleAction(input: {
  name: string;
  offerId?: string | null;
  clicksThreshold: number;
  requireZeroConv?: boolean;
  action: string;
  enabled?: boolean;
}): Promise<KillRuleActionResult<KillRule>> {
  try {
    const data = await killRuleFetch<{ rule: KillRule }>("/api/v1/kill-rules", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, data: data.rule };
  } catch (e) {
    return toError(e);
  }
}

export async function updateKillRuleAction(
  id: string,
  patch: Partial<{
    name: string;
    offerId: string | null;
    clicksThreshold: number;
    requireZeroConv: boolean;
    action: string;
    enabled: boolean;
  }>
): Promise<KillRuleActionResult<KillRule>> {
  try {
    const data = await killRuleFetch<{ rule: KillRule }>(
      `/api/v1/kill-rules/${id}`,
      { method: "PATCH", body: JSON.stringify(patch) }
    );
    return { ok: true, data: data.rule };
  } catch (e) {
    return toError(e);
  }
}

export async function deleteKillRuleAction(
  id: string
): Promise<KillRuleActionResult<{ ok: boolean; id: string }>> {
  try {
    const data = await killRuleFetch<{ ok: boolean; id: string }>(
      `/api/v1/kill-rules/${id}`,
      { method: "DELETE" }
    );
    return { ok: true, data };
  } catch (e) {
    return toError(e);
  }
}

export async function seedDefaultKillRulesAction(): Promise<
  KillRuleActionResult<{ created: boolean; rules: KillRule[] }>
> {
  try {
    const data = await killRuleFetch<{ created: boolean; rules: KillRule[] }>(
      "/api/v1/kill-rules/seed-defaults",
      { method: "POST", body: JSON.stringify({}) }
    );
    return { ok: true, data };
  } catch (e) {
    return toError(e);
  }
}

export async function evaluateKillRulesAction(input: {
  offerId: string;
  clicks: number;
  conversions: number;
}): Promise<KillRuleActionResult<KillRuleEvaluation>> {
  try {
    const data = await killRuleFetch<KillRuleEvaluation>(
      "/api/v1/kill-rules/evaluate",
      { method: "POST", body: JSON.stringify(input) }
    );
    return { ok: true, data };
  } catch (e) {
    return toError(e);
  }
}

export async function listKillRuleEventsAction(): Promise<
  KillRuleActionResult<KillRuleEvent[]>
> {
  try {
    const data = await killRuleFetch<{ events: KillRuleEvent[] }>(
      "/api/v1/kill-rules/events"
    );
    return { ok: true, data: data.events };
  } catch (e) {
    return toError(e);
  }
}
