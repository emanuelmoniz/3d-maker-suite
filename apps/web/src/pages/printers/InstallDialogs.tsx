import type { Accessory } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox, type ComboOption } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { DateInput } from "../../components/DateInput.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { Write } from "../../components/Write.tsx";
import { accessoryName, useInstall, useRemoveInstall } from "../../lib/accessories.ts";
import type { ApiError } from "../../lib/api.ts";
import { dateInputToIso } from "../../lib/format.ts";

const today = () => new Date().toISOString().slice(0, 10);

const errorKey = (e: unknown) =>
  ({
    install_overlap: "printers:accessories.onPrinter.overlap",
    invalid_dates: "printers:accessories.onPrinter.badDates",
  })[(e as ApiError | null)?.code ?? ""] ?? "printers:accessories.onPrinter.error";

function DateField({
  label,
  hint,
  value,
  onChange,
  required,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <FormField label={label} hint={hint}>
      {(p) => (
        <DateInput
          {...p}
          required={required}
          className={inputClass}
          value={value}
          onChange={onChange}
        />
      )}
    </FormField>
  );
}

/**
 * Puts an accessory on a printer. One side is fixed (`printerId` on the printer page, `accessoryId`
 * on the accessory page), the other is picked from `options`. A removal date records a past period.
 * Render it only while open, so every opening starts fresh.
 */
export function InstallDialog({
  printerId,
  accessoryId,
  options,
  onClose,
}: {
  printerId?: string;
  accessoryId?: string;
  options: ComboOption[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const install = useInstall();
  const [pick, setPick] = useState(options[0]?.value ?? "");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const onPrinter = printerId !== undefined;

  return (
    <ConfirmDialog
      open
      title={t(
        onPrinter
          ? "printers:accessories.onPrinter.installTitle"
          : "printers:accessories.onPrinter.putOnTitle",
      )}
      description={t(
        options.length
          ? "printers:accessories.onPrinter.installBody"
          : onPrinter
            ? "printers:accessories.onPrinter.noneFree"
            : "printers:accessories.onPrinter.noPrinters",
      )}
      confirmLabel={t("printers:accessories.onPrinter.installConfirm")}
      onCancel={onClose}
      onConfirm={() =>
        pick &&
        from &&
        install.mutate(
          {
            accessoryId: accessoryId ?? pick,
            printerId: printerId ?? pick,
            installedAt: dateInputToIso(from),
            removedAt: to ? dateInputToIso(to) : null,
          },
          { onSuccess: onClose },
        )
      }
    >
      {options.length > 0 && (
        <>
          <FormField
            label={t(
              onPrinter
                ? "printers:accessories.onPrinter.accessory"
                : "printers:accessories.onPrinter.printer",
            )}
          >
            {(p) => <Combobox {...p} value={pick} onChange={setPick} options={options} />}
          </FormField>
          <DateField
            label={t("printers:accessories.onPrinter.installedAt")}
            value={from}
            onChange={setFrom}
            required
          />
          <DateField
            label={t("printers:accessories.onPrinter.removedAt")}
            hint={t("printers:accessories.onPrinter.removedAtHint")}
            value={to}
            onChange={setTo}
          />
        </>
      )}
      {install.isError && (
        <p role="alert" className="text-bad">
          {t(errorKey(install.error))}
        </p>
      )}
      {onPrinter && (
        <Write admin>
          <Link to="/printers/accessories/new" className="text-accent hover:underline">
            {t("printers:accessories.add")}
          </Link>
        </Write>
      )}
    </ConfirmDialog>
  );
}

/** Takes an installed accessory off its printer on the chosen day. Render it only while open. */
export function RemoveDialog({
  accessory,
  onClose,
}: {
  accessory: Accessory;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const remove = useRemoveInstall();
  const [day, setDay] = useState(today);

  return (
    <ConfirmDialog
      open
      title={t("printers:accessories.onPrinter.removeTitle", {
        name: accessoryName(t, accessory),
      })}
      description={t("printers:accessories.onPrinter.removeBody")}
      confirmLabel={t("printers:accessories.onPrinter.remove")}
      onCancel={onClose}
      onConfirm={() =>
        accessory.installId &&
        day &&
        remove.mutate(
          {
            accessoryId: accessory.id,
            installId: accessory.installId,
            removedAt: dateInputToIso(day),
          },
          { onSuccess: onClose },
        )
      }
    >
      <DateField
        label={t("printers:accessories.onPrinter.removedAt")}
        value={day}
        onChange={setDay}
        required
      />
      {remove.isError && (
        <p role="alert" className="text-bad">
          {t(errorKey(remove.error))}
        </p>
      )}
    </ConfirmDialog>
  );
}
