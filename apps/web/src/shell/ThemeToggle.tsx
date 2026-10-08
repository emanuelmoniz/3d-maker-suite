import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cx } from "../lib/cx.ts";
import { type Mode, useTheme } from "../lib/theme.ts";

const OPTIONS = [
  { mode: "light", icon: Sun, label: "common:theme.light" },
  { mode: "dark", icon: Moon, label: "common:theme.dark" },
  { mode: "system", icon: Monitor, label: "common:theme.system" },
] as const satisfies readonly { mode: Mode; icon: unknown; label: string }[];

export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();
  return (
    <fieldset
      className={cx("m-0 flex rounded-md border border-border bg-surface-2 p-0.5", className)}
    >
      <legend className="sr-only">{t("common:theme.label")}</legend>
      {OPTIONS.map(({ mode: m, icon: Icon, label }) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          aria-label={t(label)}
          title={t(label)}
          onClick={() => setMode(m)}
          className={cx(
            "grid h-7 flex-1 place-items-center rounded-[5px] text-muted hover:text-fg",
            mode === m && "bg-surface text-fg shadow-sm",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </fieldset>
  );
}
