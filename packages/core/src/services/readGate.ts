/** At most one read per this long for a source that says it changed (ADR-0015, Step 19c). */
export const CHANGE_READ_MIN_MS = 1_000;

/**
 * Runs one source's reads one at a time. `request()` is for a change the source pushed: the read
 * starts at once, unless one started less than `minGapMs` ago (then it waits for that gap, and a
 * burst of requests is one read) or one is running (then one more follows it). `now()` is for the
 * timer and the first read: they never wait for the gap, but a request that comes while they run
 * still gets its read after.
 */
export function createReadGate(
  read: () => Promise<void>,
  minGapMs = CHANGE_READ_MIN_MS,
  clock: () => number = Date.now,
) {
  let running = false;
  let queued = false;
  let startedAt = Number.NEGATIVE_INFINITY;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  async function run() {
    running = true;
    startedAt = clock();
    try {
      await read();
    } finally {
      running = false;
      if (queued && !closed) {
        queued = false;
        request();
      }
    }
  }

  function request() {
    if (closed) return;
    if (running) {
      queued = true;
      return;
    }
    if (timer) return;
    const wait = startedAt + minGapMs - clock();
    if (wait <= 0) {
      void run();
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      if (!closed) request();
    }, wait);
    timer.unref();
  }

  return {
    request,
    /** A read the caller decides to make (the timer's). */
    now() {
      if (closed) return Promise.resolve();
      if (running) {
        queued = true;
        return Promise.resolve();
      }
      return run();
    },
    /** No read starts after this. */
    close() {
      closed = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
