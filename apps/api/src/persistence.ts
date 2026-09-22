import {
  createMemoryRepositoryBundle,
  createPrismaClient,
  createPrismaRepositoryBundle,
  type PersistenceMode,
  type RepositoryBundle,
} from "@adlinklab/database";
import type { PrismaClient } from "@adlinklab/database";

export type { PersistenceMode, RepositoryBundle };

export interface ResolvePersistenceOptions {
  /** Override process.env for tests. */
  env?: NodeJS.ProcessEnv;
}

const PRODUCTION_PERSISTENCE_ERROR =
  "Production requires PERSISTENCE=prisma and DATABASE_URL";

/**
 * Resolve persistence backend.
 *
 * Priority:
 * 1. NODE_ENV=production → require explicit PERSISTENCE=prisma + DATABASE_URL (fail closed)
 * 2. PERSISTENCE=memory|prisma (explicit)
 * 3. Vitest / NODE_ENV=test → memory (keep unit tests deterministic)
 * 4. DATABASE_URL present → prisma
 * 5. otherwise → memory
 */
export function resolvePersistenceMode(
  options: ResolvePersistenceOptions = {}
): PersistenceMode {
  const env = options.env ?? process.env;
  const explicit = (env.PERSISTENCE ?? "").trim().toLowerCase();
  const hasDatabaseUrl = Boolean(env.DATABASE_URL?.trim());

  if (env.NODE_ENV === "production") {
    if (explicit !== "prisma" || !hasDatabaseUrl) {
      throw new Error(PRODUCTION_PERSISTENCE_ERROR);
    }
    return "prisma";
  }

  if (explicit === "memory" || explicit === "prisma") {
    return explicit;
  }
  if (env.VITEST || env.NODE_ENV === "test") {
    return "memory";
  }
  if (hasDatabaseUrl) {
    return "prisma";
  }
  return "memory";
}

export interface CreateRepositoryBundleOptions {
  persistence?: PersistenceMode;
  /** Inject an existing Prisma client (tests / custom bootstrap). */
  prisma?: PrismaClient;
  env?: NodeJS.ProcessEnv;
}

export function createAppRepositoryBundle(
  options: CreateRepositoryBundleOptions = {}
): RepositoryBundle {
  const env = options.env ?? process.env;
  const mode =
    options.persistence ?? resolvePersistenceMode({ env });

  // Fail closed: never boot memory persistence under production.
  if (env.NODE_ENV === "production" && mode === "memory") {
    throw new Error(PRODUCTION_PERSISTENCE_ERROR);
  }

  if (mode === "prisma") {
    const url = env.DATABASE_URL?.trim();
    if (!url && !options.prisma) {
      throw new Error(
        "PERSISTENCE=prisma requires DATABASE_URL (or an injected PrismaClient)"
      );
    }
    if (options.prisma) {
      return createPrismaRepositoryBundle(options.prisma);
    }
    return createPrismaRepositoryBundle(createPrismaClient(url));
  }
  return createMemoryRepositoryBundle();
}
