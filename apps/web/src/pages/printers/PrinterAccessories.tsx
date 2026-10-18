import type { Accessory } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { accessoryName, useAccessories } from "../../lib/accessories.ts";
import { formatDate } from "../../lib/format.ts";
import { InstallDialog, RemoveDialog } from "./InstallDialogs.tsx";
import { StateBadge } from "./StateBadge.tsx";

/** Accessories on one printer: add one that is free (asks the install date), remove (asks the removal date). */
export function PrinterAccessories({ printerId }: { printerId: string }) {
  const { t } = useTranslation();
  const installed = useAccessories(printerId).data?.items ?? [];
  const free = (useAccessories().data?.items ?? []).filter((a) => a.printerId === null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Accessory | null>(null);

  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t("printers:accessories.title")}</h2>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden />
          {t("printers:accessories.onPrinter.install")}
        </Button>
      </div>
      {installed.length ? (
        <ul className="grid gap-2">
          {installed.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-md border border-border p-3">
              <div className="min-w-0 flex-1">
                <Link
                  to="/printers/accessories/$id"
                  params={{ id: a.id }}
                  className="font-medium hover:underline"
                >
                  {accessoryName(t, a)}
                </Link>
                <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
                  {a.type}
                  {a.installedAt && (
                    <span>
                      {t("printers:accessories.onPrinter.since", {
                        date: formatDate(a.installedAt),
                      })}
                    </span>
                  )}
                  <StateBadge state={a.state} />
                </p>
              </div>
              <Button
                aria-label={t("printers:accessories.onPrinter.removeLabel", {
                  name: accessoryName(t, a),
                })}
                onClick={() => setRemoving(a)}
              >
                {t("printers:accessories.onPrinter.remove")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">{t("printers:accessories.onPrinter.empty")}</p>
      )}

      {adding && (
        <InstallDialog
          printerId={printerId}
          options={free.map((a) => ({ value: a.id, label: accessoryName(t, a) }))}
          onClose={() => setAdding(false)}
        />
      )}
      {removing && <RemoveDialog accessory={removing} onClose={() => setRemoving(null)} />}
    </section>
  );
}
