/**
 * Phase 8.4.8 — Mock AdsApp (Google Ads Scripts AdsApp API).
 * TEST_ONLY — in-memory ad URL mutations; never touches Google Ads.
 */

import { assertTestRuntime } from "./assert-test-runtime.js";

export type MockAdUrlOperation =
  | "setFinalUrl"
  | "setFinalMobileUrl"
  | "setFinalAppUrl"
  | "setTrackingTemplate"
  | "setCustomParameters";

export interface MockAdMutation {
  adId: string;
  operation: MockAdUrlOperation;
  value: unknown;
}

export interface MockAdUrlsState {
  finalUrl?: string;
  finalMobileUrl?: string;
  finalAppUrl?: string;
  trackingTemplate?: string;
  customParameters?: Record<string, string>;
}

export interface MockAdRecord {
  id: string;
  urls: MockAdUrlsState;
}

export interface MockAdsAppOptions {
  ads?: MockAdRecord[];
  /** Ad IDs that throw on any URL mutation (apply failure injection). */
  applyFailAdIds?: Iterable<string>;
}

class MockAdUrls {
  constructor(
    private readonly adId: string,
    private readonly state: MockAdUrlsState,
    private readonly mutations: MockAdMutation[],
    private readonly failIds: Set<string>
  ) {}

  private mutate(operation: MockAdUrlOperation, value: unknown): void {
    if (this.failIds.has(this.adId)) {
      throw new Error(`MockAdsApp apply failure injected for adId=${this.adId}`);
    }
    this.mutations.push({ adId: this.adId, operation, value });
    switch (operation) {
      case "setFinalUrl":
        this.state.finalUrl = String(value);
        break;
      case "setFinalMobileUrl":
        this.state.finalMobileUrl = String(value);
        break;
      case "setFinalAppUrl":
        this.state.finalAppUrl = String(value);
        break;
      case "setTrackingTemplate":
        this.state.trackingTemplate = String(value);
        break;
      case "setCustomParameters":
        this.state.customParameters = {
          ...(value as Record<string, string>),
        };
        break;
    }
  }

  setFinalUrl(value: string): void {
    this.mutate("setFinalUrl", value);
  }
  setFinalMobileUrl(value: string): void {
    this.mutate("setFinalMobileUrl", value);
  }
  setFinalAppUrl(value: string): void {
    this.mutate("setFinalAppUrl", value);
  }
  setTrackingTemplate(value: string): void {
    this.mutate("setTrackingTemplate", value);
  }
  setCustomParameters(value: Record<string, string>): void {
    this.mutate("setCustomParameters", value);
  }
}

class MockAd {
  constructor(
    private readonly record: MockAdRecord,
    private readonly mutations: MockAdMutation[],
    private readonly failIds: Set<string>
  ) {}

  getId(): string {
    return this.record.id;
  }

  urls(): MockAdUrls {
    return new MockAdUrls(
      this.record.id,
      this.record.urls,
      this.mutations,
      this.failIds
    );
  }
}

class MockAdIterator {
  private index = 0;
  constructor(private readonly ads: MockAd[]) {}
  hasNext(): boolean {
    return this.index < this.ads.length;
  }
  next(): MockAd {
    if (!this.hasNext()) throw new Error("MockAdIterator exhausted");
    return this.ads[this.index++]!;
  }
}

class MockAdSelector {
  private condition: string | null = null;
  constructor(
    private readonly byId: Map<string, MockAdRecord>,
    private readonly mutations: MockAdMutation[],
    private readonly failIds: Set<string>
  ) {}

  withCondition(condition: string): MockAdSelector {
    this.condition = condition;
    return this;
  }

  get(): MockAdIterator {
    const matched: MockAd[] = [];
    const idMatch = this.condition?.match(/Id\s*=\s*"([^"]*)"/i);
    if (idMatch) {
      const record = this.byId.get(idMatch[1]!);
      if (record) {
        matched.push(new MockAd(record, this.mutations, this.failIds));
      }
    } else if (!this.condition) {
      for (const record of this.byId.values()) {
        matched.push(new MockAd(record, this.mutations, this.failIds));
      }
    }
    return new MockAdIterator(matched);
  }
}

export class MockAdsApp {
  readonly mutations: MockAdMutation[] = [];
  private readonly byId = new Map<string, MockAdRecord>();
  private readonly failIds: Set<string>;

  constructor(options: MockAdsAppOptions = {}) {
    assertTestRuntime();
    this.failIds = new Set(options.applyFailAdIds ?? []);
    for (const ad of options.ads ?? []) {
      this.byId.set(ad.id, {
        id: ad.id,
        urls: { ...ad.urls },
      });
    }
  }

  ads(): MockAdSelector {
    return new MockAdSelector(this.byId, this.mutations, this.failIds);
  }

  seedAd(ad: MockAdRecord): void {
    this.byId.set(ad.id, { id: ad.id, urls: { ...ad.urls } });
  }

  getAdState(adId: string): MockAdUrlsState | undefined {
    const record = this.byId.get(adId);
    return record ? { ...record.urls } : undefined;
  }

  mutationsFor(adId: string): MockAdMutation[] {
    return this.mutations.filter((m) => m.adId === adId);
  }

  clearMutations(): void {
    this.mutations.length = 0;
  }

  addApplyFailAdId(adId: string): void {
    this.failIds.add(adId);
  }

  clearApplyFailures(): void {
    this.failIds.clear();
  }

  reset(): void {
    this.mutations.length = 0;
    this.byId.clear();
    this.failIds.clear();
  }
}
