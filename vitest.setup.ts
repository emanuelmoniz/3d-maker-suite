import { afterEach } from "vitest";

// Taken now, before a test can fake the timers.
const nextLoopTurn = setImmediate;

let received = 0;
process.on("message", () => {
  received++;
});

// A worker reads one of Vitest's replies per event loop turn, and a file of synchronous tests
// (SQLite migrations) gives it no turns of its own. The replies queue up until one is 60 s late:
// `Timeout calling "onTaskUpdate"` fails a run whose tests all passed. So after each test, read
// until a turn brings nothing new.
afterEach(async () => {
  let seen: number;
  do {
    seen = received;
    await new Promise<void>((resolve) => nextLoopTurn(resolve));
  } while (received !== seen);
});
