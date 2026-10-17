/**
 * P1-17：幂等键 — 相同租户 + key + scope 重放同一响应，不再执行 handler；
 * 不同 key 执行两次；非 2xx 不存。
 */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerIdempotencyHooks } from "./idempotency.js";

function makeFakePrisma() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    idempotencyKey: {
      findUnique: async ({ where }: { where: { tenantId_key_scope: { tenantId: string; key: string; scope: string } } }) => {
        const k = `${where.tenantId_key_scope.tenantId}:${where.tenantId_key_scope.key}:${where.tenantId_key_scope.scope}`;
        return (rows.get(k) as never) ?? null;
      },
      upsert: async ({ where, create, update }: Record<string, Record<string, unknown>>) => {
        const w = where.tenantId_key_scope as { tenantId: string; key: string; scope: string };
        const k = `${w.tenantId}:${w.key}:${w.scope}`;
        const existing = rows.get(k);
        const next = existing ? { ...existing, ...update } : { ...create };
        rows.set(k, next);
        return next;
      },
    },
  };
}

describe("P1-17 idempotency hooks", () => {
  it("replays the stored 2xx response without re-running the handler", async () => {
    const prisma = makeFakePrisma();
    const app = Fastify();
    registerIdempotencyHooks(app, prisma as never);
    let handlerCalls = 0;
    app.post("/api/v1/offers", async () => {
      handlerCalls++;
      return { created: handlerCalls };
    });
    await app.ready();

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { "idempotency-key": "k1", "x-tenant-id": "t1" },
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ created: 1 });

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { "idempotency-key": "k1", "x-tenant-id": "t1" },
      payload: {},
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["x-idempotency-replayed"]).toBe("true");
    expect(JSON.parse(replay.body)).toEqual({ created: 1 });
    expect(handlerCalls).toBe(1);

    // 不同 key → 再次执行。
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/offers",
      headers: { "idempotency-key": "k2", "x-tenant-id": "t1" },
      payload: {},
    });
    expect(JSON.parse(second.body)).toEqual({ created: 2 });
    expect(handlerCalls).toBe(2);
  });

  it("does not store non-2xx responses", async () => {
    const prisma = makeFakePrisma();
    const app = Fastify();
    registerIdempotencyHooks(app, prisma as never);
    let handlerCalls = 0;
    app.post("/api/v1/offers", async (_req, reply) => {
      handlerCalls++;
      return reply.code(400).send({ error: "bad" });
    });
    await app.ready();
    const headers = { "idempotency-key": "k9", "x-tenant-id": "t1" };
    await app.inject({ method: "POST", url: "/api/v1/offers", headers, payload: {} });
    await app.inject({ method: "POST", url: "/api/v1/offers", headers, payload: {} });
    expect(handlerCalls).toBe(2);
    expect(prisma.rows.size).toBe(0);
  });
});
