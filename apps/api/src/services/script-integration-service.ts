/**
 * Phase 8.4.2 / 8.4.9 — Script Integration lifecycle.
 * create / rotate / revoke / disable / enable — plaintext token returned once only.
 * Admin HTTP surfaces this via Tenant API Key (not Integration Token).
 */
import { randomUUID } from "node:crypto";
import type {
  GoogleAccountRepository,
  GoogleAdsScriptIntegration,
  GoogleAdsScriptIntegrationRepository,
} from "@adlinklab/domain";
import {
  assertGoogleAccountBelongsToTenant,
  AuditActions,
} from "@adlinklab/domain";
import { NotFoundError, ValidationError } from "@adlinklab/shared";
import {
  assertIntegrationTokenPepperConfigured,
  generateIntegrationTokenMaterial,
} from "../auth/integration-token-crypto.js";
import type { AuditService } from "./index.js";

export interface CreateScriptIntegrationInput {
  tenantId: string;
  googleAccountId: string;
  name: string;
  /** Optional fixed id (tests); otherwise random UUID */
  id?: string;
}

export interface ScriptIntegrationWithToken {
  integration: GoogleAdsScriptIntegration;
  /** Plaintext — return once; never persist or re-fetch */
  token: string;
}

export class ScriptIntegrationService {
  constructor(
    private readonly scriptIntegrations: GoogleAdsScriptIntegrationRepository,
    private readonly googleAccounts: GoogleAccountRepository,
    private readonly audit?: AuditService,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  async create(
    input: CreateScriptIntegrationInput
  ): Promise<ScriptIntegrationWithToken> {
    const account = await this.googleAccounts.findByIdForTenant(
      input.tenantId,
      input.googleAccountId
    );
    assertGoogleAccountBelongsToTenant(
      account,
      input.tenantId,
      input.googleAccountId
    );

    const pepper = assertIntegrationTokenPepperConfigured(this.env);
    const material = generateIntegrationTokenMaterial(pepper);
    const integration = await this.scriptIntegrations.create({
      id: input.id ?? randomUUID(),
      tenantId: input.tenantId,
      googleAccountId: input.googleAccountId,
      name: input.name.trim(),
      status: "ACTIVE",
      tokenKeyId: material.tokenKeyId,
      tokenPrefix: material.tokenPrefix,
      tokenHash: material.tokenHash,
      configGeneration: 0,
    });

    await this.audit?.record({
      action: AuditActions.SCRIPT_INTEGRATION_CREATED,
      tenantId: integration.tenantId,
      entityType: "GoogleAdsScriptIntegration",
      entityId: integration.id,
      after: {
        googleAccountId: integration.googleAccountId,
        tokenKeyId: integration.tokenKeyId,
        tokenPrefix: integration.tokenPrefix,
        status: integration.status,
      },
    });

    return { integration, token: material.token };
  }

  async rotateToken(
    tenantId: string,
    integrationId: string
  ): Promise<ScriptIntegrationWithToken> {
    const existing = await this.scriptIntegrations.findByIdForTenant(
      tenantId,
      integrationId
    );
    if (!existing) {
      throw new NotFoundError("GoogleAdsScriptIntegration", integrationId);
    }
    if (existing.deletedAt) {
      throw new ValidationError("Cannot rotate token for deleted Integration");
    }
    if (existing.status === "REVOKED") {
      throw new ValidationError("Cannot rotate token for REVOKED Integration");
    }

    const pepper = assertIntegrationTokenPepperConfigured(this.env);
    const material = generateIntegrationTokenMaterial(pepper);
    const integration = await this.scriptIntegrations.replaceTokenCredentials(
      existing.id,
      {
        tokenKeyId: material.tokenKeyId,
        tokenPrefix: material.tokenPrefix,
        tokenHash: material.tokenHash,
      }
    );

    await this.audit?.record({
      action: AuditActions.SCRIPT_INTEGRATION_TOKEN_ROTATED,
      tenantId: integration.tenantId,
      entityType: "GoogleAdsScriptIntegration",
      entityId: integration.id,
      before: {
        tokenKeyId: existing.tokenKeyId,
        tokenPrefix: existing.tokenPrefix,
      },
      after: {
        tokenKeyId: integration.tokenKeyId,
        tokenPrefix: integration.tokenPrefix,
      },
    });

    return { integration, token: material.token };
  }

  async revoke(
    tenantId: string,
    integrationId: string
  ): Promise<GoogleAdsScriptIntegration> {
    const existing = await this.scriptIntegrations.findByIdForTenant(
      tenantId,
      integrationId
    );
    if (!existing) {
      throw new NotFoundError("GoogleAdsScriptIntegration", integrationId);
    }
    const integration = await this.scriptIntegrations.update(existing.id, {
      status: "REVOKED",
    });
    await this.audit?.record({
      action: AuditActions.SCRIPT_INTEGRATION_REVOKED,
      tenantId: integration.tenantId,
      entityType: "GoogleAdsScriptIntegration",
      entityId: integration.id,
      after: { status: integration.status },
    });
    return integration;
  }

  async disable(
    tenantId: string,
    integrationId: string
  ): Promise<GoogleAdsScriptIntegration> {
    const existing = await this.scriptIntegrations.findByIdForTenant(
      tenantId,
      integrationId
    );
    if (!existing) {
      throw new NotFoundError("GoogleAdsScriptIntegration", integrationId);
    }
    if (existing.status === "REVOKED") {
      throw new ValidationError("REVOKED Integration cannot be DISABLED");
    }
    const integration = await this.scriptIntegrations.update(existing.id, {
      status: "DISABLED",
    });
    await this.audit?.record({
      action: AuditActions.SCRIPT_INTEGRATION_DISABLED,
      tenantId: integration.tenantId,
      entityType: "GoogleAdsScriptIntegration",
      entityId: integration.id,
      after: { status: integration.status },
    });
    return integration;
  }

  /**
   * Phase 8.4.9 — Re-enable DISABLED → ACTIVE.
   * REVOKED cannot be enabled (must create a new Integration).
   */
  async enable(
    tenantId: string,
    integrationId: string
  ): Promise<GoogleAdsScriptIntegration> {
    const existing = await this.scriptIntegrations.findByIdForTenant(
      tenantId,
      integrationId
    );
    if (!existing) {
      throw new NotFoundError("GoogleAdsScriptIntegration", integrationId);
    }
    if (existing.deletedAt) {
      throw new ValidationError("Cannot enable deleted Integration");
    }
    if (existing.status === "REVOKED") {
      throw new ValidationError(
        "REVOKED Integration cannot be enabled; create a new Integration"
      );
    }
    if (existing.status === "ACTIVE") {
      return existing;
    }
    if (existing.status !== "DISABLED") {
      throw new ValidationError(
        `Cannot enable Integration from status ${existing.status}`
      );
    }
    const integration = await this.scriptIntegrations.update(existing.id, {
      status: "ACTIVE",
    });
    await this.audit?.record({
      action: AuditActions.SCRIPT_INTEGRATION_ENABLED,
      tenantId: integration.tenantId,
      entityType: "GoogleAdsScriptIntegration",
      entityId: integration.id,
      after: { status: integration.status },
    });
    return integration;
  }
}
