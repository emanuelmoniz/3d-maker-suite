import type { Page } from "@3d-maker-suite/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ListQuery } from "../components/DataTable.tsx";
import { api } from "./api.ts";

/** One page of a list endpoint. `key` is the invalidation prefix, e.g. ["printers", "list"]. */
export const useListPage = <T>(key: readonly unknown[], path: string, query: ListQuery) =>
  useQuery({
    queryKey: [...key, query],
    queryFn: () => api<Page<T>>("GET", `${path}?${new URLSearchParams(query)}`),
    placeholderData: keepPreviousData,
  });

/**
 * A table's list query, kept in the URL so a link reproduces the view. `prefix` namespaces
 * the params when a page holds more than one table (e.g. "spools." -> ?spools.page=2).
 */
export function useUrlListQuery(prefix = ""): [ListQuery, (q: ListQuery) => void] {
  const search = useSearch({ strict: false }) as ListQuery;
  const navigate = useNavigate();
  const mine = (k: string) => k.startsWith(prefix);
  const query = Object.fromEntries(
    Object.entries(search)
      .filter(([k]) => mine(k))
      .map(([k, v]) => [k.slice(prefix.length), v]),
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
    });
  return [query, setQuery];
}
