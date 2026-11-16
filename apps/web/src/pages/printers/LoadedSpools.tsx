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

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * The spool in each slot (ADR-0015): a new print on a slot charges it. The slots the printer
 * reports, those with a spool, and at least one.
 */
export function LoadedSpools({ printerId, live }: { printerId: string; live?: PrinterStatus }) {
  const { t } = useTranslation();
  const can = useCan("printers", "manage");
  const load = useLoadSpool(printerId);
  const spools = (useSpools().data?.items ?? []).filter(
    (s) => !s.archivedAt && s.status !== "empty",
  );
  const reported = live?.snapshot.slots ?? [];
  const [more, setMore] = useState(0);
  const used = [0, ...reported.map((s) => s.slot)];
  for (const s of spools) if (s.loadedPrinterId === printerId) used.push(s.loadedSlot ?? 0);
  const count = Math.min(Math.max(...used) + 1 + more, PRINT_MAX_SLOTS);

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
        {Array.from({ length: count }, (_, slot) => {
          const r = reported.find((s) => s.slot === slot);
          const spool = spools.find(
            (s) => s.loadedPrinterId === printerId && s.loadedSlot === slot,
          );
          const label = t("printers:loaded.slot", { slot: slot + 1 });
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
              {can && spool ? (
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
