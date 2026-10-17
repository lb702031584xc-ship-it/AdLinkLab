/**
 * P0-4 — Auto IP-ban window counter (pure, no I/O).
 *
 * Counts 4xx/5xx responses per IP inside a rolling window; when an IP
 * reaches the threshold, the caller (see ip-ban.ts) writes an IpBan row.
 * Whitelisted IPs are never counted. Once an IP trips the threshold it is
 * remembered until the ban duration elapses, so one burst yields one ban.
 */

export const IP_BAN_AUTO_WINDOW_MS = 5 * 60 * 1000;
export const IP_BAN_AUTO_THRESHOLD = 100;
export const IP_BAN_AUTO_DURATION_MS = 60 * 60 * 1000;

export interface IpBanWatcherOptions {
  windowMs?: number;
  threshold?: number;
  banDurationMs?: number;
  /** IPs exempt from counting (IP_BAN_WHITELIST). */
  whitelist?: string[];
  /** Override "now" (tests). */
  now?: () => number;
}

export interface IpBanRecordOutcome {
  /** True when this response trips the threshold → caller should ban. */
  shouldBan: boolean;
  /** Error count in the current window (for the IpBan.requestCount). */
  count: number;
}

interface Counter {
  windowStart: number;
  count: number;
}

export class IpBanWatcher {
  private readonly windowMs: number;
  private readonly threshold: number;
  private readonly banDurationMs: number;
  private readonly whitelist: Set<string>;
  private readonly now: () => number;
  private readonly counters = new Map<string, Counter>();
  private readonly bannedUntil = new Map<string, number>();

  constructor(opts: IpBanWatcherOptions = {}) {
    this.windowMs = opts.windowMs ?? IP_BAN_AUTO_WINDOW_MS;
    this.threshold = opts.threshold ?? IP_BAN_AUTO_THRESHOLD;
    this.banDurationMs = opts.banDurationMs ?? IP_BAN_AUTO_DURATION_MS;
    this.whitelist = new Set((opts.whitelist ?? []).map((ip) => ip.trim()));
    this.now = opts.now ?? Date.now;
  }

  isWhitelisted(ip: string): boolean {
    return this.whitelist.has(ip.trim());
  }

  /**
   * Record one response. Non-error statuses and whitelisted IPs are ignored.
   * Returns shouldBan=true exactly once per ban-duration per IP.
   */
  record(ip: string, statusCode: number, at?: number): IpBanRecordOutcome {
    const now = at ?? this.now();
    const trimmed = ip.trim();
    if (statusCode < 400 || this.isWhitelisted(trimmed)) {
      return { shouldBan: false, count: this.counters.get(trimmed)?.count ?? 0 };
    }
    const bannedUntil = this.bannedUntil.get(trimmed);
    if (bannedUntil !== undefined && now < bannedUntil) {
      return { shouldBan: false, count: this.counters.get(trimmed)?.count ?? 0 };
    }
    if (bannedUntil !== undefined) this.bannedUntil.delete(trimmed);

    const current = this.counters.get(trimmed);
    if (!current || now - current.windowStart >= this.windowMs) {
      const next = { windowStart: now, count: 1 };
      this.counters.set(trimmed, next);
      if (this.threshold <= 1) {
        this.bannedUntil.set(trimmed, now + this.banDurationMs);
        return { shouldBan: true, count: 1 };
      }
      return { shouldBan: false, count: 1 };
    }
    current.count += 1;
    if (current.count >= this.threshold) {
      this.bannedUntil.set(trimmed, now + this.banDurationMs);
      const count = current.count;
      this.counters.delete(trimmed);
      return { shouldBan: true, count };
    }
    return { shouldBan: false, count: current.count };
  }

  /** Forget an IP's counter (tests / manual unban). */
  reset(ip: string): void {
    this.counters.delete(ip.trim());
    this.bannedUntil.delete(ip.trim());
  }
}
