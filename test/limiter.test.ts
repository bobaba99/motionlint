import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter, Semaphore, sharedRateLimiter, sharedReviewGate, withRateLimit } from "../src/resources/limiter.js";
import type { AnalysisResult, VisionProvider } from "../src/types.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("Semaphore", () => {
  it("never runs more than max tasks concurrently and completes all of them", async () => {
    const gate = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred());
    const tasks = gates.map((g, i) =>
      gate.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await g.promise;
        active--;
        return i;
      }),
    );
    // Let the first two start, then release everything in order.
    await new Promise((r) => setImmediate(r));
    assert.equal(active, 2, "only two tasks may hold the gate");
    for (const g of gates) g.resolve();
    const results = await Promise.all(tasks);
    assert.deepEqual(results, [0, 1, 2, 3, 4]);
    assert.equal(peak, 2);
  });

  it("releases the slot when a task throws", async () => {
    const gate = new Semaphore(1);
    await assert.rejects(() => gate.run(async () => Promise.reject(new Error("boom"))), /boom/);
    const ok = await gate.run(async () => "recovered");
    assert.equal(ok, "recovered");
  });

  it("grants waiting tasks in FIFO order", async () => {
    const gate = new Semaphore(1);
    const order: number[] = [];
    const first = deferred();
    const running = gate.run(async () => {
      await first.promise;
    });
    const waiters = [1, 2, 3].map((n) =>
      gate.run(async () => {
        order.push(n);
      }),
    );
    first.resolve();
    await Promise.all([running, ...waiters]);
    assert.deepEqual(order, [1, 2, 3]);
  });
});

describe("RateLimiter", () => {
  function fakeClock() {
    let now = 0;
    const sleeps: number[] = [];
    return {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
      sleeps,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it("admits up to the limit immediately, then waits out the window", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ limit: 2, windowMs: 60_000, now: clock.now, sleep: clock.sleep });
    await limiter.acquire();
    await limiter.acquire();
    assert.equal(clock.sleeps.length, 0, "first two calls must not wait");
    await limiter.acquire();
    assert.ok(clock.sleeps.length > 0, "third call must wait for the window");
    assert.equal(clock.now(), 60_000, "third call admitted exactly when the window frees");
  });

  it("does not wait once the window has naturally passed", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000, now: clock.now, sleep: clock.sleep });
    await limiter.acquire();
    clock.advance(61_000);
    await limiter.acquire();
    assert.equal(clock.sleeps.length, 0);
  });
});

describe("withRateLimit", () => {
  function stubProvider(calls: string[]): VisionProvider {
    return {
      name: "stub",
      model: "stub-1",
      isAvailable: async () => true,
      analyze: async (_s: Buffer, _p: string, viewportName: string): Promise<AnalysisResult> => {
        calls.push(viewportName);
        return { overall_score: 7, summary: "", issues: [], strengths: [], viewport: viewportName };
      },
    };
  }

  it("returns the provider unchanged when no limiter is given", () => {
    const provider = stubProvider([]);
    assert.equal(withRateLimit(provider, null), provider);
  });

  it("passes analyze calls through the limiter, preserving identity fields", async () => {
    const acquired: number[] = [];
    const limiter = {
      acquire: async () => {
        acquired.push(acquired.length);
      },
    } as unknown as RateLimiter;
    const calls: string[] = [];
    const limited = withRateLimit(stubProvider(calls), limiter);
    assert.equal(limited.name, "stub");
    assert.equal(limited.model, "stub-1");
    const result = await limited.analyze(Buffer.from(""), "prompt", "desktop");
    assert.equal(result.viewport, "desktop");
    assert.deepEqual(calls, ["desktop"]);
    assert.equal(acquired.length, 1, "analyze must acquire the limiter first");
  });
});

describe("shared limiter registries", () => {
  it("returns null for null, undefined, or non-positive values", () => {
    for (const v of [null, undefined, 0, -5, 1.5]) {
      assert.equal(sharedRateLimiter(v as number | null), null, `rate ${v}`);
      assert.equal(sharedReviewGate(v as number | null), null, `gate ${v}`);
    }
  });

  it("returns the same instance for the same setting so limits span calls", () => {
    assert.equal(sharedRateLimiter(30), sharedRateLimiter(30));
    assert.equal(sharedReviewGate(2), sharedReviewGate(2));
    assert.notEqual(sharedRateLimiter(30), sharedRateLimiter(31));
  });
});
