import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleepFor } from "node:timers/promises";

export interface MemoryLockOptions {
  /** Give up waiting after this long. The pipeline treats a timeout as a warning, not a failure. */
  timeoutMs?: number;
  /** A lock file older than this is considered abandoned and broken. */
  staleMs?: number;
  /** Retry interval while waiting for a held lock. */
  pollMs?: number;
}

const DEFAULTS: Required<MemoryLockOptions> = {
  // The lock only spans the store's read-modify-write (milliseconds), so
  // waiting past a few seconds means something is wrong, not busy. With
  // staleMs > timeoutMs, a waiter present from the start times out (and the
  // pipeline proceeds unlocked) before it would age-break a wedged-but-live
  // holder — the caller's timeout fallback, not the age check, is the
  // recovery path for that case. Age-breaking covers locks that were already
  // old when a run arrived.
  timeoutMs: 5_000,
  staleMs: 10_000,
  pollMs: 50,
};

export class MemoryLockTimeoutError extends Error {}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = exists but owned by someone else; anything else (ESRCH) = gone.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function lockIsStale(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs > staleMs) return true;
    const raw = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: number };
    return typeof raw.pid === "number" ? !pidAlive(raw.pid) : false;
  } catch {
    // Vanished between checks (owner released it) or unreadable but recent:
    // let the acquire retry decide.
    return false;
  }
}

async function tryAcquire(lockPath: string, token: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
  try {
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, token, acquired_at: new Date().toISOString() }),
      "utf8",
    );
  } finally {
    await handle.close();
  }
  return true;
}

/**
 * Breaks a stale lock atomically: rename gives exactly one waiter the
 * original inode, so a racing waiter can never delete the fresh lock a
 * faster one just created (plain rm would).
 */
async function breakStale(lockPath: string): Promise<void> {
  const victim = `${lockPath}.stale.${process.pid}.${randomBytes(4).toString("hex")}`;
  try {
    await rename(lockPath, victim);
  } catch {
    return; // Someone else already broke or released it; just retry acquire.
  }
  await rm(victim, { force: true });
}

/** Removes the lock only if it still carries our token, so a holder whose lock was age-broken never deletes a successor's. */
async function releaseOwn(lockPath: string, token: string): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(lockPath, "utf8")) as { token?: string };
    if (raw.token !== token) return;
  } catch {
    return; // Already gone or unreadable — nothing of ours to release.
  }
  await rm(lockPath, { force: true });
}

/**
 * Runs `fn` while holding an exclusive lock on `storePath`'s companion
 * `.lock` file, so concurrent reviews of one project don't clobber each
 * other's recorded sightings. Locks abandoned by dead or wedged processes
 * are broken by pid-liveness and age checks. Throws MemoryLockTimeoutError
 * if the lock stays held past `timeoutMs` — callers decide whether that is
 * fatal (the review pipeline warns and proceeds unlocked instead).
 *
 * Assumes a local filesystem: the pid probe checks the local process table
 * and wx-create atomicity is not guaranteed on NFS-style mounts.
 */
export async function withMemoryLock<T>(
  storePath: string,
  fn: () => Promise<T>,
  opts: MemoryLockOptions = {},
): Promise<T> {
  const { timeoutMs, staleMs, pollMs } = { ...DEFAULTS, ...opts };
  const lockPath = `${storePath}.lock`;
  const token = `${process.pid}:${randomBytes(8).toString("hex")}`;
  await mkdir(dirname(lockPath), { recursive: true });

  const deadline = Date.now() + timeoutMs;
  while (!(await tryAcquire(lockPath, token))) {
    if (await lockIsStale(lockPath, staleMs)) {
      await breakStale(lockPath);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new MemoryLockTimeoutError(
        `Timed out after ${timeoutMs}ms waiting for memory lock ${lockPath} (held by another live run).`,
      );
    }
    await sleepFor(pollMs);
  }

  try {
    return await fn();
  } finally {
    await releaseOwn(lockPath, token);
  }
}
