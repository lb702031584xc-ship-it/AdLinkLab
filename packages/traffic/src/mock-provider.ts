import { randomUUID } from "node:crypto";
import type { TrafficEvent, TrafficEventResult, TrafficProvider } from "./provider.js";

/**
 * In-memory traffic recorder for tests and local simulation.
 * Stores events locally only — no third-party click generation.
 */
export class MockTrafficProvider implements TrafficProvider {
  readonly events: Array<TrafficEvent & { clickId: string }> = [];

  async recordClick(input: TrafficEvent): Promise<TrafficEventResult> {
    const clickId = randomUUID();
    this.events.push({ ...input, clickId });
    return {
      clickId,
      accepted: true,
      message: "Mock click recorded in memory",
    };
  }
}
