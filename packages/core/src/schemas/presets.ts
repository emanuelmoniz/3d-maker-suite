import { z } from "zod";
import {
  catalogInstallSlicerSchema,
  id,
  isoDate,
  presetInstallSlicerSchema,
  presetRef,
} from "./entities.ts";
import { SLICER_PRESET_KINDS } from "./enums.ts";
import { inUseDetailsSchema } from "./list.ts";

// The hub's slicer preset library (ADR-0017): per slicer library (`bambu-studio`, `orca-slicer`)
// and kind, the preset's json as received, its versions and who saved them.

export const slicerPresetKindSchema = z.enum(SLICER_PRESET_KINDS);

/** One key of a preset's file, parents filled in; `from` is the preset it comes from (null: its own). */
export const presetSettingSchema = z.object({
  key: z.string(),
  value: z.string(),
  from: z.string().nullable(),
});

/** Why a preset's file can't be read: no source of its slicer here, or the file is gone from it. */
export const PRESET_UNREADABLE = ["hand_made", "no_source", "not_found"] as const;

/** `GET .../presets/:id/settings` (ADR-0020): every setting of the preset's file. */
export const presetSettingsSchema = z.object({
  /** `unreadable`: `reason` says why, and `settings` is empty. */
  status: z.enum(["ok", "unreadable"]),
  reason: z.enum(PRESET_UNREADABLE).nullable(),
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
export type PresetSettings = z.infer<typeof presetSettingsSchema>;

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

export const presetInstallStatusSchema = z.array(presetInstallSlicerSchema).max(20);

export const catalogInstallStatusSchema = z.array(catalogInstallSlicerSchema).max(20);
export type CatalogInstallSlicer = z.infer<typeof catalogInstallSlicerSchema>;
export type CatalogInstallStatus = z.infer<typeof catalogInstallStatusSchema>;

/** The connector's switches for one slicer library: Send presets (Share) and Install (Receive). */
export const presetSwitchesSchema = z.object({ send: z.boolean(), install: z.boolean() });
export type PresetSwitches = z.infer<typeof presetSwitchesSchema>;

const kinds = z.array(slicerPresetKindSchema).max(SLICER_PRESET_KINDS.length);
/**
 * A machine's switches for one slicer library (ADR-0022, ADR-0023), on Catalog settings → Sources:
 * System (Receive only: the hub's whole `system/`), User presets (Receive every kind, Share the
 * kinds in `shareKinds`). `devices.presetLibraries` keeps them by library, with when a preset was
 * last stored.
 */
export const devicePresetLibrarySchema = z.object({
  system: z.object({ receive: z.boolean() }),
  user: z.object({
    receive: z.boolean(),
    share: z.boolean(),
    shareKinds: kinds,
  }),
  sentAt: isoDate.optional(),
});
export type DevicePresetLibrary = z.infer<typeof devicePresetLibrarySchema>;
/** A library with every switch off, before its first change. */
export const emptyPresetLibrary = (): DevicePresetLibrary => ({
  system: { receive: false },
  user: {
    receive: false,
    share: false,
    shareKinds: [...SLICER_PRESET_KINDS],
  },
});
/** Only the user preset switches, in the connector's shape (unchanged since 5.4.0). */
export const presetSwitches = (m: Record<string, DevicePresetLibrary>) =>
  Object.fromEntries(
    Object.entries(m).map(([lib, { user }]) => [lib, { send: user.share, install: user.receive }]),
  ) as Record<string, PresetSwitches>;

/** One slicer of a device in `GET /api/presets/devices`: the device × slicer table's row. */
export const presetDeviceLibrarySchema = presetSwitchesSchema.extend({
  library: z.string(),
  /** It still reports this slicer; false = a row kept with its values. */
  reported: z.boolean(),
  /** The kinds its Share lines take (Presets settings → Sources). */
  shareKinds: z.array(slicerPresetKindSchema),
  /** When a preset it sent was last stored. */
  sentAt: isoDate.nullable(),
  /** Its removals held for a person (Catalog → Presets). */
  held: z.number().int().nonnegative(),
  /** What it last reported of Install; null = off, or it hasn't yet. */
  status: presetInstallSlicerSchema.nullable(),
});

/** A device with a slicer in `GET /api/presets/devices`, and its switches per slicer. */
export const presetDeviceSchema = z.object({
  id,
  name: z.string(),
  /** Its user: the one who may edit its switches with `machine.catalog` (ADR-0023). */
  userId: z.uuid(),
  online: z.boolean(),
  /** Its connector is older than the hub: its removals are only shown, and it receives no deletes. */
  outdated: z.boolean(),
  /** Its Slicers catalog switches (the machine page): off = not listed that way on Sources. */
  receiveCatalog: z.boolean(),
  shareCatalog: z.boolean(),
  libraries: z.array(presetDeviceLibrarySchema),
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
export type PresetInstallItem = z.infer<typeof presetInstallItemSchema>;
export type PresetSkipped = z.infer<typeof presetSkippedSchema>;
/** What Install keeps: the sha it last settled per folder, kind and name, and the last backup per slicer id. */
export type PresetInstallSaved = {
  installed?: Record<string, string>;
  backups?: Record<string, { path: string; at: string }>;
};
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
