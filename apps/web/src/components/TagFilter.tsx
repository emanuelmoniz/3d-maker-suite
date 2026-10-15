import { useTranslation } from "react-i18next";
import { useTags } from "../lib/tags.ts";
import { Combobox } from "./Combobox.tsx";
import { inputClass } from "./FormField.tsx";

/** List filter: one tag or all. Renders nothing until at least one tag exists. */
export function TagFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  const tags = useTags().data ?? [];
  if (!tags.length) return null;
  return (
    <Combobox
      aria-label={t("tags:filter.label")}
      className={`${inputClass} w-auto!`}
      value={value}
      onChange={onChange}
      options={[
        { value: "", label: t("tags:filter.all") },
        ...tags.map((tag) => ({ value: tag.id, label: tag.name })),
      ]}
    />
  );
}
