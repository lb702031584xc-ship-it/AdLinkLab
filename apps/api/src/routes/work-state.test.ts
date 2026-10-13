/**
 * 工作台状态持久化路由测试：保存（upsert）、读取最新、历史列表、租户隔离。
 * In-memory fake Prisma + Fastify inject。
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  SESSION_COOKIE_NAME,
  createSession,
} from "../auth/sessions.js";
import { createObservabilityErrorHandler } from "../observability/index.js";
import { registerWorkStateRoutes } from "./work-state.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v === null || v === undefined) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function makeFakePrisma() {
  const tenants: Row[] = [];
  const users: Row[] = [];
  const sessions: Row[] = [];
  const workStates: Row[] = [];
  return {
    tenant: {
      create: async ({ data }: any) => {
        const row = { ...data };
        tenants.push(row);
        return { ...row };
      },
    },
    user: {
      create: async ({ data }: any) => {
        const row = { ...data };
        users.push(row);
        return { ...row };
      },
    },
    session: {
      create: async ({ data }: any) => {
        const row = { createdAt: new Date(), ...data };
        sessions.push(row);
        return { ...row };
      },
      findUnique: async ({ where, include }: any) => {
        const row = sessions.find((r) => matches(r, where)) ?? null;
        if (!row) return null;
        const out = { ...row };
        if (include?.user) {
          out.user = users.find((u) => u.id === row.userId) ?? null;
        }
        return out;
      },
    },
    workState: {
      findFirst: async ({ where }: any) =>
        workStates.filter((r) => matches(r, where))[0] ?? null,
      findMany: async ({ where, take }: any) =>
        workStates
          .filter((r) => matches(r, where))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .slice(0, take ?? 50)
          .map((r) => ({ ...r })),
      create: async ({ data }: any) => {
        const row = {
          createdAt: new Date(),
          updatedAt: new Date(),
          offerId: null,
          label: null,
          ...data,
        };
        workStates.push(row);
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const row = workStates.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data, { updatedAt: data.updatedAt ?? new Date() });
        return { ...row };
      },
    },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth(fake: FakePrisma) {
  const tenantId = randomUUID();
  await (fake as any).tenant.create({
    data: { id: tenantId, name: "t", slug: "u-t", status: "ACTIVE" },
  });
  const user = await (fake as any).user.create({
    data: { id: randomUUID(), tenantId, email: "u@example.com", name: "u", role: "member", status: "ACTIVE" },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return { tenantId, token: session.token };
}

async function buildApp(fake: FakePrisma) {
  const app = Fastify();
  app.setErrorHandler(createObservabilityErrorHandler() as any);
  await registerWorkStateRoutes(app, { prisma: fake as unknown as PrismaClient });
  return app;
}

describe("work-state routes", () => {
  it("PUT 保存后 GET 能读回最新快照（同 offer 只保留一条）", async () => {
    const fake = makeFakePrisma();
    const { token } = await seedAuth(fake);
    const app = await buildApp(fake);
    const offerId = randomUUID();

    const put1 = await app.inject({
      method: "PUT",
      url: "/api/v1/work-state",
      headers: cookie(token),
      payload: { page: "ai-worksheet", offerId, label: "Merach", state: { step: 1 } },
    });
    expect(put1.statusCode).toBe(200);

    const put2 = await app.inject({
      method: "PUT",
      url: "/api/v1/work-state",
      headers: cookie(token),
      payload: { page: "ai-worksheet", offerId, label: "Merach", state: { step: 3 } },
    });
    expect(put2.statusCode).toBe(200);
    expect(put2.json().id).toBe(put1.json().id); // upsert：同一条

    const get = await app.inject({
      method: "GET",
      url: `/api/v1/work-state?page=ai-worksheet&offerId=${offerId}`,
      headers: cookie(token),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().state).toEqual({ step: 3 });
  });

  it("不同 offer 的快照互不干扰，history 能列出", async () => {
    const fake = makeFakePrisma();
    const { token } = await seedAuth(fake);
    const app = await buildApp(fake);

    for (const label of ["OfferA", "OfferB"]) {
      const r = await app.inject({
        method: "PUT",
        url: "/api/v1/work-state",
        headers: cookie(token),
        payload: { page: "keyword-launch", offerId: randomUUID(), label, state: { rows: [] } },
      });
      expect(r.statusCode).toBe(200);
    }
    const hist = await app.inject({
      method: "GET",
      url: "/api/v1/work-state/history?page=keyword-launch",
      headers: cookie(token),
    });
    expect(hist.statusCode).toBe(200);
    expect(hist.json().items).toHaveLength(2);
  });

  it("租户隔离：看不到别人的快照", async () => {
    const fake = makeFakePrisma();
    const { token: tokenA } = await seedAuth(fake);
    const { token: tokenB } = await seedAuth(fake);
    const app = await buildApp(fake);

    await app.inject({
      method: "PUT",
      url: "/api/v1/work-state",
      headers: cookie(tokenA),
      payload: { page: "ai-worksheet", state: { step: 2 } },
    });
    const get = await app.inject({
      method: "GET",
      url: "/api/v1/work-state?page=ai-worksheet",
      headers: cookie(tokenB),
    });
    expect(get.json().state).toBeNull();
  });

  it("非法 page / 非对象 state 被拒绝", async () => {
    const fake = makeFakePrisma();
    const { token } = await seedAuth(fake);
    const app = await buildApp(fake);
    const bad1 = await app.inject({
      method: "PUT",
      url: "/api/v1/work-state",
      headers: cookie(token),
      payload: { page: "evil-page", state: {} },
    });
    expect(bad1.statusCode).toBe(400);
    const bad2 = await app.inject({
      method: "PUT",
      url: "/api/v1/work-state",
      headers: cookie(token),
      payload: { page: "ai-worksheet", state: [1, 2, 3] },
    });
    expect(bad2.statusCode).toBe(400);
  });

  it("未登录 401", async () => {
    const fake = makeFakePrisma();
    const app = await buildApp(fake);
    const r = await app.inject({ method: "GET", url: "/api/v1/work-state?page=ai-worksheet" });
    expect(r.statusCode).toBe(401);
  });
});
