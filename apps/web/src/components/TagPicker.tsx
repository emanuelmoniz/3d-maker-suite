import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateTag, useTags } from "../lib/tags.ts";
import { Button } from "./Button.tsx";
import { inputClass } from "./FormField.tsx";

/**
 * Controlled tag selector: toggle existing tags, or create one inline. Persisting is the caller's
 * job (`useSetTags`), so it works the same on create and edit forms, for any taggable type.
 */
export function TagPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tagIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const tags = useTags().data ?? [];
  const create = useCreateTag();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Same name (any case) is the same tag: select it instead of hitting the unique index.
    const existing = tags.find((x) => x.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      if (!value.includes(existing.id)) onChange([...value, existing.id]);
      return setName("");
    }
    create.mutate(
      { name: trimmed, color },
      {
        onSuccess: (tag) => {
          onChange([...value, tag.id]);
          setName("");
        },
      },
    );
  };

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 font-medium">{t("tags:picker.label")}</legend>
      {tags.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag) => {
            const on = value.includes(tag.id);
            return (
              <li key={tag.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(tag.id)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 ${
                    on ? "border-accent bg-accent/15 font-medium" : "border-border bg-surface"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted">{t("tags:picker.empty")}</p>
      )}
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={t("tags:picker.color")}
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-10 shrink-0 rounded-md border border-border bg-surface p-1"
        />
        <input
          aria-label={t("tags:picker.newName")}
          placeholder={t("tags:picker.newName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          // Enter adds the tag; it must not submit the surrounding form.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className={inputClass}
        />
        <Button onClick={add} disabled={!name.trim() || create.isPending}>
          <Plus className="size-4" aria-hidden />
          {t("tags:picker.add")}
        </Button>
      </div>
      {create.isError && (
        <p role="alert" className="text-bad">
          {t("tags:picker.error")}
        </p>
      )}
    </fieldset>
  );
}
