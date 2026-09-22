import type { UrlConfiguration } from "@adlinklab/domain";
import type { HierarchyUrlLevel } from "./hierarchy-resolver.js";

/**
 * Merges custom parameters along the hierarchy.
 * More specific levels override the same key from parent levels.
 */
export class CustomParameterResolver {
  resolveFromHierarchy(levels: HierarchyUrlLevel[]): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const level of levels) {
      Object.assign(merged, level.config.customParameters ?? {});
    }
    return merged;
  }

  resolveWithOverrides(
    inherited: Record<string, string>,
    overrides?: Record<string, string>
  ): Record<string, string> {
    return { ...inherited, ...(overrides ?? {}) };
  }

  fromConfigs(configs: UrlConfiguration[]): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const config of configs) {
      Object.assign(merged, config.customParameters ?? {});
    }
    return merged;
  }
}
