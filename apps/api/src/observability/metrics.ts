/**
 * Phase 9.3 — In-memory HTTP metrics (low cardinality).
 * Process restart resets counters — accepted for baseline.
 */
export type StatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx" | "unknown";

export interface MetricLabels {
  method: string;
  route: string;
  status_class: StatusClass;
}

function statusClass(code: number): StatusClass {
  if (code >= 100 && code < 200) return "1xx";
  if (code >= 200 && code < 300) return "2xx";
  if (code >= 300 && code < 400) return "3xx";
  if (code >= 400 && code < 500) return "4xx";
  if (code >= 500 && code < 600) return "5xx";
  return "unknown";
}

function normalizeMethod(method: string): string {
  return method.toUpperCase().slice(0, 16);
}

/** Prefer Fastify route pattern; never use raw URL with IDs. */
export function normalizeRoute(routePattern: string | undefined, path: string): string {
  const raw = (routePattern ?? path).split("?")[0] ?? "/";
  // Cap cardinality: collapse overly long paths
  if (raw.length > 120) return raw.slice(0, 120);
  return raw || "/";
}

function labelKey(labels: MetricLabels): string {
  return `${labels.method}|${labels.route}|${labels.status_class}`;
}

function parseKey(key: string): MetricLabels {
  const [method, route, status_class] = key.split("|");
  return {
    method: method ?? "UNKNOWN",
    route: route ?? "/",
    status_class: (status_class as StatusClass) ?? "unknown",
  };
}

class InMemoryHttpMetrics {
  private readonly requests = new Map<string, number>();
  private readonly errors = new Map<string, number>();
  private readonly durationSumMs = new Map<string, number>();
  private readonly durationCount = new Map<string, number>();

  observe(input: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
  }): void {
    const labels: MetricLabels = {
      method: normalizeMethod(input.method),
      route: normalizeRoute(input.route, input.route),
      status_class: statusClass(input.statusCode),
    };
    const key = labelKey(labels);
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    if (input.statusCode >= 500) {
      this.errors.set(key, (this.errors.get(key) ?? 0) + 1);
    }
    const duration = Math.max(0, input.durationMs);
    this.durationSumMs.set(
      key,
      (this.durationSumMs.get(key) ?? 0) + duration
    );
    this.durationCount.set(key, (this.durationCount.get(key) ?? 0) + 1);
  }

  reset(): void {
    this.requests.clear();
    this.errors.clear();
    this.durationSumMs.clear();
    this.durationCount.clear();
  }

  /** Prometheus text exposition (no secrets). */
  renderPrometheus(): string {
    const lines: string[] = [];
    lines.push("# HELP http_requests_total Total HTTP requests");
    lines.push("# TYPE http_requests_total counter");
    for (const [key, value] of this.requests) {
      const l = parseKey(key);
      lines.push(
        `http_requests_total{method="${escapeLabel(l.method)}",route="${escapeLabel(l.route)}",status_class="${l.status_class}"} ${value}`
      );
    }
    lines.push("# HELP http_request_errors_total Total HTTP 5xx responses");
    lines.push("# TYPE http_request_errors_total counter");
    for (const [key, value] of this.errors) {
      const l = parseKey(key);
      lines.push(
        `http_request_errors_total{method="${escapeLabel(l.method)}",route="${escapeLabel(l.route)}",status_class="${l.status_class}"} ${value}`
      );
    }
    lines.push(
      "# HELP http_request_duration_ms_sum Sum of HTTP request durations in milliseconds"
    );
    lines.push("# TYPE http_request_duration_ms_sum counter");
    for (const [key, value] of this.durationSumMs) {
      const l = parseKey(key);
      lines.push(
        `http_request_duration_ms_sum{method="${escapeLabel(l.method)}",route="${escapeLabel(l.route)}",status_class="${l.status_class}"} ${value}`
      );
    }
    lines.push(
      "# HELP http_request_duration_ms_count Count of observed HTTP request durations"
    );
    lines.push("# TYPE http_request_duration_ms_count counter");
    for (const [key, value] of this.durationCount) {
      const l = parseKey(key);
      lines.push(
        `http_request_duration_ms_count{method="${escapeLabel(l.method)}",route="${escapeLabel(l.route)}",status_class="${l.status_class}"} ${value}`
      );
    }
    return `${lines.join("\n")}\n`;
  }

  snapshot(): {
    requests: number;
    errors: number;
    durationObservations: number;
  } {
    let requests = 0;
    let errors = 0;
    let durationObservations = 0;
    for (const v of this.requests.values()) requests += v;
    for (const v of this.errors.values()) errors += v;
    for (const v of this.durationCount.values()) durationObservations += v;
    return { requests, errors, durationObservations };
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "");
}

export const httpMetrics = new InMemoryHttpMetrics();
