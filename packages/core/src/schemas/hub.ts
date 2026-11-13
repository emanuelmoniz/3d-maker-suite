import { z } from "zod";
import { id, isoDate } from "./entities.ts";
import { SLICER_PRESET_KINDS } from "./enums.ts";
import { slicerInstallStatusSchema } from "./integrations.ts";
import {
  devicePresetLibrarySchema,
  presetSwitchesSchema,
  slicerPresetKindSchema,
} from "./presets.ts";
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

/**
 * How a device's sync of the hub roots is doing (`PUT /api/hub/device/sync/state`): `files` synced,
 * `pending` transfers waiting, and per root the local deletes held by the mass delete guard.
 */
export const deviceSyncStateSchema = z.object({
  state: z.enum(["syncing", "idle", "paused", "error"]),
  files: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  held: z.array(z.object({ rootId: id, name: z.string().max(200), files: z.number().int() })),
  error: z.string().max(200).nullable(),
});

/** New machines receive (`hubDefaultSyncMode`): a pick per hub root, or nothing until picked. */
export const DEVICE_SYNC_MODES = ["all", "selected"] as const;
export const deviceSyncModeSchema = z.enum(DEVICE_SYNC_MODES);
/** A pick's level for the machine's user (ADR-0021); the user's own rights still cap it. */
export const PICK_LEVELS = ["read", "edit"] as const;
export const pickLevelSchema = z.enum(PICK_LEVELS);

/**
 * How a connector finds an adapter's desktop slicer (ADR-0014): the Windows `Uninstall` key's exact
 * `DisplayName`, the macOS app in `/Applications`, the Linux Flatpak id. `id`: the adapter's.
 */
export const desktopSlicerSchema = z.object({
  id: z.string(),
  windowsName: z.string(),
  macApp: z.string(),
  flatpak: z.string(),
  /** The hub's preset library it shares into (ADR-0017). */
  library: z.string(),
  /** Its config folder's name, which also names its `.conf` there. */
  config: z.string(),
  /** Its process, to write presets only while it's closed; `-`, `_` and case don't count (`BambuStudio`). */
  process: z.string(),
  /** How it indents a preset's json, so a file's bytes survive a cloud round trip (ADR-0017). */
  presetIndent: z.string(),
  /** Its cloud also takes an edit written to disk; false = the edit stays on that PC (ADR-0017). */
  uploadsDiskEdits: z.boolean(),
  /** Seconds an `update`'s `updated_time` leads real time, to look newer than its cloud's copy. */
  cloudClockLeadS: z.number().int().nonnegative(),
  /**
   * Its cloud deletes a preset whose `.info` says `sync_info = delete` with no `.json` (ADR-0019).
   * False = a delete in a signed-in account folder needs a person in the slicer.
   */
  tombstones: z.boolean(),
});
/** A slicer the connector found (`PUT /api/hub/device/slicers`); `id` as in `desktopSlicerSchema`. */
export const deviceSlicerSchema = z.object({
  id: z.string().max(100),
  version: z.string().max(100).nullable(),
  path: z.string().max(4096),
});

/** `SlicerSystem`: picks a managed slicer's build. */
export const slicerSystemSchema = z.object({
  platform: z.string().max(20),
  arch: z.string().max(20),
  glibc: z.string().max(20).optional(),
});
/** A managed slicer for a worker: the release asset, its version and the program inside it. */
export const slicerInstallTargetSchema = z.object({
  version: z.string().max(100),
  exe: z.string().max(1024),
  asset: z.object({
    name: z.string().max(500),
    size: z.number().int().nonnegative(),
    digest: z.string().max(200),
    url: z.url().max(2048),
  }),
});
/** A slicer that passed `--help` on the device: the path it runs from and its version, if known. */
export const deviceSlicerCheckSchema = z.object({
  path: z.string().max(4096),
  version: z.string().max(100).nullable(),
});
/** A worker's managed install (`PUT /api/hub/device/slicers/install`); `result` once it's done. */
export const deviceSlicerInstallSchema = z.object({
  integrationId: id,
  status: slicerInstallStatusSchema,
  result: deviceSlicerCheckSchema.optional(),
});

const devicePath = z.string().trim().min(1).max(4096);
/**
 * A folder of a machine shared with the hub (ADR-0021), in the machine's own path form. Paused: kept
 * in the list, but the connector treats it as not shared.
 */
export const sharedFolderSchema = z.object({ path: devicePath, paused: z.boolean() });
export type SharedFolder = z.infer<typeof sharedFolderSchema>;

