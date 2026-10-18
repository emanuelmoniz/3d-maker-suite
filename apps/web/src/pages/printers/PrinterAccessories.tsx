import type { Accessory } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import {
  accessoryName,
  useAccessories,
  useInstall,
  useRemoveInstall,
} from "../../lib/accessories.ts";
import type { ApiError } from "../../lib/api.ts";
import { dateInputToIso, formatDate } from "../../lib/format.ts";
import { StateBadge } from "./StateBadge.tsx";

const today = () => new Date().toISOString().slice(0, 10);

const errorKey = (e: unknown) =>
  ({
    install_overlap: "printers:accessories.onPrinter.overlap",
    invalid_dates: "printers:accessories.onPrinter.badDates",
  })[(e as ApiError | null)?.code ?? ""] ?? "printers:accessories.onPrinter.error";

/** Accessories on one printer: add one that is free (asks the install date), remove (asks the removal date). */
export function PrinterAccessories({ printerId }: { printerId: string }) {
  const { t } = useTranslation();
  const installed = useAccessories(printerId).data?.items ?? [];
  const free = (useAccessories().data?.items ?? []).filter((a) => a.printerId === null);
  const install = useInstall();
  const remove = useRemoveInstall();
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState("");
  const [removing, setRemoving] = useState<Accessory | null>(null);
  const [day, setDay] = useState(today);

  const close = () => {
    setAdding(false);
    setRemoving(null);
  };
  const onDone = { onSuccess: close };

  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t("printers:accessories.title")}</h2>
        <Button
          onClick={() => {
            install.reset();
            setPick(free[0]?.id ?? "");
            setDay(today());
            setAdding(true);
          }}
        >
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
                onClick={() => {
                  remove.reset();
                  setDay(today());
                  setRemoving(a);
                }}
              >
                {t("printers:accessories.onPrinter.remove")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">{t("printers:accessories.onPrinter.empty")}</p>
      )}

      <ConfirmDialog
        open={adding}
        title={t("printers:accessories.onPrinter.installTitle")}
        description={t(
          free.length
            ? "printers:accessories.onPrinter.installBody"
            : "printers:accessories.onPrinter.noneFree",
        )}
        confirmLabel={t("printers:accessories.onPrinter.installConfirm")}
        onCancel={close}
        onConfirm={() =>
          pick &&
          day &&
          install.mutate({ accessoryId: pick, printerId, installedAt: dateInputToIso(day) }, onDone)
        }
      >
        {free.length > 0 && (
          <>
            <FormField label={t("printers:accessories.onPrinter.accessory")}>
              {(p) => (
                <Combobox
                  {...p}
                  value={pick}
                  onChange={setPick}
                  options={free.map((a) => ({ value: a.id, label: accessoryName(t, a) }))}
                />
              )}
            </FormField>
            <FormField label={t("printers:accessories.onPrinter.installedAt")}>
              {(p) => (
                <input
                  {...p}
                  type="date"
                  required
                  className={inputClass}
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              )}
            </FormField>
          </>
        )}
        {install.isError && (
          <p role="alert" className="text-bad">
            {t(errorKey(install.error))}
          </p>
        )}
        <Link to="/printers/accessories/new" className="text-accent hover:underline">
          {t("printers:accessories.add")}
        </Link>
      </ConfirmDialog>

      <ConfirmDialog
        open={removing !== null}
        title={t("printers:accessories.onPrinter.removeTitle", {
          name: removing ? accessoryName(t, removing) : "",
        })}
        description={t("printers:accessories.onPrinter.removeBody")}
        confirmLabel={t("printers:accessories.onPrinter.remove")}
        onCancel={close}
        onConfirm={() =>
          removing?.installId &&
          day &&
          remove.mutate(
            {
              accessoryId: removing.id,
              installId: removing.installId,
              removedAt: dateInputToIso(day),
            },
            onDone,
          )
        }
      >
        <FormField label={t("printers:accessories.onPrinter.removedAt")}>
          {(p) => (
            <input
              {...p}
              type="date"
              required
              className={inputClass}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          )}
        </FormField>
        {remove.isError && (
          <p role="alert" className="text-bad">
            {t(errorKey(remove.error))}
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}
