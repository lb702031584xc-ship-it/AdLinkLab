import type { ClickRepository } from "@adlinklab/domain";
import type { TrafficProvider } from "./provider.js";
import { MockTrafficProvider } from "./mock-provider.js";
import { DatabaseTrafficProvider } from "./database-provider.js";

export type TrafficProviderKind = "mock" | "database";

export function createTrafficProvider(
  kind: TrafficProviderKind,
  clicks?: ClickRepository
): TrafficProvider {
  if (kind === "database") {
    if (!clicks) {
      throw new Error("DatabaseTrafficProvider requires ClickRepository");
    }
    return new DatabaseTrafficProvider(clicks);
  }
  return new MockTrafficProvider();
}

export * from "./provider.js";
export * from "./mock-provider.js";
export * from "./database-provider.js";
