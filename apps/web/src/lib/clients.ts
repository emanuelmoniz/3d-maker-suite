import type { Client, ClientInput, ClientPatch } from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListQuery } from "../components/DataTable.tsx";
import { api } from "./api.ts";
import { useListPage } from "./list.ts";

export const useClients = (query: ListQuery) =>
  useListPage<Client>(["clients", "list"], "/api/clients", query);

export const useClient = (id: string) =>
  useQuery({
    queryKey: ["clients", id],
    queryFn: () => api<Client>("GET", `/api/clients/${id}`),
    enabled: !!id,
  });

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("DELETE", `/api/clients/${id}`),
    // Quotes too: a deleted client is cleared from them.
    onSuccess: (_, id) => {
      // Not refetched: it would 404.
      qc.removeQueries({ queryKey: ["clients", id] });
      return Promise.all([
        qc.invalidateQueries({ queryKey: ["clients", "list"] }),
        qc.invalidateQueries({ queryKey: ["quotes"] }),
      ]);
    },
  });
}

/** Create (no `id`) or patch, then refresh everything client-related. */
export function useSaveClient(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ClientInput & ClientPatch) =>
      id ? api<Client>("PATCH", `/api/clients/${id}`, v) : api<Client>("POST", "/api/clients", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });
}
