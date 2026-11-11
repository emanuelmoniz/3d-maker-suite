import { open, readdir, readFile } from "node:fs/promises";
import { join, parse } from "node:path";
import { crc32 } from "node:zlib";

// OrcaSlicer 2.5+ ships its system presets as one binary cache per vendor, `system/<vendor>.opc`
// (ADR-0013, Orca's docs/HLSD/preset-cache.md). The layout, all little-endian:
//   header   magic "ZCRO", u32 version, u64 body size, u32 CRC-32 of the body
//   body     u32 version, vendor name, vendor version
//            option keys, their u16 types, enum value names (index 0 is always empty)
//            vendor profiles, then the process, filament and machine presets
// A string or list is a u64 length, then its items. The format is private and has no promise behind
// it, so anything unexpected is refused: only this version, a whole file and every byte read.
const MAGIC = "ZCRO";
const VERSION = 2;
const HEADER = 20;

const VECTOR = 0x4000;
const FLOAT = 1;
const INT = 2;
const STRING = 3;
const PERCENT = 4;
const FLOAT_OR_PERCENT = 5;
const POINT = 6;
const BOOL = 8;
const ENUM = 9;
const POINTS_GROUPS = 10 + VECTOR;
const INTS_GROUPS = 11 + VECTOR;

// What a nullable option holds for "not set": JSON presets spell it "nil".
const NIL_INT = 2147483647;
const NIL_BOOL = 255;

type Preset = Record<string, unknown>;
export type OpcKind = "process" | "filament" | "machine";
export type OpcPreset = { kind: OpcKind; subPath: string; preset: Preset };
export type OpcVendor = {
  vendor: string;
  version: string;
  name: string;
  models: string[];
  presets: OpcPreset[];
};

const reader = (body: Buffer, start = 0) => {
  let at = start;
  const take = (n: number) => {
    if (n > body.length - at) throw new Error(`past the end at ${at}`);
    at += n;
    return at - n;
  };
  const u8 = () => body.readUInt8(take(1));
  const u16 = () => body.readUInt16LE(take(2));
  const u32 = () => body.readUInt32LE(take(4));
  const i32 = () => body.readInt32LE(take(4));
  const f64 = () => body.readDoubleLE(take(8));
  /** A count from the file allocates nothing until it is shown to fit: every item is a byte or more. */
  const fits = (n: number) => {
    if (n > body.length - at) throw new Error(`count ${n} at ${at}`);
    return n;
  };
  const size = () => {
    const n = body.readBigUInt64LE(take(8));
    if (n > BigInt(body.length)) throw new Error(`size ${n} at ${at}`);
    return fits(Number(n));
  };
  const text = () => {
    const n = size();
    return body.toString("utf8", take(n), at);
  };
  const list = <T>(item: () => T) => Array.from({ length: size() }, item);
  const count = <T>(item: () => T) => Array.from({ length: fits(u32()) }, item);
  return {
    u8,
    u16,
    u32,
    i32,
    f64,
    text,
    list,
    count,
    done: () => at === body.length,
    skip: (n: number) => void take(n),
  };
};

/** The body of a cache, once its header says it is whole. */
function bodyOf(file: Buffer) {
  if (file.length < HEADER || file.toString("latin1", 0, 4) !== MAGIC)
    throw new Error("not a cache");
  if (file.readUInt32LE(4) !== VERSION) throw new Error(`format ${file.readUInt32LE(4)}`);
  if (file.readBigUInt64LE(8) !== BigInt(file.length - HEADER)) throw new Error("cut short");
  const body = file.subarray(HEADER);
  if (crc32(body) !== file.readUInt32LE(16)) throw new Error("checksum");
  return body;
}