/** A folder inside a hub root, `/`-separated; `""` = the whole root. */
const pickPath = z
  .string()
  .max(4096)
  .refine(
    (p) => p === "" || p.split("/").every((s) => s && s !== "." && s !== ".." && !s.includes("\\")),
    { message: "A folder inside the root, with / between names" },
  );
/**
 * A machine receives this folder of the hub (ADR-0021) at `level`: Read keeps its files read-only
 * there, Edit sends its saves back. Whoever the machine's user is, their own rights still cap it.
 */
export const pickSchema = z.object({
  id,
  rootId: id,
  rootName: z.string(),
  path: z.string(),
  level: pickLevelSchema,
  paused: z.boolean(),
});
/** `POST /api/hub/devices/:id/picks`. */
export const pickCreateSchema = z.strictObject({
  rootId: id,
  path: pickPath,
  level: pickLevelSchema,
});
/** `PATCH /api/hub/devices/:id/picks/:pickId`: pause it, or change its level. */
export const pickUpdateSchema = z.strictObject({
  paused: z.boolean().optional(),
  level: pickLevelSchema.optional(),
});
export type Pick = z.infer<typeof pickSchema>;
export type PickLevel = z.infer<typeof pickLevelSchema>;
export type PickCreate = z.infer<typeof pickCreateSchema>;
export type PickUpdate = z.infer<typeof pickUpdateSchema>;

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
  /** Its local page's port, for the `/api/whoami` probe; null = offline or not reported. */
  port: z.number().int().nullable(),
  /** Its connector version isn't the hub's. */
  outdated: z.boolean(),
  /** What it reported last time its stream opened; null = no failed update. */
  updateFailed: connectorUpdateFailureSchema.nullable(),
  /** What it reported last about its sync, and when (the hub's clock). */
  sync: deviceSyncStateSchema.extend({ reportedAt: isoDate }).nullable(),
  /** The hub folders it receives (ADR-0021). */
  picks: z.array(pickSchema),
  /** The slicers its connector found; none = it can't open files. */
  slicers: z.array(deviceSlicerSchema),
  /** A worker integration slices on it (ADR-0014): set by adding and removing those. */
  sliceWorker: z.boolean(),
  /** Per slicer library, its machine page's switches (ADR-0021). */
  presets: z.record(z.string(), devicePresetLibrarySchema),
  /** Per slicer library: whether its install there is the hub's slicer (ADR-0022). */
  libraries: z.record(z.string(), z.object({ hubSlicer: z.boolean() })),
  /** Receive projects from the hub, and Share its folders (ADR-0021). */
  receiveProjects: z.boolean(),
  shareProjects: z.boolean(),
  /** Its shared folders (ADR-0021); null until its connector reported its own list once. */
  sharedFolders: z.array(sharedFolderSchema).nullable(),
  createdAt: isoDate,
});

/** Add or remove one of a machine's shared folders (`/api/hub/devices/:id/folders`). */
export const sharedFolderPathSchema = z.object({ path: devicePath });

const name = z.string().trim().min(1).max(100);

export const deviceUpdateSchema = z
  .object({
    name,
    receiveProjects: z.boolean(),
    shareProjects: z.boolean(),
  })
  .partial()
  .strict();
const presetKinds = z
  .array(slicerPresetKindSchema)
  .max(SLICER_PRESET_KINDS.length)
  .transform((k) => [...new Set(k)]);
/**
 * A machine's switches for one slicer library (`PATCH /api/hub/devices/:id/slicers/:library`), set
 * on Catalog settings → Sources (ADR-0023).
 */
export const deviceLibraryUpdateSchema = z.strictObject({
  system: z.strictObject({ receive: z.boolean() }).optional(),
  user: z
    .strictObject({
      receive: z.boolean(),
      share: z.boolean(),
      // A line per kind in Presets settings → Sources; the hub filters, the connector doesn't know.
      shareKinds: presetKinds,
    })
    .partial()
    .optional(),
});
export type DeviceLibraryUpdate = z.infer<typeof deviceLibraryUpdateSchema>;
/** One of the user's online devices, for a project's Open and Open folder. */
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

/** A code to change a device's user, as the connector checks it (`.../device/user/check`): not used up. */
export const deviceUserCheckSchema = z.object({ code: z.string().max(20) });
export const deviceUserPreviewSchema = z.object({
  userName: z.string(),
  currentUserName: z.string(),
  /** How many projects are in this device's folders. */
  projects: z.number().int(),
});
/** The change (`.../device/user`): those projects go to the new user, or stay with their owner. */
export const deviceUserChangeSchema = deviceUserCheckSchema.extend({
  projects: z.enum(["move", "stay"]),
});
export const deviceUserResultSchema = z.object({ userName: z.string(), moved: z.number().int() });

