import type { HierarchyUrlLevel } from "./hierarchy-resolver.js";

export interface FinalUrlResolveResult {
  finalUrl: string;
  finalMobileUrl?: string;
  finalAppUrl?: string;
  sourceEntityType: string;
  sourceEntityId: string;
}

/**
 * Picks final / mobile / app URLs from the most specific level that defines them.
 */
export class FinalUrlResolver {
  resolve(levels: HierarchyUrlLevel[]): FinalUrlResolveResult {
    let finalUrl: string | undefined;
    let finalMobileUrl: string | undefined;
    let finalAppUrl: string | undefined;
    let source = levels[levels.length - 1]!;

    for (const level of levels) {
      if (level.config.finalUrl) {
        finalUrl = level.config.finalUrl;
        source = level;
      }
      if (level.config.finalMobileUrl) {
        finalMobileUrl = level.config.finalMobileUrl;
      }
      if (level.config.finalAppUrl) {
        finalAppUrl = level.config.finalAppUrl;
      }
    }

    if (!finalUrl) {
      throw new Error("FinalUrlResolver: no finalUrl found in hierarchy");
    }

    return {
      finalUrl,
      finalMobileUrl,
      finalAppUrl,
      sourceEntityType: source.entityType,
      sourceEntityId: source.entityId,
    };
  }
}
