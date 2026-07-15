import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRerunQueue } from "../src/cli/watch.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createRerunQueue", () => {
  it("debounces a burst of notifications into one run", async () => {
    let runs = 0;
    const q = createRerunQueue(async () => { runs++; }, 30);
    q.notify(); q.notify(); q.notify();
    await sleep(100);
    q.stop();
    assert.equal(runs, 1);
  });

  it("coalesces notifications that arrive mid-run into exactly one follow-up", async () => {
    let runs = 0;
    const q = createRerunQueue(async () => { runs++; await sleep(60); }, 10);
    q.notify();
    await sleep(30);         // first run in flight
    q.notify(); q.notify();  // both land mid-run
    await sleep(250);
    q.stop();
    assert.equal(runs, 2);
  });

  it("does not run after stop()", async () => {
    let runs = 0;
    const q = createRerunQueue(async () => { runs++; }, 10);
    q.stop();
    q.notify();
    await sleep(50);
    assert.equal(runs, 0);
  });
});
