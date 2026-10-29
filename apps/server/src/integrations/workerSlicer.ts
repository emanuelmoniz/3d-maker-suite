import { createReadStream, createWriteStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type DeviceSlicerInstall,
  deviceSlicerCheckSchema,
  deviceSliceSchema,
  type IntegrationAdapter,
  IntegrationError,
  SLICE_TIMEOUT_MS,
  type SliceRun,
  type SlicerCheck,
  type SlicerInstallStatus,
  workerConfigSchema,
} from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { HttpError } from "../errors.ts";
import type { HubChannel } from "../lib/hubChannel.ts";
import { fingerprint } from "../projects/fingerprint.ts";
import { SliceWait } from "../projects/sliceQueue.ts";
import type { SlicerInstaller } from "./managedSlicer.ts";

// A worker integration's slicer lives on its device (ADR-0014): one installed there, checked with
// `--help`, or a managed one the connector downloads into its data folder. The hub picks the
// release for the device's system; the device reports the install's progress.

const { devices, integrations } = schema;
/** No report for this long while running: the connector restarted, the install is gone. */
const STALE_MS = 10 * 60_000;
/** `--help` on the device: a first start (macOS' Gatekeeper check) can take a while. */
const CHECK_MS = 90_000;

const idle = (): SlicerInstallStatus => ({
  state: "idle",
  phase: null,
  tag: null,
  received: 0,
  total: 0,
  error: null,
  detail: null,
  startedAt: null,
  finishedAt: null,
});

const deviceError = (e: NodeJS.ErrnoException) =>
  e.code === "vcredist_missing" || e.code === "smoke_failed"
    ? new HttpError(422, e.code, "The slicer doesn't run on the device")
    : e.code === "no_slicer"
      ? new HttpError(409, "device_no_slicer", "No such slicer on the device")
      : new HttpError(500, "device_failed", `The device answered ${e.code}`);

