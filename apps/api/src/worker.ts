/**
 * Phase 8.3.2 — independent Worker process entry.
 * Phase 9.1 — production compose service uses: node dist/worker.js
 * Does not start the HTTP API. Importing this module does not connect Redis;
 * Redis opens only inside WorkerRuntime.start().
 *
 * Usage: pnpm --filter @adlinklab/api worker
 *        pnpm --filter @adlinklab/api worker:start  (compiled)
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createServices,
  type CreateServicesOptions,
} from "./app.js";
import { assertProductionDeployConfig } from "./deploy/production-config.js";
import { resolveQueueMode } from "./queue/producer.js";
import { createWorkerRuntime } from "./queue/runtime.js";

export async function startWorkerProcess(
  options: CreateServicesOptions = {}
): Promise<{
  services: ReturnType<typeof createServices>;
  close: () => Promise<void>;
}> {
  assertProductionDeployConfig({ requireWorkerQueue: true });

  const mode = resolveQueueMode(process.env);
  if (mode !== "redis") {
    throw new Error(
      "Worker requires QUEUE_MODE=redis (or QUEUE_ENABLED=1 / REDIS_URL outside tests). " +
        `Current mode=${mode}`
    );
  }

  const services = createServices({
    ...options,
    withWorker: true,
  });

  const runtime = services.workerRuntime;
  if (!runtime) {
    throw new Error("createServices(withWorker=true) did not attach WorkerRuntime");
  }

  await runtime.start();
  console.log(
    `AdLinkLab Worker running (persistence=${services.persistence}, queueMode=${services.queueMode})`
  );

  const close = async () => {
    await runtime.close();
    await services.dispose();
  };

  return { services, close };
}

function isDirectWorkerEntry(): boolean {
  if (process.env.VITEST || process.env.ADLINKLAB_WORKER_NO_AUTOSTART === "1") {
    return false;
  }
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(arg)).href;
  } catch {
    return false;
  }
}

if (isDirectWorkerEntry()) {
  const { close } = await startWorkerProcess();

  const shutdown = async (signal: string) => {
    console.log(`AdLinkLab Worker shutting down (${signal})…`);
    try {
      await close();
      process.exit(0);
    } catch (err) {
      console.error("Worker shutdown failed", err);
      process.exit(1);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

export { createWorkerRuntime };
