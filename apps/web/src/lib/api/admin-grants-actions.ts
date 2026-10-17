"use server";

/** §5：管理员授权 server actions。 */
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();
  const headers = await sessionHeaders();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `请求失败（${res.status}）`);
  }
  return res.json() as Promise<T>;
}

export interface GrantApplication {
  id: string;
  tenantId: string;
  capability: string;
  applicantId: string;
  purpose: string;
  whitelist: unknown;
  requestedDays: number;
  evidence: unknown;
  status: string;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Grant {
  id: string;
  tenantId: string;
  capability: string;
  applicationId: string | null;
  applicantId: string;
  approverId: string;
  whitelist: unknown;
  usageLimit: unknown;
  usageCount: number;
  status: string;
  startsAt: string;
  endsAt: string;
  revokedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GrantAudit {
  id: string;
  tenantId: string;
  grantId: string | null;
  actorId: string;
  action: string;
  detail: unknown;
  createdAt: string;
}

export async function applyGrantAction(input: {
  capability: string;
  purpose: string;
  whitelist: string[];
  evidence: Array<Record<string, unknown>>;
  requestedDays?: number;
  usageLimit?: Record<string, unknown>;
}) {
  return apiFetch<{ application: GrantApplication }>("/api/v1/admin/grants/apply", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listMyGrantApplicationsAction() {
  return apiFetch<{
    items: GrantApplication[];
    total: number;
    page: number;
    pageSize: number;
  }>("/api/v1/admin/grants/applications/mine");
}

export async function listGrantApplicationsAction(status?: string) {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch<{
    items: GrantApplication[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/api/v1/admin/grants/applications${q}`);
}

export async function listGrantsAction() {
  return apiFetch<{ items: Grant[]; total: number; page: number; pageSize: number }>(
    "/api/v1/admin/grants"
  );
}

export async function approveGrantAction(
  id: string,
  input: { decisionNote?: string; usageLimit?: Record<string, unknown> }
) {
  return apiFetch<{ grant: Grant }>(
    `/api/v1/admin/grants/applications/${encodeURIComponent(id)}/approve`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function rejectGrantAction(id: string, input: { decisionNote?: string }) {
  return apiFetch<{ ok: boolean }>(
    `/api/v1/admin/grants/applications/${encodeURIComponent(id)}/reject`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function revokeGrantAction(id: string, reason: string) {
  return apiFetch<{ ok: boolean }>(
    `/api/v1/admin/grants/${encodeURIComponent(id)}/revoke`,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
}

export async function listGrantAuditsAction() {
  return apiFetch<{
    items: GrantAudit[];
    total: number;
    page: number;
    pageSize: number;
  }>("/api/v1/admin/grants/audits");
}
