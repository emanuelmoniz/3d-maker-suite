import { useQuery, useQueryClient } from "@tanstack/react-query";

/** What the shell overlay says while the server is away; null = no overlay. */
export type ServerState =
  | { kind: "stopped" }
  | { kind: "restarting"; url: string; timedOut: boolean }
  | { kind: "updating"; phase: "preparing" | "installing" | "slow" };

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
  return (s: ServerState | null) => qc.setQueryData(KEY, s);
}
