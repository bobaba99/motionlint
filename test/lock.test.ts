import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MemoryLockTimeoutError, withMemoryLock } from "../src/memory/lock.js";

const scratchDirs: string[] = [];
async function scratchDir(): Promise<string> {
  await mkdir(resolve(".motionlint/test-samples"), { recursive: true });
  const dir = await mkdtemp(resolve(".motionlint/test-samples/lock-"));
  scratchDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("withMemoryLock", () => {
  it("serializes concurrent read-modify-write cycles (no lost update)", async () => {
    const dir = await scratchDir();
    const path = join(dir, "memory.json");
    await writeFile(path, JSON.stringify({ count: 0 }), "utf8");

    // Each task stalls between read and write — unserialized, both would read
    // 0 and the final count would be 1 (a lost update).
    const increment = () =>
      withMemoryLock(path, async () => {
        const parsed = JSON.parse(await readFile(path, "utf8")) as { count: number };
        await sleep(50);
        await writeFile(path, JSON.stringify({ count: parsed.count + 1 }), "utf8");
      });

    await Promise.all([increment(), increment()]);
    const final = JSON.parse(await readFile(path, "utf8")) as { count: number };
    assert.equal(final.count, 2);
  });

  it("returns the callback's value and removes the lock file afterwards", async () => {
    const dir = await scratchDir();
    const path = join(dir, "memory.json");
    const out = await withMemoryLock(path, async () => "done");
    assert.equal(out, "done");
    await assert.rejects(() => stat(`${path}.lock`), /ENOENT/);
  });

  it("releases the lock when the callback throws", async () => {
    const dir = await scratchDir();
    const path = join(dir, "memory.json");
    await assert.rejects(
      () => withMemoryLock(path, async () => Promise.reject(new Error("boom"))),
      /boom/,
    );
    const recovered = await withMemoryLock(path, async () => "recovered");
    assert.equal(recovered, "recovered");
  });

  it("creates the store directory if missing", async () => {
    const dir = await scratchDir();
    const path = join(dir, "nested", "deeper", "memory.json");
    const out = await withMemoryLock(path, async () => "ok");
    assert.equal(out, "ok");
  });

  it("breaks a stale lock left by a dead process", async () => {
    const dir = await scratchDir();
    const path = join(dir, "memory.json");
    const lockPath = `${path}.lock`;
    // 2^30 is far above any real pid ceiling, so liveness probing reports it dead.
    await writeFile(lockPath, JSON.stringify({ pid: 2 ** 30, acquired_at: "2020-01-01T00:00:00Z" }), "utf8");
    const past = new Date(Date.now() - 60_000);
    await utimes(lockPath, past, past);

    const out = await withMemoryLock(path, async () => "took over", { timeoutMs: 1_000 });
    assert.equal(out, "took over");
  });

  it("breaks a fresh lock whose recorded pid is dead (liveness branch, not age)", async () => {
    const dir = await scratchDir();
    const path = join(dir, "memory.json");
    const lockPath = `${path}.lock`;
    // Fresh mtime forces the decision through the pid probe, not the age check.
    await writeFile(lockPath, JSON.stringify({ pid: 2 ** 30, acquired_at: new Date().toISOString() }), "utf8");

    const out = await withMemoryLock(path, async () => "took over", { timeoutMs: 1_000 });
    assert.equal(out, "took over");
  });

  it("keeps mutual exclusion when two waiters race to break the same stale lock", async () => {
    const dir = await scratchDir();
    const path = join(dir, "memory.json");
    const lockPath = `${path}.lock`;
    await writeFile(path, JSON.stringify({ count: 0 }), "utf8");
    await writeFile(lockPath, JSON.stringify({ pid: 2 ** 30, acquired_at: "2020-01-01T00:00:00Z" }), "utf8");
    const past = new Date(Date.now() - 60_000);
    await utimes(lockPath, past, past);

    // Regression canary for the non-atomic-break race: a waiter that decided
    // "stale" from the old lock must not delete the fresh lock a faster
    // waiter created in the meantime.
    const increment = () =>
      withMemoryLock(path, async () => {
        const parsed = JSON.parse(await readFile(path, "utf8")) as { count: number };
        await sleep(50);
        await writeFile(path, JSON.stringify({ count: parsed.count + 1 }), "utf8");
      });
    await Promise.all([increment(), increment()]);
    const final = JSON.parse(await readFile(path, "utf8")) as { count: number };
    assert.equal(final.count, 2);
  });

  it("breaks a lock older than staleMs even when the pid is alive", async () => {
    const dir = await scratchDir();
    const path = join(dir, "memory.json");
    const lockPath = `${path}.lock`;
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, acquired_at: "2020-01-01T00:00:00Z" }), "utf8");
    const past = new Date(Date.now() - 60_000);
    await utimes(lockPath, past, past);

    const out = await withMemoryLock(path, async () => "took over", { timeoutMs: 1_000, staleMs: 10_000 });
    assert.equal(out, "took over");
  });

  it("times out with a descriptive error while a fresh live lock is held", async () => {
    const dir = await scratchDir();
    const path = join(dir, "memory.json");
    const lockPath = `${path}.lock`;
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() }), "utf8");

    await assert.rejects(
      () => withMemoryLock(path, async () => "never", { timeoutMs: 200, pollMs: 25 }),
      (err: unknown) => {
        assert.ok(err instanceof MemoryLockTimeoutError);
        assert.match((err as Error).message, /memory\.json\.lock/);
        return true;
      },
    );
    await rm(lockPath, { force: true });
  });

  it("tolerates an unparseable lock file by falling back to age-based staleness", async () => {
    const dir = await scratchDir();
    const path = join(dir, "memory.json");
    const lockPath = `${path}.lock`;
    await writeFile(lockPath, "{not json", "utf8");
    const past = new Date(Date.now() - 60_000);
    await utimes(lockPath, past, past);

    const out = await withMemoryLock(path, async () => "took over", { timeoutMs: 1_000, staleMs: 10_000 });
    assert.equal(out, "took over");
  });
});
