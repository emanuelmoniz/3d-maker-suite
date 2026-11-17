import { PRINT_MAX_SLOTS, type PrinterStatus } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { Section } from "../../components/Section.tsx";
import { useCan } from "../../lib/auth.ts";
import { textLink } from "../../lib/cx.ts";
import { spoolName, useLoadSpool, useSpools } from "../../lib/filament.ts";
import { formatWeight } from "../../lib/format.ts";
import { slotName } from "../../lib/printerStatus.ts";

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * The spool in each slot (ADR-0015): a new print on a slot charges it. The slots the printer
 * reports, those with a spool, and at least one; slots of a unit up to the last of them. A printer
 * that reads its slots loads its spools itself (Step 19b), or suggests one where several fit.
 */
export function LoadedSpools({ printerId, live }: { printerId: string; live?: PrinterStatus }) {
  const { t } = useTranslation();
  const can = useCan("printers", "manage");
  const load = useLoadSpool(printerId);
  const spools = (useSpools().data?.items ?? []).filter(
    (s) => !s.archivedAt && s.status !== "empty",
  );
  const reported = live?.snapshot.slots ?? [];
  const suggestions = live?.suggestions ?? [];
  const [more, setMore] = useState(0);
  const used = [...reported.map((s) => s.slot)];
  for (const s of spools) if (s.loadedPrinterId === printerId) used.push(s.loadedSlot ?? 0);
  // A unit's slots are counted from 0; one of its own (128 and up, the back spool) stands alone.
  const unit = used.filter((s) => s < PRINT_MAX_SLOTS);
  // A printer with only a spool of its own (an A1 without an AMS) shows only that one.
  const first = unit.length ? Math.max(...unit) + 1 : used.length ? 0 : 1;
  const count = Math.min(first + more, PRINT_MAX_SLOTS);
  const slots = [
    ...Array.from({ length: count }, (_, i) => i),
    ...[...new Set(used.filter((s) => s >= PRINT_MAX_SLOTS))].sort((a, b) => a - b),
  ];

  return (
    <Section
      title={t("printers:loaded.title")}
      action={
        can &&
        count < PRINT_MAX_SLOTS && (
          <Button variant="ghost" onClick={() => setMore((n) => n + 1)}>
            <Plus className="size-4" aria-hidden />
            {t("printers:loaded.addSlot")}
          </Button>
        )
      }
    >
      <p className="mb-3 text-muted">{t("printers:loaded.description")}</p>
      {load.isError && (
        <p role="alert" className="mb-3 text-bad">
          {t("printers:loaded.error")}
        </p>
      )}
      <ul className="grid gap-3">
        {slots.map((slot) => {
          const r = reported.find((s) => s.slot === slot);
          const spool = spools.find(
            (s) => s.loadedPrinterId === printerId && s.loadedSlot === slot,
          );
          const idea = spool
            ? undefined
            : spools.find((s) => s.id === suggestions.find((x) => x.slot === slot)?.spoolId);
          const label = slotName(t, slot);
          // The material the printer reports for the slot first.
          const options = [...spools].sort(
            (a, b) => Number(same(b.material, r?.material)) - Number(same(a.material, r?.material)),
          );
          return (
            <li key={slot} className="grid items-center gap-2 sm:grid-cols-[7rem_10rem_1fr_auto]">
              <span className="font-medium">{label}</span>
              <span className="flex items-center gap-1.5 text-muted">
                {r?.colorHex && (
                  <span
                    aria-hidden
                    className="size-3 rounded-full border border-border"
                    style={{ backgroundColor: r.colorHex }}
                  />
                )}
                {r?.material ?? (r ? t("printers:status.unknownMaterial") : "")}
              </span>
              <div className="grid gap-1">
                {can ? (
                  <Combobox
                    aria-label={t("printers:loaded.pick", { slot: label })}
                    value={spool?.id ?? ""}
                    disabled={load.isPending}
                    onChange={(v) => load.mutate({ slot, spoolId: v || null })}
                    options={[
                      { value: "", label: t("printers:loaded.none") },
                      ...options.map((s) => ({
                        value: s.id,
                        label: t("prints:form.spoolOption", {
                          name: spoolName(t, s),
                          weight: formatWeight(s.remainingGrams),
                        }),
                      })),
                    ]}
                  />
                ) : spool ? (
                  <Link to="/filament/spools/$id" params={{ id: spool.id }} className={textLink}>
                    {spoolName(t, spool)}
                  </Link>
                ) : (
                  <span className="text-muted">{t("printers:loaded.none")}</span>
                )}
                {spool?.loadedBy === "printer" && (
                  <span className="text-muted text-sm">{t("printers:loaded.byPrinter")}</span>
                )}
                {idea && (
                  <span className="text-muted text-sm">
                    {t("printers:loaded.suggested", { name: spoolName(t, idea) })}
                  </span>
                )}
              </div>
              {can && idea ? (
                <Button
                  variant="ghost"
                  disabled={load.isPending}
                  aria-label={t("printers:loaded.acceptSlot", {
                    slot: label,
                    name: spoolName(t, idea),
                  })}
                  onClick={() => load.mutate({ slot, spoolId: idea.id })}
                >
                  {t("printers:loaded.accept")}
                </Button>
              ) : can && spool ? (
                <Button
                  variant="ghost"
                  disabled={load.isPending}
                  aria-label={t("printers:loaded.clearSlot", { slot: label })}
                  onClick={() => load.mutate({ slot, spoolId: null })}
                >
                  {t("printers:loaded.clear")}
                </Button>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
