import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadGate } from "./readGate.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createReadGate", () => {
  it("reads at once on a change, and a burst is one read per second", async () => {
    const read = vi.fn(async () => {});
    const gate = createReadGate(read, 1000);
    gate.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) gate.request();
    await vi.advanceTimersByTimeAsync(999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("a change during a read gets one more read after it", async () => {
    let finish = () => {};
    const read = vi.fn(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    const gate = createReadGate(read, 0);
    void gate.now();
    gate.request();
    gate.request();
    expect(read).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    finish();
    await vi.advanceTimersByTimeAsync(10);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("the timer's read never waits for the gap", async () => {
    const read = vi.fn(async () => {});
    const gate = createReadGate(read, 1000);
    await gate.now();
    await gate.now();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads nothing after close, also what was waiting", async () => {
    const read = vi.fn(async () => {});
    const gate = createReadGate(read, 1000);
    await gate.now();
    gate.request(); // waits for the gap
    gate.close();
    gate.request();
    await gate.now();
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
