/**
 * Phase 8.4.4 — Transaction boundary for Script Sync Result (target + log atomicity).
 */
import type {
  AdRepository,
  ScriptSyncLogRepository,
  ScriptSyncTargetRepository,
  UrlVersionRepository,
} from "@adlinklab/domain";
import type { PrismaClient } from "@prisma/client";
import {
  InMemoryAdRepository,
  InMemoryUrlVersionRepository,
} from "./memory/repositories.js";
import {
  InMemoryScriptSyncLogRepository,
  InMemoryScriptSyncTargetRepository,
} from "./memory/script-integration-repositories.js";
import type { ScriptSyncTarget, ScriptSyncLog } from "@adlinklab/domain";
import type { GoogleAdsScriptIntegration } from "@adlinklab/domain";
import type { Ad, AdGroup, Campaign, UrlVersion } from "@adlinklab/domain";
import {
  PrismaAdRepository,
  PrismaUrlVersionRepository,
} from "./prisma/repositories.js";
import {
  PrismaScriptSyncLogRepository,
  PrismaScriptSyncTargetRepository,
} from "./prisma/script-integration-repositories.js";

export interface ScriptSyncTransactionRepos {
  scriptSyncTargets: ScriptSyncTargetRepository;
  scriptSyncLogs: ScriptSyncLogRepository;
  urlVersions: UrlVersionRepository;
  ads: AdRepository;
}

export interface ScriptSyncTransactionRunner {
  transaction<T>(
    work: (repos: ScriptSyncTransactionRepos) => Promise<T>
  ): Promise<T>;
}

type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends" | "$use"
>;

export class PrismaScriptSyncTransactionRunner
  implements ScriptSyncTransactionRunner
{
  constructor(private readonly db: PrismaClient) {}

  async transaction<T>(
    work: (repos: ScriptSyncTransactionRepos) => Promise<T>
  ): Promise<T> {
    return this.db.$transaction(async (tx: PrismaTx) => {
      const client = tx as PrismaClient;
      return work({
        scriptSyncTargets: new PrismaScriptSyncTargetRepository(client),
        scriptSyncLogs: new PrismaScriptSyncLogRepository(client),
        urlVersions: new PrismaUrlVersionRepository(client),
        ads: new PrismaAdRepository(client),
      });
    });
  }
}

export interface InMemoryScriptSyncStores {
  scriptSyncTargets: Map<string, ScriptSyncTarget>;
  scriptSyncLogs: Map<string, ScriptSyncLog>;
  scriptIntegrations: Map<string, GoogleAdsScriptIntegration>;
  ads: Map<string, Ad>;
  adGroups: Map<string, AdGroup>;
  campaigns: Map<string, Campaign>;
  urlVersions: Map<string, UrlVersion>;
}

function cloneMap<V>(source: Map<string, V>): Map<string, V> {
  return new Map(
    [...source.entries()].map(([k, v]) => [k, structuredClone(v)])
  );
}

function restoreMap<V>(target: Map<string, V>, snapshot: Map<string, V>): void {
  target.clear();
  for (const [k, v] of snapshot) {
    target.set(k, v);
  }
}

/** Serialized in-memory transaction over script target/log maps (+ read urlVersions/ads). */
export class InMemoryScriptSyncTransactionRunner
  implements ScriptSyncTransactionRunner
{
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly stores: InMemoryScriptSyncStores) {}

  async transaction<T>(
    work: (repos: ScriptSyncTransactionRepos) => Promise<T>
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const snapshot = {
        targets: cloneMap(this.stores.scriptSyncTargets),
        logs: cloneMap(this.stores.scriptSyncLogs),
      };

      const repos: ScriptSyncTransactionRepos = {
        scriptSyncTargets: new InMemoryScriptSyncTargetRepository(
          this.stores.scriptSyncTargets,
          this.stores.scriptIntegrations,
          this.stores.ads,
          this.stores.adGroups,
          this.stores.campaigns
        ),
        scriptSyncLogs: new InMemoryScriptSyncLogRepository(
          this.stores.scriptSyncLogs
        ),
        urlVersions: new InMemoryUrlVersionRepository(this.stores.urlVersions),
        ads: new InMemoryAdRepository(this.stores.ads),
      };

      try {
        return await work(repos);
      } catch (error) {
        restoreMap(this.stores.scriptSyncTargets, snapshot.targets);
        restoreMap(this.stores.scriptSyncLogs, snapshot.logs);
        throw error;
      }
    };

    const next = this.chain.then(run, run);
    this.chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}
