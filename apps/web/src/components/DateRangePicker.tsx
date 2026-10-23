import { useTranslation } from "react-i18next";
import { DateInput } from "./DateInput.tsx";
import { inputClass } from "./FormField.tsx";

export type DateRange = { from?: string; to?: string }; // ISO yyyy-mm-dd

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex min-w-0 items-center gap-2">
      <DateInput
        aria-label={t("common:dateRange.from")}
        value={value.from ?? ""}
        max={value.to || undefined}
        onChange={(iso) => onChange({ ...value, from: iso || undefined })}
        className={inputClass}
      />
      <DateInput
        aria-label={t("common:dateRange.to")}
        value={value.to ?? ""}
        min={value.from || undefined}
        onChange={(iso) => onChange({ ...value, to: iso || undefined })}
        className={inputClass}
      />
    </fieldset>
  );
}
