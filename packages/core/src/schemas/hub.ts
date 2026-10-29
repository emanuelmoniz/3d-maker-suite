import { z } from "zod";
import { id, isoDate } from "./entities.ts";
import { projectFileSchema, projectGallerySchema, projectModelSchema } from "./projects.ts";

/**
 * Why a connector stays on its version (`X-Connector-Update` on the event stream, as JSON):
 * `download` failed (with the error), or the launcher went back from it (`rollback`).
 */
export const connectorUpdateFailureSchema = z.object({
  version: z.string().max(50),
  reason: z.enum(["download", "rollback"]),
  error: z.string().max(200).optional(),
});

/** A connector paired with the hub (ADR-0014), as Hub management lists it. */
export const deviceSchema = z.object({
  id,
  name: z.string(),
  userId: id,
  userName: z.string(),
  os: z.string().nullable(),
  connectorVersion: z.string().nullable(),
  lastSeenAt: isoDate.nullable(),
  /** Its event stream is open now. */
  online: z.boolean(),
  /** Its connector version isn't the hub's. */
  outdated: z.boolean(),
  /** What it reported last time its stream opened; null = no failed update. */
  updateFailed: connectorUpdateFailureSchema.nullable(),
  createdAt: isoDate,
});

const name = z.string().trim().min(1).max(100);

export const deviceRenameSchema = z.object({ name }).strict();

/** An admin makes a code for a user (`POST /api/hub/pairing-codes`). */
export const pairingCodeCreateSchema = z.object({ userId: id });
/** Shown once; only its sha256 is stored. */
export const pairingCodeSchema = z.object({ code: z.string(), expiresAt: isoDate });

/** The connector exchanges a code for a device token (`POST /api/hub/pair`). */
export const pairSchema = z.object({
  code: z.string().max(20),
  name,
  os: z.string().trim().max(100).optional(),
  connectorVersion: z.string().trim().max(50).optional(),
});
/** `token` goes in `Authorization: Bearer`; it's returned only here. */
export const pairResultSchema = z.object({ token: z.string(), deviceId: id });

export type Device = z.infer<typeof deviceSchema>;
export type ConnectorUpdateFailure = z.infer<typeof connectorUpdateFailureSchema>;
export type DeviceRename = z.input<typeof deviceRenameSchema>;
export type PairingCodeCreate = z.input<typeof pairingCodeCreateSchema>;
export type PairingCode = z.infer<typeof pairingCodeSchema>;
export type PairInput = z.input<typeof pairSchema>;
export type PairResult = z.infer<typeof pairResultSchema>;

/**
 * Hub → device events on `GET /api/hub/events` (ADR-0014): SSE frames `id: <seq>`, `event: <type>`,
 * `data: <json>`. The connector sends its last id as `Last-Event-ID`; that acks everything up to it.
 * A request (`requestId`) goes only to an open stream and has no id: it is never replayed. The
 * connector answers it on `POST /api/hub/device/replies/:requestId`.
 */
export const hubEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("device.renamed"), name }),
  /** Update now (an admin): download the hub's version at once, even one that rolled back. */
  z.object({ type: z.literal("connector.update") }),
  /** Its roots were added, changed or removed, or a scan was asked for: read them, sync them all. */
  z.object({ type: z.literal("roots.changed") }),
  /** One level of the folder browser (`listFolder`); `path` null = where browsing starts. */
  z.object({ type: z.literal("fs.list"), requestId: id, path: z.string().max(4096).nullable() }),
  /**
   * Send a file of a device root: `PUT /api/hub/device/files/:requestId` with the bytes and its
   * `X-File-Sha256` and `X-File-Mtime`, or an error answer.
   */
  z.object({ type: z.literal("fs.upload"), requestId: id, rootId: id, rel: z.string().max(1024) }),
  /** Make a folder in a device root; the answer's result is null. */
  z.object({ type: z.literal("fs.mkdir"), requestId: id, rootId: id, rel: z.string().max(1024) }),
  /** Move `rel` to the root's trash as `as`; the answer's result is `{ path }`, where it went. */
  z.object({
    type: z.literal("fs.trash"),
    requestId: id,
    rootId: id,
    rel: z.string().max(1024),
    as: z.string().max(1024),
  }),
]);
/** What the connector reports when it opens the stream (`X-Connector-Version`, `X-Connector-OS`). */
export const connectorInfoSchema = pairSchema.pick({ connectorVersion: true, os: true });

/** A `: hb` comment this often keeps the device online and proxies from closing a quiet stream. */
export const HUB_HEARTBEAT_MS = 15_000;

export type HubEvent = z.infer<typeof hubEventSchema>;

/** Root-relative with `/`: never absolute, no empty, `.` or `..` segment, no backslash or NUL. */
const rel = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (p) =>
      !/^[a-z]:/i.test(p) &&
      p.split("/").every((s) => s !== "" && s !== "." && s !== ".." && !/[\\\0]/.test(s)),
    "Invalid path",
  );

/**
 * Caps on what a device sends per folder: each doc's text, the cover, each plate preview and each
 * gallery pick (bytes, before base64). The whole request is capped by `deviceFolderMaxMb`.
 */
