import type { ColumnFilter } from "@3d-maker-suite/core";
import { ArrowDown, ArrowUp, Filter } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "../lib/cx.ts";
import { Button } from "./Button.tsx";
import { DateRangePicker } from "./DateRangePicker.tsx";
import { inputClass } from "./FormField.tsx";

export type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Right-aligned for numbers. */
  numeric?: boolean;
  /** Client mode: provide to make the column sortable. */
  sortValue?: (row: T) => string | number;
  /** Server mode: API sort field. */
  sort?: string;
  /** Server mode: key in the table's `filters` declaration. */
  filter?: string;
  /** Labels for a select filter (defaults to the declared options). */
  filterOptions?: { value: string; label: string }[];
  /** A number filter is entered in API units / scale, e.g. 60 = minutes for seconds. */
  filterScale?: number;
  /** Shown under a number filter, e.g. its unit. */
  filterHint?: string;
};

/** Raw list query, as in the URL and the API: page, pageSize, sort and column filters. */
export type ListQuery = Record<string, string>;

type ServerProps = {
  query: ListQuery;
  onQueryChange: (q: ListQuery) => void;
  total: number;
  /** The same declaration the API validates with (e.g. `printFilters`). */
  filters?: Record<string, ColumnFilter>;
  /** The API's sort when `query.sort` is absent. */
  defaultSort?: string;
  /** Adds a "Show archived" switch, sent as `?archived=true`. */
  archivable?: boolean;
};

const PAGE_SIZES = [10, 25, 50, 100];

