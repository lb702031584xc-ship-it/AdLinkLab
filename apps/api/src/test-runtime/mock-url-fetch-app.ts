/**
 * Phase 8.4.8 — Mock UrlFetchApp (Google Ads Scripts UrlFetchApp API).
 * TEST_ONLY — never opens real network sockets.
 */

import { assertTestRuntime } from "./assert-test-runtime.js";

export interface MockHttpResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

export interface MockFetchOptions {
  method?: string;
  contentType?: string;
  payload?: string;
  muteHttpExceptions?: boolean;
  headers?: Record<string, string>;
}

export type MockUrlFetchHandler = (
  url: string,
  options: MockFetchOptions
) => Promise<MockHttpResponse> | MockHttpResponse;

export interface MockUrlFetchAppOptions {
  handler: MockUrlFetchHandler;
  /**
   * Optional interceptor after handler — used for "response lost / HTTP 500"
   * while server already processed the request.
   */
  afterHandler?: (
    url: string,
    options: MockFetchOptions,
    response: MockHttpResponse
  ) => Promise<MockHttpResponse> | MockHttpResponse;
}

export interface MockFetchCall {
  url: string;
  options: MockFetchOptions;
  response: MockHttpResponse;
}

class MockHttpResponseObject {
  constructor(private readonly response: MockHttpResponse) {}
  getResponseCode(): number {
    return this.response.statusCode;
  }
  getContentText(): string {
    return this.response.body;
  }
}

/**
 * Detect accidental real-network usage in tests.
 * Throws if global fetch / undici is invoked while simulator runs.
 */
export function installNetworkGuard(): () => void {
  assertTestRuntime();
  const g = globalThis as {
    fetch?: typeof fetch;
    __adlinklabNetworkGuardInstalled?: boolean;
  };
  if (g.__adlinklabNetworkGuardInstalled) {
    return () => undefined;
  }
  const originalFetch = g.fetch;
  g.__adlinklabNetworkGuardInstalled = true;
  g.fetch = ((..._args: unknown[]) => {
    throw new Error(
      "REAL NETWORK BLOCKED: ScriptRuntimeSimulator must not call global fetch"
    );
  }) as typeof fetch;
  return () => {
    g.fetch = originalFetch;
    g.__adlinklabNetworkGuardInstalled = false;
  };
}

export class MockUrlFetchApp {
  readonly calls: MockFetchCall[] = [];
  private handler: MockUrlFetchHandler;
  private afterHandler?: MockUrlFetchAppOptions["afterHandler"];
  /** Counts real Google Ads API provider probes (must stay 0). */
  googleAdsProviderInvocations = 0;

  constructor(options: MockUrlFetchAppOptions) {
    assertTestRuntime();
    this.handler = options.handler;
    this.afterHandler = options.afterHandler;
  }

  setHandler(handler: MockUrlFetchHandler): void {
    this.handler = handler;
  }

  setAfterHandler(after?: MockUrlFetchAppOptions["afterHandler"]): void {
    this.afterHandler = after;
  }

  async fetch(
    url: string,
    options: MockFetchOptions = {}
  ): Promise<MockHttpResponseObject> {
    assertTestRuntime();
    if (/^https?:\/\/(www\.)?google\./i.test(url)) {
      throw new Error(`REAL GOOGLE BLOCKED: MockUrlFetchApp refused ${url}`);
    }
    if (/ads\.google\.com|googleads|googleapis\.com/i.test(url)) {
      throw new Error(`REAL GOOGLE ADS BLOCKED: MockUrlFetchApp refused ${url}`);
    }

    let response = await this.handler(url, options);
    if (this.afterHandler) {
      response = await this.afterHandler(url, options, response);
    }
    this.calls.push({ url, options, response });
    return new MockHttpResponseObject(response);
  }

  clear(): void {
    this.calls.length = 0;
  }

  callsTo(pathFragment: string): MockFetchCall[] {
    return this.calls.filter((c) => c.url.includes(pathFragment));
  }
}
