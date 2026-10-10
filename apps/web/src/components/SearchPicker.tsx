import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FormField, inputClass } from "./FormField.tsx";

const MAX_RESULTS = 8;

/** Multi-select for long lists: selected items as removable chips, a search box to add more. */
export function SearchPicker({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  options: { id: string; label: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const matches = (needle ? options : []).filter(
    (o) => !value.includes(o.id) && o.label.toLowerCase().includes(needle),
  );
  const selected = value.flatMap((id) => options.find((o) => o.id === id) ?? []);
  return (
    <div className="grid gap-2">
      <FormField label={label} hint={hint}>
        {(p) => (
          <input
            {...p}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("common:picker.search")}
            className={inputClass}
          />
        )}
      </FormField>
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== o.id))}
                aria-label={t("common:picker.remove", { name: o.label })}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-accent bg-accent/15 px-3 font-medium"
              >
                {o.label}
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {needle && (
        <ul className="grid max-h-56 overflow-y-auto rounded-md border border-border">
          {matches.slice(0, MAX_RESULTS).map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => onChange([...value, o.id])}
                className="w-full px-3 py-1.5 text-left hover:bg-surface-2"
              >
                {o.label}
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="px-3 py-1.5 text-muted">{t("common:picker.none")}</li>
          )}
          {matches.length > MAX_RESULTS && (
            <li className="px-3 py-1.5 text-muted">
              {t("common:picker.more", { count: matches.length - MAX_RESULTS })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
