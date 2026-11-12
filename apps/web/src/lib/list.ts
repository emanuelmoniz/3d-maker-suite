import type { Page } from "@3d-maker-suite/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ListQuery } from "../components/DataTable.tsx";
import { api } from "./api.ts";
import { useTagsEnabled } from "./tags.ts";

/** One page of a list endpoint. `key` is the invalidation prefix, e.g. ["printers", "list"]. */
export const useListPage = <T>(
  key: readonly unknown[],
  path: string,
  query: ListQuery,
  refetchInterval?: number,
  enabled = true,
) =>
  useQuery({
    queryKey: [...key, query],
    queryFn: () => api<Page<T>>("GET", `${path}?${new URLSearchParams(query)}`),
    placeholderData: keepPreviousData,
    refetchInterval,
    enabled,
  });

/** Every row a list query matches, whatever its page. A row that moves meanwhile counts once. */
export async function allRows<T>(path: string, query: ListQuery, key: (row: T) => string) {
  const rows = new Map<string, T>();
  const pageSize = 100; // the API's largest
  for (let page = 1; ; page++) {
    const params = { ...query, page: String(page), pageSize: String(pageSize) };
    const { items, total } = await api<Page<T>>("GET", `${path}?${new URLSearchParams(params)}`);
    for (const row of items) rows.set(key(row), row);
    if (!items.length || page * pageSize >= total) return [...rows.values()];
  }
}

/** Archived rows keep a list's table, and its "Show archived" switch, up with no active ones. */
export const useHasArchived = (key: readonly unknown[], path: string, filter?: ListQuery) =>
  useListPage(key, path, { ...filter, archived: "true", pageSize: "1" }).data?.total !== 0;

/** A picker's rows plus the value the row already has, which the list leaves out once archived. */
export const withOwn = <T extends { id: string }>(rows: T[], own: T | null | undefined) =>
  own && !rows.some((r) => r.id === own.id) ? [...rows, own] : rows;

/**
 * A table's list query, kept in the URL so a link reproduces the view. `prefix` namespaces
 * the params when a page holds more than one table (e.g. "spools." -> ?spools.page=2).
 */
export function useUrlListQuery(prefix = ""): [ListQuery, (q: ListQuery) => void] {
  const search = useSearch({ strict: false }) as ListQuery;
  const navigate = useNavigate();
  // No prefix: the page's main table, which leaves the prefixed tables' params alone.
  const mine = (k: string) => (prefix ? k.startsWith(prefix) : !k.includes("."));
  const tagsOn = useTagsEnabled();
  const query = Object.fromEntries(
    Object.entries(search)
      .filter(([k]) => mine(k))
      .map(([k, v]) => [k.slice(prefix.length), v])
      // A saved tag filter does nothing while tags are off, or lists stay filtered with no reason.
      .filter(([k]) => tagsOn || k !== "tagId"),
  );
  const setQuery = (q: ListQuery) =>
    navigate({
      to: ".",
      search: {
        ...Object.fromEntries(Object.entries(search).filter(([k]) => !mine(k))),
        ...Object.fromEntries(Object.entries(q).map(([k, v]) => [prefix + k, v])),
      } as never,
      // Filtering and paging don't stack up history entries; Back leaves the list.
      replace: true,
      // The router scrolls to the top on every navigation unless told not to; same page, same spot.
      resetScroll: false,
    });
  return [query, setQuery];
}
