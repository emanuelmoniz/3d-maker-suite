import { type DashboardWidget, PREFERENCE_DEFAULTS } from "@3d-maker-suite/core";
import { ArrowDown, ArrowUp, Check, Pencil, Settings2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.tsx";
import { inputClass } from "../components/FormField.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { usePreferences, useSavePreferences } from "../lib/preferences.ts";
import { allWidgets, getWidget, type WidgetDef } from "../widgets/index.ts";

const SPAN = { 1: "", 2: "sm:col-span-2", 4: "sm:col-span-2 lg:col-span-4" };

/** Stored settings through the widget's schema, so missing or stale keys fall back to defaults. */
const resolve = (def: WidgetDef, stored: DashboardWidget["settings"]) =>
  def.settings.safeParse(stored).data ?? def.settings.parse({});

function SettingsForm({
  def,
  item,
  onChange,
}: {
  def: WidgetDef;
  item: DashboardWidget;
  onChange: (settings: DashboardWidget["settings"]) => void;
}) {
  const { t } = useTranslation();
  const current = resolve(def, item.settings) as Record<string, string | number>;
  return (
    <div className="mt-2 flex flex-wrap gap-3 rounded-md border border-border bg-surface-2 p-3">
      {def.fields.map((f) => {
        const id = `${item.id}-${f.key}`;
        return (
          <div key={f.key} className="flex flex-col gap-1">
            <label htmlFor={id} className="font-medium">
              {t(f.label)}
            </label>
            {f.kind === "select" ? (
              <select
                id={id}
                className={`${inputClass} w-auto!`}
                value={current[f.key]}
                onChange={(e) => onChange({ ...current, [f.key]: e.target.value })}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.label)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type="number"
                min={f.min}
                max={f.max}
                className={`${inputClass} w-24!`}
                value={current[f.key]}
                onChange={(e) =>
                  e.target.value &&
                  onChange({
                    ...current,
                    [f.key]: Math.min(f.max, Math.max(f.min, Number(e.target.value))),
                  })
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function HomePage() {
  const { t } = useTranslation();
  const { data } = usePreferences();
  const save = useSavePreferences();
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [toAdd, setToAdd] = useState("statCard");

  const layout = data?.values.dashboardLayout;
  if (!layout) return null;
  const store = (next: DashboardWidget[]) => save.mutate({ dashboardLayout: next });
  const move = (i: number, by: -1 | 1) => {
    const next = [...layout];
    next.splice(i + by, 0, ...next.splice(i, 1));
    store(next);
  };

  return (
    <>
      <PageHeader
        title={t("nav:items.home.label")}
        description={t("nav:items.home.description")}
        actions={
          <Button onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
            {editing ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <Pencil className="size-4" aria-hidden />
            )}
            {editing ? t("dashboard:done") : t("dashboard:customize")}
          </Button>
        }
      />

      {editing && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            aria-label={t("dashboard:addWidget")}
            className={`${inputClass} w-auto!`}
            value={toAdd}
            onChange={(e) => setToAdd(e.target.value)}
          >
            {allWidgets().map((w) => (
              <option key={w.type} value={w.type}>
                {t(w.title)}
              </option>
            ))}
          </select>
          <Button
            onClick={() => {
              const def = getWidget(toAdd);
              if (def)
                store([
                  ...layout,
                  {
                    id: crypto.randomUUID(),
                    type: toAdd,
                    settings: def.settings.parse({}) as DashboardWidget["settings"],
                  },
                ]);
            }}
          >
            {t("dashboard:add")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => store(PREFERENCE_DEFAULTS.dashboardLayout)}
            className="ml-auto"
          >
            {t("dashboard:reset")}
          </Button>
        </div>
      )}

      {layout.length === 0 && <p className="text-muted">{t("dashboard:emptyLayout")}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {layout.map((item, i) => {
          const def = getWidget(item.type);
          if (!def && !editing) return null;
          return (
            <div key={item.id} className={SPAN[def?.span ?? 1]}>
              {editing && (
                <div className="mb-1 flex items-center gap-1">
                  <span className="mr-auto truncate font-medium">
                    {def ? t(def.title) : item.type}
                  </span>
                  <Button
                    variant="ghost"
                    className="size-8 px-0"
                    aria-label={t("dashboard:moveUp")}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    className="size-8 px-0"
                    aria-label={t("dashboard:moveDown")}
                    disabled={i === layout.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                  {def?.fields.length ? (
                    <Button
                      variant="ghost"
                      className="size-8 px-0"
                      aria-label={t("dashboard:settings")}
                      aria-expanded={open === item.id}
                      onClick={() => setOpen(open === item.id ? null : item.id)}
                    >
                      <Settings2 className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    className="size-8 px-0"
                    aria-label={t("dashboard:remove")}
                    onClick={() => store(layout.filter((x) => x.id !== item.id))}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              )}
              {editing && def && open === item.id && (
                <SettingsForm
                  def={def}
                  item={item}
                  onChange={(settings) =>
                    store(layout.map((x) => (x.id === item.id ? { ...x, settings } : x)))
                  }
                />
              )}
              {def && <def.Component settings={resolve(def, item.settings)} />}
            </div>
          );
        })}
      </div>
    </>
  );
}
