import { z } from "zod";
import { id, isoDate } from "./entities.ts";
import { inUseDetailsSchema } from "./list.ts";

// The hub's slicer preset library (ADR-0017): per slicer library (`bambu-studio`, `orca-slicer`)
// and kind, the preset's json as received, its versions and who saved them.

export const SLICER_PRESET_KINDS = ["machine", "process", "filament"] as const;
export const slicerPresetKindSchema = z.enum(SLICER_PRESET_KINDS);

/** One key of a profile's file, parents filled in; `from` is the preset it comes from (null: its own). */
export const presetSettingSchema = z.object({
  key: z.string(),
  value: z.string(),
  from: z.string().nullable(),
});

/** Why a profile's file can't be read: no source of its slicer here, or the file is gone from it. */
export const PROFILE_UNREADABLE = ["hand_made", "no_source", "not_found"] as const;

/** `GET .../profiles/:id/settings` (ADR-0020): every setting of the profile's file. */
export const profileSettingsSchema = z.object({
  /** `unreadable`: `reason` says why, and `settings` is empty. */
  status: z.enum(["ok", "unreadable"]),
  reason: z.enum(PROFILE_UNREADABLE).nullable(),
  /** `<library>:<scope>/<name>` as the row keeps it; null for a hand-made one. */
  source: z.string().nullable(),
  /** The `inherits` chain, nearest first. */
  parents: z.array(z.string()),
  /** The parent the chain stops at because its file can't be read; its values are missing. */
  missing: z.string().nullable(),
  settings: z.array(presetSettingSchema),
  /** Changes in this slicer's files wait for a person's review: where, and how many rows. */
  waiting: z.object({ integrationId: id, type: z.string(), count: z.number().int() }).nullable(),
});
export type PresetSetting = z.infer<typeof presetSettingSchema>;
export type ProfileSettings = z.infer<typeof profileSettingsSchema>;

/** A conflict copy's name, as hub files are named (`<name> (conflict <who> <when>)`). */
export const isPresetConflict = (name: string) => / \(conflict .+\)$/.test(name);

const saved = {
  /** Who saved it and from which device (names as they were); null = on the hub, or unknown. */
  savedUser: z.string().nullable(),
  savedDevice: z.string().nullable(),
  savedAt: isoDate,
};

/**
 * Why an owner's removal waits for a person (ADR-0019): more at once than `hubDeleteGuard`, or a
 * device of another user on the same slicer account.
 */
export const PRESET_HOLD_REASONS = ["mass", "shared"] as const;

/** A preset in `GET /api/presets` (live) or `GET /api/presets/deleted`, without its json. */
export const slicerPresetSchema = z.object({
  id,
  library: z.string(),
  kind: slicerPresetKindSchema,
  name: z.string(),
  /** Its `inherits` parent (a system preset, usually); null = stands on its own. */
  inherits: z.string().nullable(),
  version: z.number().int(),
  sha256: z.string(),
  conflict: z.boolean(),
  /** Who first shared it (their name now); null = nobody known, only `catalog` write deletes it. */
  owner: z.string().nullable(),
  /** The devices that deleted their copy (their names now). */
  removedOn: z.array(z.string()),
  /** A removal waiting for a person: the device (its name now) and why. */
  held: z
    .object({ deviceId: id, device: z.string(), reason: z.enum(PRESET_HOLD_REASONS) })
    .nullable(),
  /** What keeps a removed preset (`removedOn`) alive; empty for the others. */
  usedBy: inUseDetailsSchema.shape.dependents,
  ...saved,
});

export const slicerPresetVersionSchema = z.object({
  version: z.number().int(),
  sha256: z.string(),
  ...saved,
});

/** `GET /api/presets/:id`: the preset and its earlier versions, newest first. */
export const slicerPresetDetailSchema = slicerPresetSchema.extend({
  versions: z.array(slicerPresetVersionSchema),
});

const presetRef = {
  library: z.string().max(100),
  kind: slicerPresetKindSchema,
  /** The file's name, for a preset without a `name` inside. */
  name: z.string().min(1).max(255),
};

/** How many queued names a connector reports; `queued` still counts them all. */
export const PRESET_QUEUE_SHOWN = 100;

/** Install hub presets on one slicer of a device (`PUT /api/hub/device/presets/install`). */
export const presetInstallSlicerSchema = z.object({
  library: z.string().max(100),
  /** The user preset folder it writes to. */
  folder: z.string().max(4096),
  /** The slicer is open: the queue waits until it closes. */
  waiting: z.boolean(),
  queued: z.number().int().nonnegative(),
  queue: z.array(z.object(presetRef)).max(PRESET_QUEUE_SHOWN),
  /** The zip made before the last writes. */
  backup: z.object({ path: z.string().max(4096), at: isoDate }).nullable(),
  /** An account folder of a slicer whose cloud doesn't take edits written to disk. */
  editsStayLocal: z.boolean(),
  /** Deleted on the hub, still here: this slicer's account can only delete them in the slicer. */
  deleteHere: z.array(z.object(presetRef)).max(PRESET_QUEUE_SHOWN).default([]),
});
export const presetInstallStatusSchema = z.array(presetInstallSlicerSchema).max(20);

