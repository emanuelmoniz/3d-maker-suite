import { ArrowDown, ArrowUp } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "../lib/cx.ts";

export type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Right-aligned for numbers. */
  numeric?: boolean;
  /** Provide to make the column sortable. */
  sortValue?: (row: T) => string | number;
};

export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  onRowClick,
}: {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    const value = columns.find((c) => c.id === sort?.id)?.sortValue;
    if (!sort || !value) return rows;
    return [...rows].sort((a, b) =>
      value(a) < value(b) ? -sort.dir : value(a) > value(b) ? sort.dir : 0,
    );
  }, [rows, columns, sort]);

  return (
    // Scrollable on narrow screens, so it must be keyboard-focusable (and named) to be reachable.
    <section
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: scroll container needs keyboard access
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-border bg-surface"
    >
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-border bg-surface-2 text-muted">
            {columns.map((c) => {
              const active = sort?.id === c.id;
              const Arrow = active && sort.dir === -1 ? ArrowDown : ArrowUp;
              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                  className={cx(
                    "h-9 whitespace-nowrap px-3 font-medium",
                    c.numeric && "text-right",
                  )}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => setSort({ id: c.id, dir: active && sort.dir === 1 ? -1 : 1 })}
                      className={cx(
                        "inline-flex h-9 items-center gap-1 hover:text-fg",
                        c.numeric && "flex-row-reverse",
                      )}
                    >
                      {c.header}
                      {active && <Arrow className="size-3.5" aria-hidden />}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick && (() => onRowClick(row))}
              className={cx(
                "h-9 border-b border-border last:border-0",
                onRowClick && "cursor-pointer hover:bg-surface-2",
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.id}
                  className={cx(
                    "whitespace-nowrap px-3 [&_a]:inline-flex [&_a]:min-h-6 [&_a]:items-center",
                    c.numeric && "text-right",
                  )}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
          {!sorted.length && (
            <tr>
              <td colSpan={columns.length} className="h-16 text-center text-muted">
                {t("common:table.noRows")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
