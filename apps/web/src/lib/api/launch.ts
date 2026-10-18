/**
 * 上线向导 API 客户端（server-side only）。
 * 通过 sessionHeaders 转发用户 alk_session cookie；不记录密钥。
 * 绝不能被 client component import（间接依赖 next/headers）。
 */
import { redirect } from "next/navigation";
import { EntityApiError, getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface LaunchChecklist {
  id: string;
  tenantId: string;
  offerId: string | null;
  trackingLinkId: string | null;
  landingPageId: string | null;
  currentStep: number;
  status: string;
  stepsData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface LaunchDetail {
  checklist: LaunchChecklist;
  offer: {
    id: string;
    name: string;
    network: string;
    destinationUrl: string;
    affiliateUrl?: string | null;
  } | null;
  trackingLink: {
    id: string;
    publicId: string;
    status: string;
  } | null;
  landingPage: { id: string; name: string; url: string } | null;
}

export interface LaunchActivateResult {
  checklist: LaunchChecklist;
  trackingLink: { id: string; publicId: string; status: string };
  scriptPush: {
    syncJobId: string;
    scriptTargetId: string | null;
    note: string | null;
  };
  idempotencyKey: string;
}

async function launchFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...authHeaders,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new EntityApiError(0, "无法连接到 API 服务");
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new EntityApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export async function listLaunchChecklists(): Promise<LaunchChecklist[]> {
  const data = await launchFetch<{ checklists: LaunchChecklist[] }>(
    "/api/v1/launch"
  );
  return data.checklists ?? [];
}

export async function createLaunchChecklist(
  offerId?: string
): Promise<LaunchChecklist> {
  const data = await launchFetch<{ checklist: LaunchChecklist }>(
    "/api/v1/launch",
    {
      method: "POST",
      body: JSON.stringify(offerId ? { offerId } : {}),
    }
  );
  return data.checklist;
}

export async function getLaunchChecklist(id: string): Promise<LaunchDetail> {
  return launchFetch<LaunchDetail>(`/api/v1/launch/${encodeURIComponent(id)}`);
}

export async function completeLaunchStep(
  id: string,
  step: number,
  data: Record<string, unknown>
): Promise<LaunchChecklist> {
  const res = await launchFetch<{ checklist: LaunchChecklist }>(
    `/api/v1/launch/${encodeURIComponent(id)}/complete-step`,
    { method: "POST", body: JSON.stringify({ step, data }) }
  );
  return res.checklist;
}

export async function createLaunchTrackingLink(
  id: string,
  input: { publicId?: string; status?: string }
): Promise<{ trackingLink: LaunchDetail["trackingLink"]; checklist: LaunchChecklist }> {
  return launchFetch(
    `/api/v1/launch/${encodeURIComponent(id)}/tracking-link`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function activateLaunchChecklist(
  id: string
): Promise<LaunchActivateResult> {
  return launchFetch<LaunchActivateResult>(
    `/api/v1/launch/${encodeURIComponent(id)}/activate`,
    { method: "POST", body: JSON.stringify({}) }
  );
}
