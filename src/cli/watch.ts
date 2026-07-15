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
