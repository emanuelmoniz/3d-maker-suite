import { expect, it } from "vitest";
import { localHub } from "./state.ts";

const env = { APP_DATA_DIR: undefined, APPDATA: "C:\none" };
const answer =
  (body: unknown, ok = true) =>
  async () =>
    ({ ok, json: async () => body }) as Response;

it("finds a hub answering on this machine, and not itself or anything else", async () => {
  const opts = { env, platform: "win32" as const };
  const hub = answer({ status: "ok", version: "5.1.0" });
  expect(await localHub(4301, { ...opts, fetcher: hub })).toBe("5.1.0");
  expect(await localHub(4300, { ...opts, fetcher: hub })).toBeUndefined();
  expect(await localHub(4301, { ...opts, fetcher: answer({ nope: 1 }) })).toBeUndefined();
  const down = async () => {
    throw new Error("ECONNREFUSED");
  };
  expect(await localHub(4301, { ...opts, fetcher: down })).toBeUndefined();
});