/** One cache, each preset's values as a JSON preset spells them, so one reader takes both. */
export function parseOpc(file: Buffer): OpcVendor {
  const r = reader(bodyOf(file));
  if (r.u32() !== VERSION) throw new Error("body format");
  const vendor = r.text();
  const version = r.text();
  const keys = r.list(r.text);
  const types = r.list(r.u16);
  const enums = r.list(r.text);

  const float = (v: number) => (Number.isNaN(v) ? "nil" : String(v));
  const int = (v: number) => (v === NIL_INT ? "nil" : String(v));
  const bool = (v: number) => (v === NIL_BOOL ? "nil" : v ? "1" : "0");
  const percent = () => {
    const v = r.f64();
    return Number.isNaN(v) ? "nil" : `${v}%`;
  };
  const floatOrPercent = () => {
    const v = r.f64();
    return r.u8() ? `${v}%` : float(v);
  };
  const point = () => `${r.f64()}x${r.f64()}`;
  const enumValue = () => {
    const at = r.u16();
    if (at >= enums.length) throw new Error(`enum ${at}`);
    return at === 0 ? int(r.i32()) : (enums[at] as string);
  };
  const value = (type: number): unknown => {
    switch (type) {
      case FLOAT:
        return float(r.f64());
      case FLOAT + VECTOR:
        return r.list(() => float(r.f64()));
      case INT:
        return String(r.i32());
      case INT + VECTOR:
        return r.list(() => int(r.i32()));
      case STRING:
        return r.text();
      case STRING + VECTOR:
        return r.list(r.text);
      case PERCENT:
        return percent();
      case PERCENT + VECTOR:
        return r.list(percent);
      case FLOAT_OR_PERCENT:
        return floatOrPercent();
      case FLOAT_OR_PERCENT + VECTOR:
        return r.list(floatOrPercent);
      case POINT:
        return point();
      case POINT + VECTOR:
        return r.list(point);
      case BOOL:
        return bool(r.u8());
      case BOOL + VECTOR:
        return r.list(() => bool(r.u8()));
      case ENUM:
      case ENUM + VECTOR: {
        const all = r.count(enumValue);
        if (type === ENUM + VECTOR) return all;
        if (all.length !== 1) throw new Error("a scalar enum with several values");
        return all[0];
      }
      case POINTS_GROUPS:
        return r.list(() => r.list(point).join(","));
      case INTS_GROUPS:
        return r.list(() => r.list(() => int(r.i32())).join(","));
      default:
        throw new Error(`option type ${type}`);
    }
  };
  const config = () =>
    Object.fromEntries(
      r.count(() => {
        const at = r.u16();
        const key = keys[at];
        const type = types[at];
        if (key === undefined || type === undefined) throw new Error(`option ${at}`);
        return [key, value(type)];
      }),
    );
  const presets = (kind: OpcKind) =>
    r.count((): OpcPreset => {
      const name = r.text();
      const subPath = r.text();
      const values = config();
      const inherits = r.text();
      const include = r.list(r.text);
      r.text(); // description
      const instantiation = r.text();
      const setting_id = r.text();
      const filament_id = r.text();
      r.list(r.text); // renamed from
      return {
        kind,
        subPath,
        preset: {
          ...values,
          type: kind,
          from: "system",
          name,
          instantiation,
          ...(inherits && { inherits }),
          ...(include.length && { include }),
          ...(setting_id && { setting_id }),
          ...(filament_id && { filament_id }),
        },
      };
    });

  const vendors = r.list(() => {
    const key = r.text();
    const name = r.text();
    r.text(); // id
    r.text(); // version
    r.text(); // update URL
    r.text(); // changelog URL
    const models = r.list(() => {
      r.text(); // id
      const model = r.text();
      r.text(); // model id
      r.u8(); // technology
      r.text(); // family
      r.list(r.text); // variants
      r.list(r.text); // default materials
      r.list(r.text); // bed types it doesn't support
      for (let i = 0; i < 9; i++) r.text(); // bed and hotend files
      return model;
    });
    r.list(r.text); // default filaments
    r.list(r.text); // default SLA materials
    return { key, name, models };
  });
  const all = [...presets("process"), ...presets("filament"), ...presets("machine")];
  r.skip(8); // how many errors the vendor's parse counted
  if (!r.done()) throw new Error("bytes left over");
  const own = vendors.find((v) => v.key === vendor);
  if (!own) throw new Error(`no vendor profile for ${vendor}`);
  return { vendor, version, name: own.name, models: own.models, presets: all };
}

/** The vendor and version stamped at the front of a cache, without reading the rest. */
export function opcStamp(head: Buffer) {
  if (head.length < HEADER || head.toString("latin1", 0, 4) !== MAGIC)
    throw new Error("not a cache");
  if (head.readUInt32LE(4) !== VERSION) throw new Error(`format ${head.readUInt32LE(4)}`);
  const r = reader(head, HEADER);
  r.skip(4);
  return { vendor: r.text(), version: r.text() };
}

// Once per file and problem: this is read on every look at the slicer's presets.
const warned = new Set<string>();
const warnOnce = (file: string, err: unknown) => {
  const message = `${file}: ${err instanceof Error ? err.message : String(err)}`;
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`Can't read this slicer's system presets: ${message}`);
};

/** A folder's caches. A vendor with a JSON index beside its cache is read as JSON (Orca ≤ 2.4). */
const systemOpcFiles = async (root: string) => {
  const names = await readdir(root).catch(() => []);
  const set = new Set(names);
  return names
    .filter((n) => n.endsWith(".opc") && !set.has(`${parse(n).name}.json`))
    .sort()
    .map((n) => join(root, n));
};
const opcFiles = (dir: string) => systemOpcFiles(join(dir, "system"));

/** Every readable cache of a config folder; one that can't be read is left out. */
export async function opcVendors(dir: string) {
  const out: OpcVendor[] = [];
  for (const file of await opcFiles(dir)) {
    try {
      out.push(parseOpc(await readFile(file)));
    } catch (err) {
      warnOnce(file, err);
    }
  }
  return out;
}

/** `<vendor>=<version>` per cache of a `system/` folder, or null when one can't be read: ask again next time. */
export async function opcFingerprints(system: string) {
  const out: string[] = [];
  for (const file of await systemOpcFiles(system)) {
    const handle = await open(file);
    try {
      const head = Buffer.alloc(1024);
      const { bytesRead } = await handle.read(head, 0, head.length, 0);
      const { vendor, version } = opcStamp(head.subarray(0, bytesRead));
      out.push(`${vendor}=${version}`);
    } catch (err) {
      warnOnce(file, err);
      return null;
    } finally {
      await handle.close();
    }
  }
  return out;
}