export type Device = z.infer<typeof deviceSchema>;
export type ConnectorUpdateFailure = z.infer<typeof connectorUpdateFailureSchema>;
export type DeviceUpdate = z.input<typeof deviceUpdateSchema>;
export type DeviceSyncMode = z.infer<typeof deviceSyncModeSchema>;
export type DesktopSlicer = z.infer<typeof desktopSlicerSchema>;
export type DeviceSlicer = z.infer<typeof deviceSlicerSchema>;
export type SlicerInstallTarget = z.infer<typeof slicerInstallTargetSchema>;
export type DeviceSlicerCheck = z.infer<typeof deviceSlicerCheckSchema>;
export type DeviceSlicerInstall = z.infer<typeof deviceSlicerInstallSchema>;
export type PairingCodeCreate = z.input<typeof pairingCodeCreateSchema>;
export type PairingCode = z.infer<typeof pairingCodeSchema>;
export type PairInput = z.input<typeof pairSchema>;
export type PairResult = z.infer<typeof pairResultSchema>;
export type DeviceUserPreview = z.infer<typeof deviceUserPreviewSchema>;
export type DeviceUserChange = z.infer<typeof deviceUserChangeSchema>;
export type DeviceUserResult = z.infer<typeof deviceUserResultSchema>;

/** A file in a slice's work folder: a plain name, never a path or a dot file. */
export const sliceFileName = z.string().regex(/^[\w-][\w.-]{0,99}$/);

/** What the machine page changes on a connector, live. */
const connectorSettingsPatch = {
  port: z.number().int().min(1024).max(65535).optional(),
  autostart: z.boolean().optional(),
};
export const connectorSettingsPatchSchema = z.strictObject(connectorSettingsPatch);
/** A connector's settings, read live from it (`PUT`'s port is the one in use until a restart). */
export const connectorSettingsSchema = z.object({
  port: z.number().int(),
  autostart: z.boolean(),
});
export const connectorSettingsResultSchema = connectorSettingsSchema.extend({
  /** The saved port differs from the one in use: a restart applies it. */
  restartRequired: z.boolean(),
});
export type ConnectorSettingsPatch = z.infer<typeof connectorSettingsPatchSchema>;
export type ConnectorSettings = z.infer<typeof connectorSettingsSchema>;
export type ConnectorSettingsResult = z.infer<typeof connectorSettingsResultSchema>;

/** A device's catalog sources (`catalog.sources`, `X-Catalog-Sources`): library → hub copy's fingerprint. */
export const catalogSourcesSchema = z.record(
  z.string().max(100),
  z.string().max(10_000).nullable(),
);
export type CatalogSources = z.infer<typeof catalogSourcesSchema>;
/**
 * Per library, the `system/` folder to send when it isn't the found slicer's: a managed install's
 * `resources/profiles` (5.5.0 Step 11c). A connect has it in `X-Catalog-Dirs`.
 */
export const catalogDirsSchema = z.record(z.string().max(100), z.string().max(4096));
export type CatalogDirs = z.infer<typeof catalogDirsSchema>;

/**
 * Hub → device events on `GET /api/hub/events` (ADR-0014): SSE frames `id: <seq>`, `event: <type>`,
 * `data: <json>`. The connector sends its last id as `Last-Event-ID`; that acks everything up to it.
 * A request (`requestId`) goes only to an open stream and has no id: it is never replayed. The
 * connector answers it on `POST /api/hub/device/replies/:requestId`.
 */
