import { BULK_ITEMS, type BulkKind, type ColumnFilter } from "@3d-maker-suite/core";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Filter } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCan } from "../lib/auth.ts";
import { cx } from "../lib/cx.ts";
import { allRows } from "../lib/list.ts";
import { placePopover } from "../lib/placePopover.ts";
import { ArchivedBadge, BulkBar, type BulkRow } from "./ArchiveActions.tsx";
import { Button } from "./Button.tsx";
import { Combobox } from "./Combobox.tsx";
import { DateRangePicker } from "./DateRangePicker.tsx";
import { inputClass } from "./FormField.tsx";

export type Column<T> = {
  id: string;
  header: string;
  /** Rendered in the header instead of `header` (e.g. a "select all" checkbox). */
  headerCell?: ReactNode;
  cell: (row: T) => ReactNode;
  /** Right-aligned for numbers. */
  numeric?: boolean;
  /** Client mode: provide to make the column sortable. */
  sortValue?: (row: T) => string | number;
  /**
   * Client mode: provide to make the column filterable. A number filter for a `numeric` column
   * (in the same units as `filterScale`), a select with `filterOptions`, else "contains".
   */
  filterValue?: (row: T) => string | number;
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
  /** The Archived pill of a row with `archivedAt` goes here; an `archivable` list's first column by default. */
  archivedMark?: boolean | "own";
  /** Set by `archiveColumn`: the rows can be selected and acted on together, with `manage`. */
  bulk?: { kind: BulkKind; name: (row: T) => string; when?: (row: T) => boolean };
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
  /** Adds a "Show archived" switch: archived rows join the active ones (`?archived=all`). */
  archivable?: boolean;
  /** What else the list is limited to, outside `query` (a client's orders): select all keeps to it. */
  scope?: ListQuery;
};

const PAGE_SIZES = [10, 25, 50, 100];
/** These change how a list shows, not what it lists, so a selection outlives them. */
const VIEW_ONLY = ["page", "pageSize", "sort"];
const NOTHING: ReadonlyMap<string, BulkRow> = new Map();

const filterKey = <T,>(c: Column<T>, server: boolean) =>
  server ? c.filter : c.filterValue && c.id;
const sortKey = <T,>(c: Column<T>, server: boolean) => (server ? c.sort : c.sortValue && c.id);

