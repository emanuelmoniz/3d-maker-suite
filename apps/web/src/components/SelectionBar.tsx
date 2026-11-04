import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "../lib/cx.ts";
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

/**
 * What a bulk change did, over its bar, until dismissed. Its live region is always there, so a
 * screen reader announces what appears in it.
 */
export function SelectionResult({
  open,
  onDismiss,
  children,
}: {
  open: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cx(
        "flex items-start gap-2 rounded-lg border border-border bg-surface p-2 shadow-lg",
        !open && "hidden",
      )}
    >
      <div role="status" className="grid min-w-0 flex-1 gap-1 py-1.5">
        {open && children}
      </div>
      {open && (
        <button
          type="button"
          aria-label={t("common:bulk.dismiss")}
          title={t("common:bulk.dismiss")}
          onClick={onDismiss}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