export const hubEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("device.renamed"), name }),
  /** Live only: the name of the user it acts as changed (a reconnect has it in `X-Device-User`). */
  z.object({ type: z.literal("device.user"), name: z.string() }),
  /** Update now (an admin): download the hub's version at once, even one that rolled back. */
  z.object({ type: z.literal("connector.update") }),
  /** Its roots were added, changed or removed, or a scan was asked for: read them, sync them all. */
  z.object({ type: z.literal("roots.changed") }),
  /** Live only: files of the hub roots changed; ask for the changes since the cursor. */
  z.object({ type: z.literal("sync.changed") }),
  /** One level of the folder browser (`listFolder`); `path` null = where browsing starts. */
  z.object({ type: z.literal("fs.list"), requestId: id, path: z.string().max(4096).nullable() }),
  /**
   * Send a file of a device root: `PUT /api/hub/device/files/:requestId` with the bytes and its
   * `X-File-Sha256` and `X-File-Mtime`, or an error answer. `version`: a kept earlier version of
   * it (from the connector's data folder) instead.
   */
  z.object({
    type: z.literal("fs.upload"),
    requestId: id,
    rootId: id,
    rel: z.string().max(1024),
    version: z.number().int().positive().optional(),
  }),
  /**
   * Live only: write a web upload into a device root. The connector gets the bytes from
   * `GET /api/hub/device/files/:requestId` and checks `sha256`. The file there differs from
   * `base` (null: the page listed no file there): the upload is kept as a conflict copy named
   * after `by`. Else the old file is kept as a version in its data folder (`keep` newest, 0 = none)
   * and replaced. The answer's result is a `deviceWriteResultSchema`.
   */
  z.object({
    type: z.literal("fs.write"),
    requestId: id,
    rootId: id,
    rel: z.string().max(1024),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    base: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    by: z.string().max(200),
    keep: z.number().int().min(0).max(100),
  }),
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
  /**
   * Slice workers: does a slicer run here with `--help`? `slicer` a found one (its id), or `path`
   * one the admin typed (an AppImage, ...). The answer's result is a `deviceSlicerCheckSchema`.
   */
  z.object({
    type: z.literal("slicer.check"),
    requestId: id,
    slicer: z.string().max(100).optional(),
    path: z.string().max(4096).optional(),
  }),
  /**
   * Install a managed slicer for the worker integration `integrationId`; answered (null) at once,
   * then reported on `PUT /api/hub/device/slicers/install`.
   */
  z.object({
    type: z.literal("slicer.install"),
    requestId: id,
    integrationId: id,
    target: slicerInstallTargetSchema,
  }),
  /** Delete the managed slicer of `integrationId`; the answer is null. */
  z.object({ type: z.literal("slicer.remove"), requestId: id, integrationId: id }),
  /** An admin made this device a slice worker, or no longer one (its status page shows it). */
  z.object({ type: z.literal("device.worker"), on: z.boolean() }),
  /**
   * Send presets or Install changed for a slicer (ADR-0020): every library's switches; the answer
   * is null. A connector before 5.4.0 Step 21's knows only one pair and answers ENOTSUP.
   */
  z.object({
    type: z.literal("presets.set"),
    requestId: id,
    libraries: z.record(z.string().max(100), presetSwitchesSchema),
  }),
  /**
   * The libraries this device is the catalog source of (ADR-0020), each with the fingerprint of
   * the hub's copy of its `system/` (null = none yet); the answer is null.
   */
  z.object({
    type: z.literal("catalog.sources"),
    requestId: id,
    libraries: catalogSourcesSchema,
    dirs: catalogDirsSchema.optional(),
  }),
  /**
   * The libraries this device receives the catalog of (Receive catalog, ADR-0021), each with the
   * fingerprint of the hub's copy (null = none yet); the answer is null. Live, so a connector
   * before 5.5.0 Step 11's answers ENOTSUP; a connect has it in `X-Catalog-Install`.
   */
  z.object({
    type: z.literal("catalog.install"),
    requestId: id,
    libraries: catalogSourcesSchema,
  }),
  /** Edit connector: read its settings; the answer's result is a `connectorSettingsSchema`. */
  z.object({ type: z.literal("connector.settings.get"), requestId: id }),
  /**
   * Edit connector: change them; the answer's result is a `connectorSettingsResultSchema`. The
   * port is saved and used after the next restart; start at login applies at once.
   */
  z.object({
    type: z.literal("connector.settings.set"),
    requestId: id,
    ...connectorSettingsPatch,
  }),
  /** Restart connector: answered (null) first, then the connector exits for its launcher. */
  z.object({ type: z.literal("connector.restart"), requestId: id }),
  /** Stop connector: answered (null) first, then it exits; it starts again at login or by hand. */
  z.object({ type: z.literal("connector.stop"), requestId: id }),
  /**
   * Share to the hub (ADR-0021) on or off; the answer is null. Off, it shares none of its folders
   * (every root "unshared") and keeps the list. A connect has it in `X-Share-Projects`.
   */
  z.object({ type: z.literal("projects.share"), requestId: id, on: z.boolean() }),
  /**
   * The machine's shared folders as the hub keeps them (ADR-0021), queued: the connector saves the
   * list and refuses every file operation outside its unpaused folders.
   */
  z.object({ type: z.literal("folders.set"), folders: z.array(sharedFolderSchema).max(200) }),
  /**
   * Slice workers: run `program` (the worker's `slicerPath`) with `args` in a work folder of the
   * data folder, after writing `files` there; `{dir}` in the args is that folder. The 3MF goes
   * last: a copy here with its `sha256`, else `GET /api/hub/device/slices/:requestId/file`. Each
   * file the run adds goes to `PUT .../slices/:requestId/files/:name`, then the answer: `{ code }`,
   * the exit code (null = killed or crashed).
   */
  z.object({
    type: z.literal("slice"),
    requestId: id,
    program: z.string().max(4096),
    args: z.array(z.string().max(16_384)).max(50),
    files: z.record(sliceFileName, z.string().max(4 * 1024 * 1024)),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
]);
/** What a slice worker's run reports (`slice`). */
export const deviceSliceSchema = z.object({ code: z.number().int().nullable() });
/**
 * What the connector reports when it opens the stream (`X-Connector-Version`, `X-Connector-OS`,
 * `X-Connector-System` as JSON: which managed slicer build fits it).
 */
