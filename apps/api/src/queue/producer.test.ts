import { describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";
import {
  BullMqJobProducer,
  NoopJobProducer,
  createJobProducer,
  getDefaultJobOptions,
  resolveQueueMode,
} from "./producer.js";
import type { UrlChangeJobData } from "./job-data.js";

const sampleUrlChange: UrlChangeJobData = {
  type: "urlChange",
  tenantId: "tenant-a",
  requestId: "req-1",
  idempotencyKey: "uc:key-1",
  jobId: "urlChange:uc:key-1",
  syncJobId: "sync-1",
};

function createMockQueue(seed?: Map<string, { state: string }>) {
  const store = seed ?? new Map<string, { state: string; data: unknown }>();
  return {
    async getJob(jobId: string) {
      const row = store.get(jobId);
      if (!row) return undefined;
      return {
        id: jobId,
        data: row.data,
        async getState() {
          return row.state;
        },
        async remove() {
          store.delete(jobId);
        },
      };
    },
    async add(_name: string, data: unknown, opts: { jobId?: string }) {
      const jobId = opts.jobId!;
      store.set(jobId, { state: "waiting", data });
      return { id: jobId, data };
    },
    async close() {},
    _store: store,
  } as unknown as Queue & {
    _store: Map<string, { state: string; data: unknown }>;
  };
}

describe("resolveQueueMode", () => {
  it("returns off under Vitest by default", () => {
    expect(resolveQueueMode({ VITEST: "true", REDIS_URL: "redis://x" })).toBe(
      "off"
    );
  });

  it("honors QUEUE_MODE=redis even in tests", () => {
    expect(resolveQueueMode({ VITEST: "true", QUEUE_MODE: "redis" })).toBe(
      "redis"
    );
  });

  it("honors QUEUE_MODE=off", () => {
    expect(
      resolveQueueMode({ NODE_ENV: "production", QUEUE_MODE: "off" })
    ).toBe("off");
  });

  it("QUEUE_ENABLED=1 selects redis outside tests", () => {
    expect(resolveQueueMode({ QUEUE_ENABLED: "1", NODE_ENV: "production" })).toBe(
      "redis"
    );
  });

  it("REDIS_URL selects redis outside tests", () => {
    expect(
      resolveQueueMode({
        REDIS_URL: "redis://localhost:6379",
        NODE_ENV: "production",
      })
    ).toBe("redis");
  });
});

describe("NoopJobProducer", () => {
  it("records calls and returns noop", async () => {
    const producer = new NoopJobProducer();
    const result = await producer.enqueueUrlChange(sampleUrlChange);
    expect(result).toEqual({
      enqueued: false,
      jobId: sampleUrlChange.jobId,
      reason: "noop",
    });
    expect(producer.calls).toHaveLength(1);
    expect(producer.calls[0]).toMatchObject({ type: "urlChange" });
  });
});

describe("createJobProducer", () => {
  it("returns Noop under Vitest env", () => {
    const p = createJobProducer({ VITEST: "true" });
    expect(p.mode).toBe("off");
    expect(p).toBeInstanceOf(NoopJobProducer);
  });

  it("accepts injected producer override", () => {
    const custom = new NoopJobProducer();
    const p = createJobProducer({ QUEUE_MODE: "redis" }, { producer: custom });
    expect(p).toBe(custom);
  });
});

describe("getDefaultJobOptions", () => {
  it("uses JOB_DEFINITIONS attempts and exponential backoff", () => {
    expect(getDefaultJobOptions("urlChange")).toMatchObject({
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
    });
  });
});

describe("BullMqJobProducer", () => {
  it("adds job with stable jobId", async () => {
    const urlChange = createMockQueue();
    const conversionUpload = createMockQueue();
    const producer = new BullMqJobProducer(
      { url: "redis://mock" },
      {
        googleAdsSync: createMockQueue(),
        urlChange,
        conversionUpload,
        clickProcessing: createMockQueue(),
        analyticsAggregation: createMockQueue(),
      }
    );

    const result = await producer.enqueueUrlChange(sampleUrlChange);
    expect(result).toEqual({
      enqueued: true,
      jobId: sampleUrlChange.jobId,
      reason: "added",
    });
    expect(urlChange._store.get(sampleUrlChange.jobId)?.data).toMatchObject({
      type: "urlChange",
      requestId: "req-1",
    });
    await producer.close();
  });

  it("returns duplicate when waiting job exists", async () => {
    const urlChange = createMockQueue(
      new Map([
        [
          sampleUrlChange.jobId,
          { state: "waiting", data: sampleUrlChange },
        ],
      ])
    );
    const producer = new BullMqJobProducer(
      { url: "redis://mock" },
      {
        googleAdsSync: createMockQueue(),
        urlChange,
        conversionUpload: createMockQueue(),
        clickProcessing: createMockQueue(),
        analyticsAggregation: createMockQueue(),
      }
    );

    const result = await producer.enqueueUrlChange(sampleUrlChange);
    expect(result.reason).toBe("duplicate");
    expect(result.enqueued).toBe(false);
    await producer.close();
  });

  it("removes completed job then re-adds for retry", async () => {
    const store = new Map([
      [
        sampleUrlChange.jobId,
        { state: "completed", data: sampleUrlChange },
      ],
    ]);
    const urlChange = createMockQueue(store);
    const addSpy = vi.spyOn(urlChange, "add");
    const producer = new BullMqJobProducer(
      { url: "redis://mock" },
      {
        googleAdsSync: createMockQueue(),
        urlChange,
        conversionUpload: createMockQueue(),
        clickProcessing: createMockQueue(),
        analyticsAggregation: createMockQueue(),
      }
    );

    const result = await producer.enqueueUrlChange(sampleUrlChange);
    expect(result.reason).toBe("added");
    expect(addSpy).toHaveBeenCalledOnce();
    await producer.close();
  });
});
