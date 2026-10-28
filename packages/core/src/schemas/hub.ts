import { z } from "zod";
import { id, isoDate } from "./entities.ts";

/** A connector paired with the hub (ADR-0014), as Hub management lists it. */
export const deviceSchema = z.object({
  id,
  name: z.string(),
  userId: id,
  userName: z.string(),
  os: z.string().nullable(),
  connectorVersion: z.string().nullable(),
  lastSeenAt: isoDate.nullable(),
  /** Seen within the last minute. */
  online: z.boolean(),
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
export type DeviceRename = z.input<typeof deviceRenameSchema>;
export type PairingCodeCreate = z.input<typeof pairingCodeCreateSchema>;
export type PairingCode = z.infer<typeof pairingCodeSchema>;
export type PairInput = z.input<typeof pairSchema>;
export type PairResult = z.infer<typeof pairResultSchema>;
