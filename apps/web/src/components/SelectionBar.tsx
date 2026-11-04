import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button.tsx";

/** The bar above a list with selected rows: how many, Clear, and what can be done with them. */
export function SelectionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 p-2 shadow-lg">
      <span aria-live="polite" className="font-medium">
        {t("common:bulk.selected", { count })}
      </span>
      <Button variant="ghost" onClick={onClear}>
        {t("common:bulk.clear")}
      </Button>
      <span className="ml-auto flex flex-wrap gap-2">{children}</span>
    </div>
  );
}
