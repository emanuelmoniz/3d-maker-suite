import { matchLoaded, type PrinterStatus } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { isNotNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { loadSpool } from "../lib/spoolLoad.ts";
import { activeSpools, spoolHistory } from "./sourceRows.ts";

// Loaded spools from the printer (Step 19b, ADR-0015): a printer that says what is in each slot
// gets the spool loaded with no click. Run on every live status change (`printerStatus.subscribe`),
// against the database each time: nothing to diff, so a restart or a missed change is fine.
// Per online printer and slot:
// - the spool whose tag the printer read, or the library spool it named: loaded by the printer,
//   moved from any other slot, replacing whatever is there, also a spool you set;
// - a spool you set stays (a material it doesn't match is handled when a print ends);
// - one sure material + colour match among spools not loaded elsewhere, for a slot the printer
//   physically reads (`physicalSlots`): loaded by the printer;
// - several fit: a suggestion, kept here and sent with the live status;
// - a tray that went empty (physical slots only): a spool the printer loaded there is unloaded.
// A tag is still learned when a slot is charged, not here.

const { spools } = schema;

type Suggestion = { slot: number; spoolId: string };
type Slot = PrinterStatus["snapshot"]["slots"][number];

const same = (a?: string | null, b?: string | null) =>
  !a || !b || a.trim().toLowerCase() === b.trim().toLowerCase();
const keyOf = (s: Slot) => `${s.material?.toLowerCase()}|${s.colorHex?.toLowerCase()}`;

/** What a printer reads in a slot: the same reading is the same spool. */
const readingOf = (s: Slot) => [s.material, s.colorHex, s.rfid, s.spoolId].join("|").toLowerCase();

export function createAutoLoad(db: Db, log: FastifyBaseLogger) {
  /** By printer id, as last worked out. */
  let suggested = new Map<string, Suggestion[]>();
  /**
   * Slots you emptied while the printer read a spool there, by `<printerId>:<slot>`: left empty
   * until the printer reads something else in them. Memory only: a restart fills them again.
   */
  const emptied = new Map<string, string>();
  /** The latest statuses seen, for `cleared`. */
  let latest: PrinterStatus[] = [];

  const loadedRows = () =>
    db
      .select({
        id: spools.id,
        printerId: spools.loadedPrinterId,
        slot: spools.loadedSlot,
        by: spools.loadedBy,
      })
      .from(spools)
      .where(isNotNull(spools.loadedPrinterId))
      .all();

  /** Works out every online printer's slots; true when a spool was loaded or a suggestion changed. */
  function watch(all: PrinterStatus[]): boolean {
    latest = all;
    const live = all.filter(
      (s) =>
        !s.pending &&
        !s.failing &&
        s.snapshot.state !== "offline" &&
        (s.snapshot.physicalSlots || s.snapshot.slots.some((r) => r.rfid || r.spoolId)),
    );
    const next = new Map<string, Suggestion[]>();
    let wrote = false;
    if (live.length) {
      const active = activeSpools(db);
      let loaded = loadedRows();
      let history: ReturnType<typeof spoolHistory> | undefined;
      const now = new Date().toISOString();
      const load = (printerId: string, slot: number, spoolId: string | null) => {
        if (!loadSpool(db, printerId, slot, spoolId, "printer")) return;
        log.info(
          { printerId, slot, spoolId },
          spoolId ? "spool loaded by the printer" : "spool unloaded by the printer",
        );
        loaded = loadedRows();
        wrote = true;
      };
      for (const { printerId, snapshot } of live) {
        const physical = !!snapshot.physicalSlots;
        const mine: Suggestion[] = next.get(printerId) ?? [];
        for (const r of snapshot.slots) {
          const here = loaded.find((l) => l.printerId === printerId && l.slot === r.slot);
          const key = `${printerId}:${r.slot}`;
          if (emptied.has(key)) {
            if (!here && emptied.get(key) === readingOf(r)) continue;
            emptied.delete(key);
          }
          const candidates = active.map((s) => ({
            ...s,
            elsewhere: loaded.some(
              (l) => l.id === s.id && (l.printerId !== printerId || l.slot !== r.slot),
            ),
          }));
          const slot = { ...r, physical };
          let m = matchLoaded(slot, candidates, [], now);
          if (m.id && !m.sure && !m.tagged) {
            history ??= spoolHistory(db);
            m = matchLoaded(slot, candidates, history.before(printerId, r.slot, now), now);
          }
          if (m.tagged) {
            if (m.id !== here?.id) load(printerId, r.slot, m.id);
            continue;
          }
          if (here?.by === "user" || !physical) continue;
          const spool = here && active.find((s) => s.id === here.id);
          const fits =
            !!spool &&
            same(spool.material, r.material) &&
            same(spool.colorHex, r.colorHex) &&
            same(spool.rfid, r.rfid);
          if (fits) continue;
          // Two trays of one material + colour are two spools: neither is sure.
          const twin = snapshot.slots.some((o) => o.slot !== r.slot && keyOf(o) === keyOf(r));
          if (m.id && m.sure && !twin) load(printerId, r.slot, m.id);
          else {
            if (here) load(printerId, r.slot, null);
            if (m.id) mine.push({ slot: r.slot, spoolId: m.id });
          }
        }
        if (physical) {
          const trays = new Set(snapshot.slots.map((r) => r.slot));
          // An emptied tray: the next spool in it is a new reading.
          for (const key of emptied.keys())
            if (
              key.startsWith(`${printerId}:`) &&
              !trays.has(Number(key.slice(printerId.length + 1)))
            )
              emptied.delete(key);
          for (const l of [...loaded])
            if (l.printerId === printerId && l.by === "printer" && !trays.has(l.slot ?? -1))
              load(printerId, l.slot ?? 0, null);
        }
        if (mine.length) next.set(printerId, mine);
      }
    }
    const changed = JSON.stringify([...next]) !== JSON.stringify([...suggested]);
    suggested = next;
    return wrote || changed;
  }

  /**
   * You emptied a slot (`PUT /printers/:id/slots` with no spool): what the printer reads there now
   * isn't loaded again, nor suggested, until it reads something else.
   */
  function cleared(printerId: string, slot: number) {
    const r = latest
      .filter((s) => s.printerId === printerId && s.snapshot.state !== "offline")
      .flatMap((s) => s.snapshot.slots)
      .find((s) => s.slot === slot);
    if (r) emptied.set(`${printerId}:${slot}`, readingOf(r));
  }

  /** What a printer's live status carries of its spools: who loaded what, and the suggestions. */
  function annotate() {
    const loaded = loadedRows();
    return (printerId: string): Pick<PrinterStatus, "loaded" | "suggestions"> => {
      const mine = loaded
        .filter((l) => l.printerId === printerId)
        .map((l) => ({ slot: l.slot ?? 0, spoolId: l.id, by: l.by ?? ("user" as const) }))
        .sort((a, b) => a.slot - b.slot);
      const ideas = suggested.get(printerId);
      return {
        ...(mine.length && { loaded: mine }),
        ...(ideas?.length && { suggestions: ideas }),
      };
    };
  }

  return { watch, annotate, cleared };
}

export type AutoLoad = ReturnType<typeof createAutoLoad>;
