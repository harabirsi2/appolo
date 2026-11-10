/**
 * Coalesce repeated work per key into one run.
 *
 * A burst of `schedule()` calls for the same key runs the latest task once,
 * `delayMs` after the burst settles. If work arrives while a run is in flight,
 * exactly one follow-up run is queued. Tasks run one at a time per key, so a
 * cheap request can mark work dirty without waiting for (or racing) the work
 * itself.
 *
 * This is process-local by design: it deduplicates redundant work in one
 * server process. Anything that must survive a restart belongs in the durable
 * source of truth, not here.
 */
export type CoalescedTask = () => Promise<void>;

export interface CoalescingRunnerOptions {
  /** Idle time required before a scheduled task runs. */
  delayMs: number;
  /** Called for rejected tasks; a failure never stops later runs. */
  onError?: (error: unknown, key: string) => void;
}

export interface CoalescingRunner {
  /**
   * Queue `task` for `key`. Replaces any task not yet started and schedules a
   * run `delayMs` from now. Safe to call while a task is running.
   */
  schedule(key: string, task: CoalescedTask): void;
  /** Run pending work for `key` now and resolve when the key is idle. */
  flush(key: string): Promise<void>;
  /** Drop pending work for `key`; a task already running is left alone. */
  cancel(key: string): void;
  /** True while `key` has a timer, queued task or in-flight run. */
  isPending(key: string): boolean;
  /** Keys with queued or running work; useful in diagnostics and tests. */
  size(): number;
  /** Drop all timers and queued tasks; further `schedule` calls are ignored. */
  stop(): void;
}

interface Entry {
  task: CoalescedTask | null;
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  rerun: boolean;
}

export function createCoalescingRunner(options: CoalescingRunnerOptions): CoalescingRunner {
  if (!(options.delayMs >= 0)) {
    throw new RangeError("delayMs must be a non-negative number");
  }

  const entries = new Map<string, Entry>();
  let stopped = false;

  const entryFor = (key: string): Entry => {
    const existing = entries.get(key);
    if (existing) return existing;
    const created: Entry = { task: null, timer: null, running: null, rerun: false };
    entries.set(key, created);
    return created;
  };

  const clearTimer = (entry: Entry): void => {
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  };

  const run = async (key: string): Promise<void> => {
    const entry = entries.get(key);
    if (!entry || entry.running) return entry?.running ?? Promise.resolve();

    const task = entry.task;
    if (!task) return;
    entry.task = null;
    entry.rerun = false;

    entry.running = Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        options.onError?.(error, key);
      })
      .finally(() => {
        entry.running = null;
      });

    await entry.running;

    if (!entry.task && !entry.timer && !entry.running) entries.delete(key);
    else if (entry.rerun && entry.task && !stopped) {
      entry.rerun = false;
      queue(key, entry);
    }
  };

  const queue = (key: string, entry: Entry): void => {
    clearTimer(entry);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void run(key);
    }, options.delayMs);
    // Never hold the process open for background refreshes.
    entry.timer.unref?.();
  };

  return {
    schedule(key, task) {
      if (stopped) return;
      const entry = entryFor(key);
      entry.task = task;
      if (entry.running) {
        entry.rerun = true;
        return;
      }
      queue(key, entry);
    },

    async flush(key) {
      const entry = entries.get(key);
      if (!entry) return;
      clearTimer(entry);
      for (;;) {
        if (entry.running) {
          await entry.running;
          continue;
        }
        if (!entry.task) break;
        clearTimer(entry);
        await run(key);
      }
      entries.delete(key);
    },

    cancel(key) {
      const entry = entries.get(key);
      if (!entry) return;
      clearTimer(entry);
      entry.task = null;
      entry.rerun = false;
      if (!entry.running) entries.delete(key);
    },

    isPending(key) {
      const entry = entries.get(key);
      return Boolean(entry && (entry.task || entry.timer || entry.running));
    },

    size() {
      return entries.size;
    },

    stop() {
      stopped = true;
      for (const entry of entries.values()) {
        clearTimer(entry);
        entry.task = null;
      }
      entries.clear();
    },
  };
}