export function createWorkerSlicers(
  db: Db,
  adapters: IntegrationAdapter[],
  channel: HubChannel,
  installer: SlicerInstaller,
) {
  // ponytail: in memory; a hub restart forgets a running install's progress, its result still lands.
  const jobs = new Map<string, SlicerInstallStatus & { deviceId: string; reportedAt: number }>();
  /** Slices running on devices, by request: the server's work folder, the 3MF, what was sent. */
  const slices = new Map<string, { deviceId: string; dir: string; file: string; sent: string[] }>();
  const slice = (deviceId: string, requestId: string) => {
    const s = slices.get(requestId);
    if (s?.deviceId !== deviceId) throw new HttpError(404, "not_found", "No such slice");
    return s;
  };

  /** The worker integration and its device; `ready`: the device is a worker and online. */
  const workerOf = (id: string) => {
    const row = db.select().from(integrations).where(eq(integrations.id, id)).get();
    if (!row) throw new HttpError(404, "not_found", "Integration not found");
    const adapter = adapters.find((a) => a.id === row.adapterId);
    const config = workerConfigSchema.safeParse(row.config).data;
    if (adapter?.kind !== "worker" || !config)
      throw new HttpError(400, "not_worker", "This integration isn't a slice worker");
    return { row, adapter, config };
  };
  const online = (id: string) => {
    const { config } = workerOf(id);
    const device = db.select().from(devices).where(eq(devices.id, config.deviceId)).get();
    if (!device?.sliceWorker)
      throw new HttpError(409, "not_worker", "The device isn't a slice worker");
    if (!channel.online(device.id))
      throw new HttpError(409, "device_offline", "The device is offline");
    return device;
  };
  const save = (id: string, set: { slicerPath: string | null; slicerVersion: string | null }) =>
    db
      .update(integrations)
      .set({ ...set, updatedAt: new Date().toISOString() })
      .where(eq(integrations.id, id))
      .run();

  const status = (id: string): SlicerInstallStatus => {
    const job = jobs.get(id);
    if (!job) return idle();
    const { deviceId, reportedAt, ...s } = job;
    if (
      s.state === "running" &&
      (!channel.online(deviceId) || Date.now() - reportedAt > STALE_MS)
    ) {
      Object.assign(job, {
        state: "failed",
        phase: null,
        error: "device_offline",
        finishedAt: new Date().toISOString(),
      });
      return status(id);
    }
    return s;
  };
  const busy = (id: string) => {
    if (status(id).state === "running")
      throw new HttpError(409, "install_running", "A slicer install is running");
  };

  return {
    isWorker: (id: string) => {
      const row = db.select().from(integrations).where(eq(integrations.id, id)).get();
      return adapters.find((a) => a.id === row?.adapterId)?.kind === "worker";
    },

    releases: (id: string, pre: boolean) => installer.releases(id, pre),
    status,

    /** Sends the release for the device's system; the device reports from then on. */
    async install(id: string, tag: string) {
      busy(id);
      const device = online(id);
      const rel = (await installer.installable(id, true)).find((r) => r.tag === tag);
      const system = installer.systemOf(id);
      const { adapter } = workerOf(id);
      if (!rel || !system || !adapter.managed)
        throw new HttpError(404, "unknown_release", "No such release for this system");
      busy(id); // the list may have taken a while
      const job = {
        ...idle(),
        deviceId: device.id,
        reportedAt: Date.now(),
        state: "running" as const,
        phase: "download" as const,
        tag,
        total: rel.asset.size,
        startedAt: new Date().toISOString(),
      };
      jobs.set(id, job);
      const integrationId = id;
      await channel
        .ask(
          device.id,
          (requestId) => ({
            type: "slicer.install",
            requestId,
            integrationId,
            target: {
              version: rel.tag.replace(/^v/i, ""),
              exe: adapter.managed?.exe(system.platform) ?? "",
              asset: { ...rel.asset, digest: rel.asset.digest ?? "" },
            },
          }),
          z.null(),
          { error: deviceError },
        )
        .catch((e) => {
          jobs.delete(id);
          throw e;
        });
      return status(id);
    },

    /** The device's progress; `done` puts its program and version on the row. */
    report(deviceId: string, { integrationId, status: s, result }: DeviceSlicerInstall) {
      const job = jobs.get(integrationId);
      const { row, config } = workerOf(integrationId);
      if (config.deviceId !== deviceId)
        throw new HttpError(403, "forbidden", "Not this device's slicer");
      jobs.set(integrationId, {
        ...s,
        deviceId,
        reportedAt: Date.now(),
        tag: s.tag ?? job?.tag ?? null,
      });
      if (s.state === "done" && result) {
        save(row.id, { slicerPath: result.path, slicerVersion: result.version });
        if (result.version) installer.installed(row.id, result.version);
      }
    },

    /** An installed slicer (found there, or a typed path) that runs with `--help` becomes the worker's. */
    async check(id: string, body: SlicerCheck) {
      const device = online(id);
      const found = await channel.ask(
        device.id,
        (requestId) => ({ type: "slicer.check", requestId, ...body }),
        deviceSlicerCheckSchema,
        { ms: CHECK_MS, error: deviceError },
      );
      save(id, { slicerPath: found.path, slicerVersion: found.version });
      return found;
    },

    /**
     * Deletes the managed slicer on the device; `forget` (Remove, not integration delete) also
     * clears the row. An offline device drops it when it next connects (`GET .../slicers/managed`).
     */
    async remove(id: string, forget = true) {
      busy(id);
      jobs.delete(id);
      installer.resolveAlerts(id, () => true);
      if (forget) save(id, { slicerPath: null, slicerVersion: null });
      const deviceId = workerConfigSchema.safeParse(
        db.select().from(integrations).where(eq(integrations.id, id)).get()?.config,
      ).data?.deviceId;
      if (deviceId && channel.online(deviceId))
        await channel
          .ask(
            deviceId,
            (requestId) => ({ type: "slicer.remove", requestId, integrationId: id }),
            z.null(),
          )
          .catch(() => {}); // it goes on the next connect then
    },

    /**
     * How the worker `id` runs a slice (`SliceRun`): the files the slicer prepared in its work
     * folder and the args go to the device (`{dir}` for the folder), which pulls the 3MF unless it
     * has those bytes, and sends back what the run wrote; reading the result stays here. Offline,
     * now or before it answers, the job waits (`SliceWait`).
     */
    runner(id: string): SliceRun {
      const { deviceId } = workerOf(id).config;
      if (!channel.online(deviceId)) throw new SliceWait();
      return async (program, args, file, dir, signal) => {
        const sent = await readdir(dir);
        const files = Object.fromEntries(
          await Promise.all(sent.map(async (n) => [n, await readFile(join(dir, n), "utf8")])),
        );
        const sha256 = (await fingerprint(file))?.fileSha256;
        if (!sha256) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        const swap = (a: string) => a.replaceAll(dir + sep, "{dir}/").replaceAll(dir, "{dir}");
        let requestId = "";
        const stopped = new Promise<never>((_, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true },
          ),
        );
        stopped.catch(() => {}); // an abort after the answer is nobody's error
        try {
          const answer = channel.ask(
            deviceId,
            (rid) => {
              requestId = rid;
              slices.set(rid, { deviceId, dir, file, sent });
              return {
                type: "slice",
                requestId: rid,
                program,
                args: args.map(swap),
                files,
                sha256,
              };
            },
            deviceSliceSchema,
            // The signal (the slicer's timeout) stops it first; this only catches a lost answer.
            { ms: SLICE_TIMEOUT_MS + 60_000, error: (e) => e },
          );
          return (await Promise.race([answer, stopped])).code;
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === "device_offline") throw new SliceWait();
          if (code === "device_timeout")
            throw Object.assign(new Error("timeout"), { name: "AbortError" });
          // ENOENT: the program isn't there (the slicer says so); others are the worker's own.
          if (e instanceof HttpError || !code || code === "ENOENT") throw e;
          throw new IntegrationError("slice_failed", `The slice worker failed (${code})`);
        } finally {
          slices.delete(requestId);
        }
      };
    },

    /** The device pulls a running slice's 3MF. */
    sliceFile: (deviceId: string, requestId: string) =>
      createReadStream(slice(deviceId, requestId).file),

    /** A file the device's run wrote, into the server's work folder (never over what was sent). */
    async sliceOutput(deviceId: string, requestId: string, name: string, body: Readable) {
      const s = slice(deviceId, requestId);
      if (s.sent.includes(name)) throw new HttpError(409, "conflict", "That file was sent");
      await pipeline(body, createWriteStream(join(s.dir, name)));
    },

    /** The worker integrations on this device with a managed slicer: the others' folders go. */
    managedOn: (deviceId: string) =>
      db
        .select()
        .from(integrations)
        .all()
        .filter((r) => {
          const config = workerConfigSchema.safeParse(r.config).data;
          return config?.deviceId === deviceId && config.source === "managed";
        })
        .map((r) => r.id),
  };
}

export type WorkerSlicers = ReturnType<typeof createWorkerSlicers>;