/** Client mode: the rows a list query shows (column filters, then sort), before paging. */
export function viewOf<T>(columns: Column<T>[], rows: T[], query: ListQuery): T[] {
  let out = rows;
  for (const c of columns) {
    const f = query[c.id];
    const value = c.filterValue;
    if (!f || !value) continue;
    if (c.numeric) {
      const [min, max] = f.split("..").map((x) => (x ? Number(x) : undefined));
      out = out.filter((r) => {
        const v = Number(value(r));
        return (min == null || v >= min) && (max == null || v <= max);
      });
    } else if (c.filterOptions) {
      const picked = f.split(",");
      out = out.filter((r) => picked.includes(String(value(r))));
    } else {
      out = out.filter((r) => String(value(r)).toLowerCase().includes(f.toLowerCase()));
    }
  }
  const dir = query.sort?.startsWith("-") ? -1 : 1;
  const sortValue = columns.find((c) => c.id === query.sort?.replace(/^-/, ""))?.sortValue;
  if (!sortValue) return out;
  return [...out].sort((a, b) =>
    sortValue(a) < sortValue(b) ? -dir : sortValue(a) > sortValue(b) ? dir : 0,
  );
}
export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  server,
  client,
}: {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Paging, sorting and filtering happen on the server; omit to do them on the given rows. */
  server?: ServerProps;
  /** Client mode: keep the list query yourself (e.g. to act on the rows it shows); see `viewOf`. */
  client?: { query: ListQuery; onQueryChange: (q: ListQuery) => void };
}) {
  const { t } = useTranslation();
  const [ownQuery, setOwnQuery] = useState<ListQuery>({});
  const query = server?.query ?? client?.query ?? ownQuery;
  const setQuery = server?.onQueryChange ?? client?.onQueryChange ?? setOwnQuery;
  const view = server ? rows : viewOf(columns, rows, query);
  const total = server ? server.total : view.length;
  const size = Number(query.pageSize) || 25; // the API default
  const sorted = server
    ? rows
    : view.slice(((Number(query.page) || 1) - 1) * size, (Number(query.page) || 1) * size);

  // Changing anything but the page goes back to page 1.
  const update = (patch: ListQuery, keepPage = false) => {
    const next: ListQuery = { ...query, ...patch };
    if (!keepPage) delete next.page;
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    setQuery(next);
  };

  const currentSort = query.sort ?? server?.defaultSort ?? "";
  const sortOf = (c: Column<T>): { active: boolean; dir: 1 | -1 } | null => {
    const key = sortKey(c, !!server);
    if (!key) return null;
    return {
      active: currentSort.replace(/^-/, "") === key,
      dir: currentSort.startsWith("-") ? -1 : 1,
    };
  };
  const toggleSort = (c: Column<T>, s: { active: boolean; dir: 1 | -1 }) => {
    const key = sortKey(c, !!server);
    if (key) update({ sort: s.active && s.dir === 1 ? `-${key}` : key });
  };
  const markColumn = columns.find((c) => c.archivedMark) ?? (server?.archivable && columns[0]);
  const hasFilters = columns.some((c) => {
    const key = filterKey(c, !!server);
    return key && query[key];
  });

  const bulkColumn = columns.find((c) => c.bulk)?.bulk;
  const mayBulk = useCan(bulkColumn ? BULK_ITEMS[bulkColumn.kind].module : "printers", "manage");
  const bulk = mayBulk && server ? bulkColumn : undefined;
  const qc = useQueryClient();
  // A selection belongs to what the list lists, so a new filter ends it and paging doesn't.
  const list = JSON.stringify(
    Object.entries({ ...query, ...server?.scope })
      .filter(([k]) => !VIEW_ONLY.includes(k))
      .sort(),
  );
  const [selection, setSelection] = useState<{
    list: string;
    rows: ReadonlyMap<string, BulkRow>;
    /** How many select all found; every row is selected while `rows` holds that many. */
    full?: number;
    status?: "busy" | "failed";
  }>({ list, rows: NOTHING });
  const current = selection.list === list ? selection : { list, rows: NOTHING };
  const selected = current.rows;
  const clearSelection = () => setSelection({ list, rows: NOTHING });
  const selectable = (r: T) => bulk?.when?.(r) ?? true;
  const toRow = (r: T): BulkRow => ({
    id: rowKey(r),
    name: bulk?.name(r) ?? "",
    archived: !!(r as { archivedAt?: string | null }).archivedAt,
  });

  const selectAll = async () => {
    if (!bulk || current.status === "busy") return;
    setSelection({ ...current, status: "busy" });
    // Ignored if the list changes meanwhile: the result would be some other list's rows.
    const finish = (next: Omit<typeof selection, "list">) =>
      setSelection((s) => (s.list === list ? { list, ...next } : s));
    try {
      const found = await allRows<T>(
        BULK_ITEMS[bulk.kind].path,
        { ...query, ...server?.scope },
        rowKey,
      );
      // Anything but the table's own count means these aren't the rows it shows.
      if (found.length !== server?.total) throw new Error("list changed");
      const rows = found.filter(selectable).map(toRow);
      finish({ rows: new Map(rows.map((r) => [r.id, r])), full: rows.length });
    } catch {
      finish({ rows: selected, full: current.full, status: "failed" });
      void qc.invalidateQueries();
    }
  };
  const toggle = (r: T) => {
    const rows = new Map(selected);
    if (!rows.delete(rowKey(r))) rows.set(rowKey(r), toRow(r));
    setSelection({ list, rows, full: current.full });
  };
  const onPage = sorted.filter(selectable);
  const allSelected =
    !!selected.size &&
    (selected.size === current.full ||
      (sorted.length === total && onPage.every((r) => selected.has(rowKey(r)))));
  const shown: Column<T>[] = bulk
    ? [
        {
          id: "select",
          header: t("common:bulk.selectAll"),
          headerCell: (
            <input
              type="checkbox"
              aria-label={t("common:bulk.selectAll")}
              title={t("common:bulk.selectAll")}
              disabled={!total}
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = !!selected.size && !allSelected;
              }}
              onChange={(e) => (e.target.checked ? void selectAll() : clearSelection())}
            />
          ),
          cell: (r) => (
            <input
              type="checkbox"
              aria-label={t("common:bulk.select", { name: bulk.name(r) })}
              disabled={!selectable(r)}
              checked={selected.has(rowKey(r))}
              onChange={() => toggle(r)}
            />
          ),
        },
        ...columns,
      ]
    : columns;
  // A row on this page is as it is now; one on another page as it was when selected.
  const onScreen = new Map(sorted.map((r) => [rowKey(r), r]));
  const bulkRows = [...selected.values()].map((s) => {
    const row = onScreen.get(s.id);
    return row ? toRow(row) : s;
  });

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {server?.archivable && (
        <ShowArchived
          className="self-end"
          checked={server.query.archived === "all"}
          onChange={(on) => update({ archived: on ? "all" : "" })}
        />
      )}
      {/* Scrollable on narrow screens, so it must be keyboard-focusable (and named) to be reachable. */}
      <section
        aria-label={label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: scroll container needs keyboard access
        tabIndex={0}
        className="relative overflow-x-auto rounded-lg border border-border bg-surface"
      >
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-b border-border bg-surface-2 text-muted">
              {shown.map((c) => {
                const s = sortOf(c);
                const Arrow = s?.dir === -1 ? ArrowDown : ArrowUp;
                const key = filterKey(c, !!server);
                const spec: ColumnFilter | undefined = !key
                  ? undefined
                  : server
                    ? server.filters?.[key]
                    : { kind: c.numeric ? "number" : c.filterOptions ? "select" : "text" };
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
                      {c.headerCell ??
                        (s ? (
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
                        ))}
                      {key && spec && (
                        <ColumnFilterButton
                          column={c}
                          spec={spec}
                          value={query[key] ?? ""}
                          onChange={(v) => update({ [key]: v })}
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
                {shown.map((c) => (
                  <td
                    key={c.id}
                    className={cx(
                      "whitespace-nowrap px-3 [&_a]:inline-flex [&_a]:min-h-6 [&_a]:items-center",
                      c.numeric && "text-right",
                    )}
                  >
                    {c === markColumn &&
                    c.archivedMark !== "own" &&
                    (row as { archivedAt?: string | null }).archivedAt ? (
                      <span className="inline-flex items-center gap-2">
                        {c.cell(row)}
                        <ArchivedBadge />
                      </span>
                    ) : (
                      c.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {!sorted.length && (
              <tr>
                <td colSpan={shown.length} className="h-16 text-center text-muted">
                  {t("common:table.noRows")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      {bulk && (
        <BulkBar
          kind={bulk.kind}
          rows={bulkRows}
          onClear={clearSelection}
          onDone={(blocked) => {
            const kept = new Set(blocked);
            setSelection({
              list,
              rows: new Map([...selected].filter(([id]) => kept.has(id))),
            });
            // The page it was on may be gone.
            if (query.page) update({});
          }}
        />
      )}
      {current.status === "busy" && (
        <p role="status" className="text-muted">
          {t("common:bulk.selecting", { count: total })}
        </p>
      )}
      {current.status === "failed" && (
        <p role="alert" className="text-bad">
          {t("common:bulk.selectFailed")}
        </p>
      )}
      {(server || total > 10 || hasFilters) && (
        <Pager
          query={query}
          total={total}
          onChange={update}
          onClear={
            hasFilters
              ? () => {
                  const { pageSize, sort, archived } = query;
                  setQuery({
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

/** The "Show archived" switch. DataTable renders it for an `archivable` list; grids reuse it. */
export function ShowArchived({
  checked,
  onChange,
  className,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <label className={cx("flex min-h-9 items-center gap-2", className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {t("common:table.showArchived")}
    </label>
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
        <Combobox
          className={`${inputClass} w-auto!`}
          value={String(pageSize)}
          onChange={(v) => onChange({ pageSize: v })}
          options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
        />
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
  const [q, setQ] = useState("");
  const checkboxes = (from: Element) => [
    ...(from
      .closest("form")
      ?.querySelectorAll<HTMLInputElement>("fieldset label:not([hidden]) input") ?? []),
  ];

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
          setQ("");
          const anchor = document.querySelector(`[popovertarget="${id}"]`);
          if (anchor) placePopover(anchor, e.currentTarget);
        }}
        className="fixed w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-surface p-3 text-left font-normal text-fg shadow-lg backdrop:bg-black/20"
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
            <>
              <input
                type="search"
                aria-label={t("common:table.searchOptions", { column: column.header })}
                placeholder={t("common:table.searchOptions", { column: column.header })}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    checkboxes(e.currentTarget)[0]?.focus();
                  }
                }}
                className={inputClass}
              />
              {/* Non-matches are hidden, not unmounted, so their checked state still reaches FormData. */}
              <fieldset
                className="flex max-h-60 flex-col gap-1 overflow-y-auto"
                onKeyDown={(e) => {
                  const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
                  if (!d || !(e.target instanceof HTMLInputElement)) return;
                  e.preventDefault();
                  const boxes = checkboxes(e.currentTarget);
                  const next = boxes[boxes.indexOf(e.target) + d];
                  if (next) next.focus();
                  else if (d < 0) e.currentTarget.parentElement?.querySelector("input")?.focus();
                }}
              >
                <legend className="sr-only">{column.header}</legend>
                {options.map((o) => (
                  <label
                    key={o.value}
                    hidden={!o.label.toLowerCase().includes(q.trim().toLowerCase())}
                    className="flex min-h-8 items-center gap-2 [[hidden]]:hidden"
                  >
                    <input
                      type="checkbox"
                      name="v"
                      value={o.value}
                      defaultChecked={selected.includes(o.value)}
                    />
                    {o.label}
                  </label>
                ))}
                {!options.some((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) && (
                  <p role="status" className="text-muted">
                    {t("common:picker.none")}
                  </p>
                )}
              </fieldset>
            </>
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
