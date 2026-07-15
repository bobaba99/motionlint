import { dirname, join, resolve, sep } from "node:path";

/**
 * Debounced, coalescing rerun queue for watch mode. File-change events
 * arrive in bursts; at most one run is in flight, and any notifications
 * during a run collapse into exactly one follow-up run.
 */
export interface RerunController {
  notify: () => void;
  stop: () => void;
}

export function createRerunQueue(run: () => Promise<void>, debounceMs = 300): RerunController {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let dirty = false;
  let stopped = false;

  const kick = (): void => {
    if (stopped || running) return;
    running = true;
    dirty = false;
    void run()
      .catch(() => { /* a failed run must not kill the watcher */ })
      .finally(() => {
        running = false;
        if (dirty && !stopped) schedule();
      });
  };

  const schedule = (): void => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(kick, debounceMs);
  };

  return {
    notify: (): void => {
      if (stopped) return;
      dirty = true;
      if (!running) schedule();
    },
    stop: (): void => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

/**
 * True when a watch event should be ignored because it was caused by our
 * own output (report/json writes inside the watched directory), rather than
 * a real source change worth rerunning for. Without this, `--watch <dir>`
 * that overlaps the report's output directory self-triggers forever.
 */
export function isOwnOutputEvent(watchDir: string, filename: string | null, ignorePaths: string[]): boolean {
  if (filename === null) return false;

  // Any path segment named .motionlint is our own scratch/report directory,
  // regardless of which specific output paths were configured.
  if (filename.split(sep).includes(".motionlint")) return true;

  const resolvedEvent = resolve(join(watchDir, filename));
  for (const raw of ignorePaths) {
    const ignorePath = resolve(raw);
    if (resolvedEvent === ignorePath) return true;
    const ignoreDir = dirname(ignorePath);
    if (resolvedEvent === ignoreDir || resolvedEvent.startsWith(ignoreDir + sep)) return true;
  }
  return false;
}