export const DEVICE_TEXT_MAX = 100_000;
export const DEVICE_COVER_MAX = 2 * 1024 * 1024;
export const DEVICE_PREVIEW_MAX = 1024 * 1024;
export const DEVICE_GALLERY_IMAGE_MAX = 4 * 1024 * 1024;
const base64 = (max: number) => z.base64().max(Math.ceil(max / 3) * 4);
const COVER_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"] as const;

/** A root on this device, as the connector needs it (`GET /api/hub/device/roots`). */
export const deviceRootSchema = z.object({
  id,
  path: z.string(),
  projectDepth: z.number().int(),
  filesDepth: z.number().int().nullable(),
  /** `projectScanMaxFiles`: files listed per folder at most. */
  maxFiles: z.number().int(),
  /** `deviceFolderMaxMb`: the most one folder's request may be. */
  folderMaxMb: z.number().int(),
  /** The cover a project picked, by folder: it is sent as the folder's cover. */
  covers: z.record(z.string(), z.string()),
  /** The gallery a project picked, by folder: its images are sent with the folder. */
  galleries: z.record(z.string(), projectGallerySchema),
});

/**
 * A device root's project folders (`PUT /api/hub/device/roots/:id/index`), each with the digest of
 * its file list; or the root folder itself is missing on the device.
 */
export const deviceIndexSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("ok"),
    folders: z.array(z.object({ rel, digest: z.string().max(128) })),
  }),
  z.object({ state: z.literal("missing") }),
]);
/** The folders the hub doesn't have at that digest: send them. */
export const deviceIndexResultSchema = z.object({ want: z.array(z.string()) });

/** One project folder as the device scanned it (`PUT /api/hub/device/roots/:id/folders`). */
export const deviceFolderSchema = z.object({
  rel,
  digest: z.string().max(128),
  scan: z.object({
    files: z.array(projectFileSchema.extend({ path: rel })),
    models: z.array(projectModelSchema.extend({ file: rel })),
    mainFile: rel.nullable(),
    sourceUrl: z.string().max(2048).nullable(),
    hasModel: z.boolean(),
    unreadable: z.number().int().nonnegative(),
  }),
  /** Each `.md`/`.txt` doc's text by path: a description file linked on the hub reads from here. */
  texts: z.record(rel, z.string().max(DEVICE_TEXT_MAX)),
  cover: z
    .object({
      ext: z.enum(COVER_EXTS),
      data: base64(DEVICE_COVER_MAX),
      /** The picked cover (`covers`) it is, or null: the scan's own pick. */
      file: rel.nullable(),
    })
    .nullable(),
  /** Plate previews of the listed 3MFs (`entry`: the plate's `thumbnail`), so none is pulled. */
  previews: z.array(
    z.object({ file: rel, entry: z.string().min(1).max(1024), data: base64(DEVICE_PREVIEW_MAX) }),
  ),
  /** The gallery's images (`galleries`), so the gallery shows offline too. */
  gallery: z.array(z.object({ file: rel, data: base64(DEVICE_GALLERY_IMAGE_MAX) })),
  /** Gallery images left out: over the caps (or unreadable). */
  galleryLeftOut: z.array(rel),
});
export const deviceFolderQuerySchema = z.object({ rel });

/** The connector's answer to a request event: the result, or the OS error code (ENOENT, ...). */
export const deviceReplySchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({ ok: z.literal(false), code: z.string().max(50) }),
]);

/** `GET /api/hub/device/sync/changes`: the hub roots' files changed after `since` (0 = all). */
export const hubChangesQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(1000),
});
/**
 * One page of changes in `seq` order. `cursor`: send it as `since` next time (it moves even when
 * nothing on the page is for this user); `more`: ask again at once. Only versions and hashes
 * count, never clocks. `access` "read": the user may only download it (sync it read-only).
 */
export const hubChangesSchema = z.object({
  cursor: z.number().int(),
  more: z.boolean(),
  files: z.array(
    z.object({
      rootId: id,
      path: z.string(),
      size: z.number().int(),
      sha256: z.string(),
      version: z.number().int(),
      deleted: z.boolean(),
      access: z.enum(["edit", "read"]),
    }),
  ),
});
/** A file of a hub root; `base`: the version the device's copy started from (0 = a new file). */
export const hubFileQuerySchema = z.object({
  path: rel,
  base: z.coerce.number().int().nonnegative().optional(),
});
/**
 * An upload's outcome: `updated` (now `version`), `unchanged` (the hub has these bytes), or
 * `conflict`: the hub's file changed since `base`, the upload was kept as the copy `path`.
 */
export const hubUploadResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["updated", "unchanged"]), version: z.number().int() }),
  z.object({ status: z.literal("conflict"), version: z.number().int(), path: z.string() }),
]);

export type HubChanges = z.infer<typeof hubChangesSchema>;
export type HubUploadResult = z.infer<typeof hubUploadResultSchema>;
export type DeviceRoot = z.infer<typeof deviceRootSchema>;
export type DeviceIndex = z.infer<typeof deviceIndexSchema>;
export type DeviceFolder = z.infer<typeof deviceFolderSchema>;
export type DeviceReply = z.infer<typeof deviceReplySchema>;