export const connectorInfoSchema = pairSchema
  .pick({ connectorVersion: true, os: true })
  .extend({ system: slicerSystemSchema.optional() });

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
  /** Projects in it: the connector keeps a shared folder holding it while there are any. */
  projects: z.number().int(),
});

/**
 * A device root's project folders (`PUT /api/hub/device/roots/:id/index`), each with the digest of
 * its file list; or the root folder itself is missing on the device; or it isn't in the device's
 * shared folders (the hub keeps its last known folders).
 */
export const deviceIndexSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("ok"),
    folders: z.array(z.object({ rel, digest: z.string().max(128) })),
  }),
  z.object({ state: z.literal("missing") }),
  z.object({ state: z.literal("unshared") }),
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
      /** Read by connectors older than 5.6.0 only: always null, locks are gone. */
      lock: z.null().optional(),
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
/** `fs.write`'s answer: `path` is the file written, the conflict copy for a conflict. */
export const deviceWriteResultSchema = z.object({
  status: z.enum(["updated", "conflict"]),
  path: z.string(),
});

/**
 * `GET /api/hub/device/sync/roots`: the hub roots, the mass delete guard's threshold. `picked`: a
 * pick of the machine covers some of it, so its folder is made (the feed holds only picked files).
 */
export const hubSyncRootsSchema = z.object({
  roots: z.array(z.object({ id, name: z.string(), picked: z.boolean().optional() })),
  deleteGuard: z.number().int(),
  /** Read by connectors older than 5.5.0 only. */
  mode: deviceSyncModeSchema.optional(),
  /** Read by connectors older than 5.6.0 only: always "off", locks are gone. */
  locks: z.literal("off").optional(),
});
/**
 * `GET /api/projects/:id/saved`: who saved each file last, information only. A hub root: the
 * last save that reached the hub (`device` null for a web upload); a device root: its user and
 * device, at the file's time in the last scan. Files with nothing known are left out.
 */
export const hubFileSavedSchema = z.object({
  /** Relative to the project folder, like `meta.files`. */
  file: z.string(),
  user: z.string(),
  device: z.string().nullable(),
  savedAt: isoDate,
});
/** `GET /api/projects/:id/versions`: a file's kept earlier versions, newest first. */
export const hubFileVersionSchema = z.object({
  version: z.number().int(),
  /** Null when the change was made on the hub itself. */
  user: z.string().nullable(),
  device: z.string().nullable(),
  savedAt: isoDate,
  size: z.number().int(),
});
export const hubFileVersionQuerySchema = z.object({
  file: z.string().min(1),
  version: z.coerce.number().int().positive().optional(),
});
/** `GET /api/hub/versions`: disk used by the kept versions. */
export const hubVersionsUsageSchema = z.object({ files: z.number().int(), bytes: z.number() });

export type HubChanges = z.infer<typeof hubChangesSchema>;
export type HubSyncRoots = z.infer<typeof hubSyncRootsSchema>;
export type HubFileVersion = z.infer<typeof hubFileVersionSchema>;
export type HubFileSaved = z.infer<typeof hubFileSavedSchema>;
export type HubVersionsUsage = z.infer<typeof hubVersionsUsageSchema>;
export type DeviceSyncState = z.infer<typeof deviceSyncStateSchema>;
export type HubUploadResult = z.infer<typeof hubUploadResultSchema>;
export type DeviceWriteResult = z.infer<typeof deviceWriteResultSchema>;
export type DeviceRoot = z.infer<typeof deviceRootSchema>;
export type DeviceIndex = z.infer<typeof deviceIndexSchema>;
export type DeviceFolder = z.infer<typeof deviceFolderSchema>;
export type DeviceReply = z.infer<typeof deviceReplySchema>;
export type DeviceSlice = z.infer<typeof deviceSliceSchema>;
