import { setTimeout as sleepFor } from "node:timers/promises";
import type { VisionProvider } from "../types.js";

/**
 * Counting semaphore with FIFO wakeups. Bounds how many reviews run at once
 * when concurrent agent calls land on one MCP server process.
 */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    // Hand the slot straight to the next waiter so `active` stays accurate.
    if (next) next();
    else this.active--;
  }
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Sliding-window rate limiter: at most `limit` acquisitions per `windowMs`.
 * Callers over the limit wait until the oldest admission leaves the window.
 */
export class RateLimiter {
  private timestamps: number[] = [];
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: RateLimiterOptions) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => sleepFor(ms));
  }

  async acquire(): Promise<void> {
    for (;;) {
      const cutoff = this.now() - this.windowMs;
      this.timestamps = this.timestamps.filter((t) => t > cutoff);
      if (this.timestamps.length < this.limit) {
        this.timestamps = [...this.timestamps, this.now()];
        return;
      }
      await this.sleep(Math.max(1, this.timestamps[0] + this.windowMs - this.now()));
    }
  }
}

/**
 * Wraps a provider so every analyze() call passes through the rate limiter.
 * With no limiter the provider is returned untouched.
 */
export function withRateLimit(provider: VisionProvider, limiter: RateLimiter | null): VisionProvider {
  if (!limiter) return provider;
  return {
    name: provider.name,
    model: provider.model,
    isAvailable: () => provider.isAvailable(),
    analyze: async (screenshot, prompt, viewportName) => {
      await limiter.acquire();
      return provider.analyze(screenshot, prompt, viewportName);
    },
  };
}

function validCap(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

// Process-wide instances keyed by setting, so one ceiling spans every review
// in the process (multi-route CLI runs, concurrent MCP tool calls) instead of
// resetting per call. Keying by value means a config edit mid-process leaves
// the old instance serving in-flight work — the ceiling is only exact for
// values stable across the process lifetime.
const rateLimiters = new Map<number, RateLimiter>();
const reviewGates = new Map<number, Semaphore>();

export function sharedRateLimiter(callsPerMinute: number | null | undefined): RateLimiter | null {
  if (!validCap(callsPerMinute)) return null;
  const existing = rateLimiters.get(callsPerMinute);
  if (existing) return existing;
  const limiter = new RateLimiter({ limit: callsPerMinute, windowMs: 60_000 });
  rateLimiters.set(callsPerMinute, limiter);
  return limiter;
}

export function sharedReviewGate(maxConcurrent: number | null | undefined): Semaphore | null {
  if (!validCap(maxConcurrent)) return null;
  const existing = reviewGates.get(maxConcurrent);
  if (existing) return existing;
  const gate = new Semaphore(maxConcurrent);
  reviewGates.set(maxConcurrent, gate);
  return gate;
}
