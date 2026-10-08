import type { Preferences, PreferencesPatch } from "@3d-maker-suite/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type Response = { values: Preferences; dataDir: string };

async function request(method: "GET" | "PATCH", body?: PreferencesPatch): Promise<Response> {
  const res = await fetch("/api/preferences", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`preferences ${method} failed: ${res.status}`);
  return res.json();
}

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