export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  server,
}: {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Paging, sorting and filtering happen on the server; omit to sort the given rows locally. */
  server?: ServerProps;
}) {
  const { t } = useTranslation();
  const [localSort, setLocalSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    const value = columns.find((c) => c.id === localSort?.id)?.sortValue;
    if (server || !localSort || !value) return rows;
    return [...rows].sort((a, b) =>
      value(a) < value(b) ? -localSort.dir : value(a) > value(b) ? localSort.dir : 0,
    );
  }, [rows, columns, localSort, server]);

  // Changing anything but the page goes back to page 1.
  const update = (patch: ListQuery, keepPage = false) => {
    if (!server) return;
    const next: ListQuery = { ...server.query, ...patch };
    if (!keepPage) delete next.page;
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    server.onQueryChange(next);
  };

  const serverSort = server && (server.query.sort ?? server.defaultSort ?? "");
  const sortOf = (c: Column<T>): { active: boolean; dir: 1 | -1 } | null => {
    if (server) {
      if (!c.sort) return null;
      const desc = serverSort?.startsWith("-") ?? false;
      return { active: serverSort?.replace(/^-/, "") === c.sort, dir: desc ? -1 : 1 };
    }
    if (!c.sortValue) return null;
    return { active: localSort?.id === c.id, dir: localSort?.dir ?? 1 };
  };
  const toggleSort = (c: Column<T>, s: { active: boolean; dir: 1 | -1 }) => {
    const dir = s.active && s.dir === 1 ? -1 : 1;
    if (server && c.sort) update({ sort: dir === 1 ? c.sort : `-${c.sort}` });
    else setLocalSort({ id: c.id, dir });
  };
  const hasFilters = server && columns.some((c) => c.filter && server.query[c.filter]);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {server?.archivable && (
        <label className="flex items-center gap-2 self-end">
          <input
            type="checkbox"
            checked={server.query.archived === "true"}
            onChange={(e) => update({ archived: e.target.checked ? "true" : "" })}
          />
          {t("common:table.showArchived")}
        </label>
      )}
      {/* Scrollable on narrow screens, so it must be keyboard-focusable (and named) to be reachable. */}
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
                const s = sortOf(c);
                const Arrow = s?.dir === -1 ? ArrowDown : ArrowUp;
                const spec = c.filter ? server?.filters?.[c.filter] : undefined;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={s?.active ? (s.dir === 1 ? "ascending" : "descending") : undefined}
                    className={cx(
                      "h-9 whitespace-nowrap px-3 font-medium",
                      c.numeric && "text-right",
                    )}
                  >
                    <span
                      className={cx(
                        "inline-flex items-center gap-1",
                        c.numeric && "flex-row-reverse",
                      )}
                    >
                      {s ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c, s)}
                          className={cx(
                            "inline-flex h-9 items-center gap-1 hover:text-fg",
                            c.numeric && "flex-row-reverse",
                          )}
                        >
                          {c.header}
                          {s.active && <Arrow className="size-3.5" aria-hidden />}
                        </button>
                      ) : (
                        c.header
                      )}
                      {server && c.filter && spec && (
                        <ColumnFilterButton
                          column={c}
                          spec={spec}
                          value={server.query[c.filter] ?? ""}
                          onChange={(v) => c.filter && update({ [c.filter]: v })}
                        />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={rowKey(row)} className="h-9 border-b border-border last:border-0">
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
      {server && (
        <Pager
          query={server.query}
          total={server.total}
          onChange={update}
          onClear={
            hasFilters
              ? () => {
                  const { pageSize, sort, archived } = server.query;
                  server.onQueryChange({
                    ...(pageSize && { pageSize }),
                    ...(sort && { sort }),
                    ...(archived && { archived }),
                  });
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

/** Page size, range and previous/next. DataTable renders it in server mode; grids reuse it. */
export function Pager({
  query,
  total,
  onChange,
  onClear,
}: {
  query: ListQuery;
  total: number;
  onChange: (patch: ListQuery, keepPage?: boolean) => void;
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  const page = Number(query.page) || 1;
  const pageSize = Number(query.pageSize) || 25; // the API default
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const go = (p: number) => onChange({ page: p > 1 ? String(p) : "" }, true);
  return (
    <nav
      aria-label={t("common:table.pagination")}
      className="flex flex-wrap items-center justify-end gap-3 text-muted"
    >
      {onClear && (
        <Button variant="ghost" onClick={onClear} className="mr-auto">
          {t("common:actions.clear")}
        </Button>
      )}
      <label className="flex items-center gap-2 whitespace-nowrap">
        {t("common:table.pageSize")}
        <select
          className={`${inputClass} w-auto`}
          value={pageSize}
          onChange={(e) => onChange({ pageSize: e.target.value })}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <span aria-live="polite">
        {t("common:table.range", {
          from: total ? (page - 1) * pageSize + 1 : 0,
          to: Math.min(page * pageSize, total),
          total,
        })}
      </span>
      <span className="flex gap-1">
        <Button variant="ghost" disabled={page <= 1} onClick={() => go(page - 1)}>
          {t("common:table.previous")}
        </Button>
        <Button variant="ghost" disabled={page >= pages} onClick={() => go(page + 1)}>
          {t("common:table.next")}
        </Button>
      </span>
    </nav>
  );
}

/** Header button + native popover (light dismiss, Escape and focus handling come free). */
function ColumnFilterButton<T>({
  column,
  spec,
  value,
  onChange,
}: {
  column: Column<T>;
  spec: ColumnFilter;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const scale = column.filterScale ?? 1;
  const [a = "", b = ""] = value.split("..");
  const [dates, setDates] = useState({ from: a, to: b });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const str = (k: string) => String(fd.get(k) ?? "").trim();
    const num = (k: string) => (str(k) ? String(Number(str(k)) * scale) : "");
    const range = (x: string, y: string) => (x || y ? `${x}..${y}` : "");
    onChange(
      spec.kind === "text"
        ? str("v")
        : spec.kind === "select"
          ? fd.getAll("v").join(",")
          : spec.kind === "number"
            ? range(num("min"), num("max"))
            : range(dates.from, dates.to),
    );
    document.getElementById(id)?.hidePopover();
  };
  const unscale = (v: string) => (v ? String(Number(v) / scale) : "");
  const options =
    column.filterOptions ??
    (spec.kind === "select" ? (spec.options ?? []) : []).map((o) => ({ value: o, label: o }));
  const selected = value.split(",");

  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        aria-label={t(value ? "common:table.filterActive" : "common:table.filterBy", {
          column: column.header,
        })}
        className={cx(
          "inline-flex size-7 items-center justify-center rounded hover:text-fg",
          value && "text-accent",
        )}
      >
        <Filter className={cx("size-3.5", value && "fill-current")} aria-hidden />
      </button>
      <div
        id={id}
        popover="auto"
        onToggle={(e) => {
          if (e.newState !== "open") return;
          setDates({ from: a, to: b });
          // Below its header button, kept on screen (no CSS anchor positioning in every browser yet).
          const r = document.querySelector(`[popovertarget="${id}"]`)?.getBoundingClientRect();
          const el = e.currentTarget;
          if (!r) return;
          el.style.top = `${r.bottom + 4}px`;
          el.style.left = `${Math.max(8, Math.min(r.left, document.documentElement.clientWidth - el.offsetWidth - 8))}px`;
        }}
        className="fixed w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-surface p-3 text-left font-normal text-fg shadow-lg backdrop:bg-black/20"
      >
        {/* Re-mounted when the applied value changes, so the defaults follow the URL. */}
        <form key={value} onSubmit={submit} className="flex flex-col gap-3">
          <p className="font-medium">{column.header}</p>
          {spec.kind === "text" && (
            <input
              name="v"
              type="search"
              aria-label={t("common:table.contains")}
              placeholder={t("common:table.contains")}
              defaultValue={value}
              className={inputClass}
            />
          )}
          {spec.kind === "select" && (
            <fieldset className="flex max-h-60 flex-col gap-1 overflow-y-auto">
              <legend className="sr-only">{column.header}</legend>
              {options.map((o) => (
                <label key={o.value} className="flex min-h-8 items-center gap-2">
                  <input
                    type="checkbox"
                    name="v"
                    value={o.value}
                    defaultChecked={selected.includes(o.value)}
                  />
                  {o.label}
                </label>
              ))}
            </fieldset>
          )}
          {spec.kind === "number" && (
            <fieldset className="flex flex-col gap-1">
              <legend className="sr-only">{column.header}</legend>
              <span className="flex gap-2">
                {[
                  { k: "min", label: t("common:table.min"), v: a },
                  { k: "max", label: t("common:table.max"), v: b },
                ].map(({ k, label, v }) => (
                  <input
                    key={k}
                    name={k}
                    type="number"
                    min={0}
                    step="any"
                    aria-label={label}
                    placeholder={label}
                    defaultValue={unscale(v)}
                    className={inputClass}
                  />
                ))}
              </span>
              {column.filterHint && <span className="text-muted">{column.filterHint}</span>}
            </fieldset>
          )}
          {spec.kind === "date" && (
            <DateRangePicker
              value={{ from: dates.from || undefined, to: dates.to || undefined }}
              onChange={(r) => setDates({ from: r.from ?? "", to: r.to ?? "" })}
            />
          )}
          <span className="flex justify-end gap-2">
            {value && (
              <Button
                variant="ghost"
                onClick={() => {
                  onChange("");
                  document.getElementById(id)?.hidePopover();
                }}
              >
                {t("common:table.clear")}
              </Button>
            )}
            <Button type="submit" variant="primary">
              {t("common:table.apply")}
            </Button>
          </span>
        </form>
      </div>
    </>
  );
}
