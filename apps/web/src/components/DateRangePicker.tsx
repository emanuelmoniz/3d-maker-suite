import { useTranslation } from "react-i18next";
import { inputClass } from "./FormField.tsx";

export type DateRange = { from?: string; to?: string }; // ISO yyyy-mm-dd

// Native date inputs: locale-aware, accessible and touch-friendly for free.
export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex items-center gap-2">
      <input
        type="date"
        aria-label={t("common:dateRange.from")}
        value={value.from ?? ""}
        max={value.to || undefined}
        onChange={(e) => onChange({ ...value, from: e.target.value || undefined })}
        className={`${inputClass} w-auto`}
      />
      <input
        type="date"
        aria-label={t("common:dateRange.to")}
        value={value.to ?? ""}
        min={value.from || undefined}
        onChange={(e) => onChange({ ...value, to: e.target.value || undefined })}
        className={`${inputClass} w-auto`}
      />
    </fieldset>
  );
}
