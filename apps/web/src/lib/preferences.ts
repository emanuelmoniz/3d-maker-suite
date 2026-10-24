import type { Preferences, PreferencesPatch } from "@3d-maker-suite/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

type Response = { values: Preferences; dataDir: string };

const request = (method: "GET" | "PATCH", body?: PreferencesPatch) =>
  api<Response>(method, "/api/preferences", body);

export const preferencesQuery = queryOptions({
  queryKey: ["preferences"],
  queryFn: () => request("GET"),
});

export const usePreferences = () => useQuery(preferencesQuery);

export function useSavePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: PreferencesPatch) => request("PATCH", patch),
    onSuccess: (data) => qc.setQueryData(preferencesQuery.queryKey, data),
  });
}
