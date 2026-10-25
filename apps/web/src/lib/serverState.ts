import { useQuery, useQueryClient } from "@tanstack/react-query";

/** What the shell banner says about the server after Stop or Restart; null = nothing. */
export type ServerState =
  | { kind: "stopped" }
  | { kind: "restarting"; url: string; timedOut: boolean };

const KEY = ["server-state"];

export const useServerState = () =>
  useQuery<ServerState | null>({
    queryKey: KEY,
    queryFn: () => null,
    enabled: false,
    initialData: null,
  }).data;

export function useSetServerState() {
  const qc = useQueryClient();
  return (s: ServerState) => qc.setQueryData(KEY, s);
}
