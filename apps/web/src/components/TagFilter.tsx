import { useTranslation } from "react-i18next";
import { useTags } from "../lib/tags.ts";
import { inputClass } from "./FormField.tsx";

/** List filter: one tag or all. Renders nothing until at least one tag exists. */
export function TagFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  const tags = useTags().data ?? [];
  if (!tags.length) return null;
  return (
    <select
      aria-label={t("tags:filter.label")}
      className={`${inputClass} w-auto`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t("tags:filter.all")}</option>
      {tags.map((tag) => (
        <option key={tag.id} value={tag.id}>
          {tag.name}
        </option>
      ))}
    </select>
  );
}