/** A device with a slicer in `GET /api/presets/devices`, and its switches. */
export const presetDeviceSchema = z.object({
  id,
  name: z.string(),
  online: z.boolean(),
  sharePresets: z.boolean(),
  installPresets: z.boolean(),
  /** Its connector is older than the hub: its removals are only shown, and it receives no deletes. */
  outdated: z.boolean(),
  /** What it last reported; null = Install hub presets is off, or it hasn't yet. */
  presetInstall: presetInstallStatusSchema.nullable(),
});
export const presetDeviceUpdateSchema = z.strictObject({
  sharePresets: z.boolean().optional(),
  installPresets: z.boolean().optional(),
});

/**
 * A hub preset a device installs (`GET /api/hub/device/presets`), or one deleted on the hub
 * (`.../presets/deleted`), without its json.
 */
export const presetInstallItemSchema = z.object({
  id,
  library: z.string(),
  kind: slicerPresetKindSchema,
  name: z.string(),
  version: z.number().int(),
  sha256: z.string(),
  /** This device deleted it and the hub acts on that: a missing file isn't written back. */
  removedHere: z.boolean().default(false),
});
/** A preset that wasn't installed: its `inherits` parent isn't on that device. */
export const presetSkippedSchema = z.object({ ...presetRef, sha256: z.string().max(64) });

/**
 * A connector's changed preset (`PUT /api/hub/device/presets`). `text` is the file as it is, since
 * json that doesn't parse is the hub's to report. `base`: the version it started from, 0 = none.
 */
export const presetUploadSchema = z.object({
  ...presetRef,
  base: z.number().int().nonnegative(),
  text: z.string().max(4 * 1024 * 1024),
});
/** The name the hub knows it by, and the hub's version (a conflict leaves that one as it was). */
export const presetUploadResultSchema = z.object({
  result: z.enum(["saved", "same", "conflict", "invalid"]),
  name: z.string(),
  version: z.number().int(),
});
/** A connector's preset file is gone (`POST /api/hub/device/presets/removed`, before 5.4.0). */
export const presetRemovedSchema = z.object(presetRef);

/** The slicer account folder (`default` = signed out) a device shares from, per library. */
const account = z.string().min(1).max(255);

/**
 * The preset files one look of a connector found gone in one slicer's account folder
 * (`POST /api/hub/device/presets/removals`): counted together for the mass delete limit.
 */
export const presetRemovalsSchema = z.object({
  library: presetRef.library,
  account,
  removed: z
    .array(z.object({ kind: presetRef.kind, name: presetRef.name }))
    .min(1)
    .max(10_000),
});
/**
 * Per preset: deleted on the hub, kept while something uses it, held for a person, kept because
 * it isn't the device's user's (Install writes it back), or not on the hub.
 */
export const PRESET_REMOVAL_RESULTS = ["deleted", "in_use", "held", "kept", "unknown"] as const;
export const presetRemovalResultSchema = z.array(
  z.object({
    kind: slicerPresetKindSchema,
    name: z.string(),
    result: z.enum(PRESET_REMOVAL_RESULTS),
  }),
);
/** The account folder each shared slicer uses (`PUT /api/hub/device/presets/share`). */
export const presetShareStatusSchema = z
  .array(z.object({ library: presetRef.library, account }))
  .max(20);

/** `POST /api/presets/:id/restore`: the deleted preset's last content, or an earlier version. */
export const presetRestoreSchema = z.strictObject({ version: z.number().int().optional() });
/** `POST /api/presets/devices/:id/held`: a device's held removals go ahead, or the preset stays. */
export const presetHeldActionSchema = z.strictObject({ action: z.enum(["delete", "keep"]) });

export type PresetDevice = z.infer<typeof presetDeviceSchema>;
export type PresetDeviceUpdate = z.infer<typeof presetDeviceUpdateSchema>;
export type PresetInstallItem = z.infer<typeof presetInstallItemSchema>;
export type PresetSkipped = z.infer<typeof presetSkippedSchema>;
export type PresetInstallSlicer = z.infer<typeof presetInstallSlicerSchema>;
export type PresetInstallStatus = z.infer<typeof presetInstallStatusSchema>;
export type PresetUpload = z.infer<typeof presetUploadSchema>;
export type PresetUploadResult = z.infer<typeof presetUploadResultSchema>;
export type PresetRemoved = z.infer<typeof presetRemovedSchema>;
export type PresetRemovals = z.infer<typeof presetRemovalsSchema>;
export type PresetRemovalResult = z.infer<typeof presetRemovalResultSchema>;
export type PresetShareStatus = z.infer<typeof presetShareStatusSchema>;
export type PresetHoldReason = (typeof PRESET_HOLD_REASONS)[number];
export type SlicerPresetKind = z.infer<typeof slicerPresetKindSchema>;
export type SlicerPreset = z.infer<typeof slicerPresetSchema>;
export type SlicerPresetVersion = z.infer<typeof slicerPresetVersionSchema>;
export type SlicerPresetDetail = z.infer<typeof slicerPresetDetailSchema>;
