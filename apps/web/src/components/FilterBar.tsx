import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "../lib/cx.ts";
import { Button } from "./Button.tsx";
import { inputClass } from "./FormField.tsx";

export function FilterBar({
  search,
  onSearchChange,
  searchLabel,
  onReset,
  children,
  className,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  searchLabel: string;
  onReset?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <search className={cx("flex flex-wrap items-center gap-2", className)}>
      <div className="relative min-w-48 flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted"
          aria-hidden
        />
        <input
          type="search"
          aria-label={searchLabel}
          placeholder={searchLabel}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className={`${inputClass} pl-8`}
        />
      </div>
      {children}
      {onReset && (
        <Button variant="ghost" onClick={onReset}>
          {t("common:actions.clear")}
        </Button>
      )}
    </search>
  );
}
