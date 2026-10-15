"use server";

/**
 * Phase 8.4.9 — Server Actions for Script Integration Admin.
 * Never log or persist plaintext tokens / generated source.
 */
import { revalidatePath } from "next/cache";
import { adminScriptApi } from "./admin-script";
import { mapAdminErrorMessage } from "./admin-script-config";
import { getLang } from "@/i18n/lang";

export type AdminActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function revalidateIntegration(id?: string) {
  revalidatePath("/script-integrations");
  if (id) revalidatePath(`/script-integrations/${id}`);
}

export async function createIntegrationAction(input: {
  name: string;
  googleAccountId: string;
}): Promise<AdminActionResult<{
  integrationId: string;
  token: string;
  tokenPrefix: string;
}>> {
  try {
    const data = await adminScriptApi.createIntegration(input);
    revalidateIntegration(data.integrationId);
    return {
      ok: true,
      data: {
        integrationId: data.integrationId,
        token: data.token,
        tokenPrefix: data.tokenPrefix,
      },
    };
  } catch (error) {
    return { ok: false, error: mapAdminErrorMessage(error, await getLang()) };
  }
}

export async function rotateTokenAction(
  integrationId: string
): Promise<AdminActionResult<{ token: string; tokenPrefix: string }>> {
  try {
    const data = await adminScriptApi.rotateToken(integrationId);
    revalidateIntegration(integrationId);
    return {
      ok: true,
      data: { token: data.token, tokenPrefix: data.tokenPrefix },
    };
  } catch (error) {
    return { ok: false, error: mapAdminErrorMessage(error, await getLang()) };
  }
}

export async function revokeIntegrationAction(
  integrationId: string
): Promise<AdminActionResult<null>> {
  try {
    await adminScriptApi.revoke(integrationId);
    revalidateIntegration(integrationId);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: mapAdminErrorMessage(error, await getLang()) };
  }
}

export async function disableIntegrationAction(
  integrationId: string
): Promise<AdminActionResult<null>> {
  try {
    await adminScriptApi.disable(integrationId);
    revalidateIntegration(integrationId);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: mapAdminErrorMessage(error, await getLang()) };
  }
}

export async function enableIntegrationAction(
  integrationId: string
): Promise<AdminActionResult<null>> {
  try {
    await adminScriptApi.enable(integrationId);
    revalidateIntegration(integrationId);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: mapAdminErrorMessage(error, await getLang()) };
  }
}

export async function deleteIntegrationAction(
  integrationId: string
): Promise<AdminActionResult<null>> {
  try {
    await adminScriptApi.deleteIntegration(integrationId);
    revalidatePath("/script-integrations");
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: mapAdminErrorMessage(error, await getLang()) };
  }
}

export async function registerManualAdAction(input: {
  integrationId: string;
  googleCampaignId: string;
  campaignName?: string;
  googleAdGroupId: string;
  adGroupName?: string;
  googleAdId: string;
  adName: string;
}): Promise<AdminActionResult<{ id: string; name: string; googleAdId: string }>> {
  try {
    const data = await adminScriptApi.registerManualAd(
      input.integrationId,
      input
    );
    revalidateIntegration(input.integrationId);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: mapAdminErrorMessage(error, await getLang()) };
  }
}

export async function attachTargetAction(input: {
  integrationId: string;
  entityId: string;
}): Promise<AdminActionResult<null>> {
  try {
    await adminScriptApi.attachTarget(input.integrationId, {
      entityType: "AD",
      entityId: input.entityId,
    });
    revalidateIntegration(input.integrationId);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: mapAdminErrorMessage(error, await getLang()) };
  }
}

export async function detachTargetAction(input: {
  integrationId: string;
  targetId: string;
}): Promise<AdminActionResult<null>> {
  try {
    await adminScriptApi.detachTarget(input.integrationId, input.targetId);
    revalidateIntegration(input.integrationId);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: mapAdminErrorMessage(error, await getLang()) };
  }
}

export async function generateScriptAction(input: {
  integrationId: string;
  token: string;
}): Promise<
  AdminActionResult<{
    source: string;
    scriptVersion: string;
    apiVersion: string;
    integrationId: string;
  }>
> {
  try {
    const data = await adminScriptApi.generateScript(input.integrationId, {
      token: input.token,
    });
    return {
      ok: true,
      data: {
        source: data.source,
        scriptVersion: data.scriptVersion,
        apiVersion: data.apiVersion,
        integrationId: data.integrationId,
      },
    };
  } catch (error) {
    return { ok: false, error: mapAdminErrorMessage(error, await getLang()) };
  }
}
