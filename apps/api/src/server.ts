import { assertProductionDeployConfig } from "./deploy/production-config.js";
import { buildApp, createServices } from "./app.js";

assertProductionDeployConfig();

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? "0.0.0.0";

const services = createServices();
const app = await buildApp(services);

const shutdown = async (signal: string) => {
  console.log(`AdLinkLab API shutting down (${signal})…`);
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port, host });
console.log(
  `AdLinkLab API listening on http://${host}:${port} (persistence=${services.persistence})`
);
