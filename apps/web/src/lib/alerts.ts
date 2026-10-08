import type { Alert, ChannelInput, ChannelSettings } from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

const ALERTS = ["alerts"];

export const useAlerts = () =>
  useQuery({
    queryKey: ALERTS,
    queryFn: () => api<Alert[]>("GET", "/api/alerts"),
    refetchInterval: 60_000,
  });

/** What the badge counts: alerts nobody has looked at, not snoozed. */
export const unreadCount = (alerts: Alert[] | undefined, now = Date.now()) =>
  (alerts ?? []).filter((a) => !a.readAt && !(a.snoozedUntil && Date.parse(a.snoozedUntil) > now))
    .length;

export function useAlertAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; action: "read" | "dismiss" | { snooze: number } }) =>
      api("PATCH", `/api/alerts/${v.id}`, {
        action: typeof v.action === "string" ? v.action : "snooze",
        days: typeof v.action === "string" ? undefined : v.action.snooze,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ALERTS }),
  });
}

export const useChannels = () =>
  useQuery({
    queryKey: ["alerts", "channels"],
    queryFn: () => api<ChannelSettings[]>("GET", "/api/alerts/channels"),
  });

export function useSaveChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: ChannelInput }) =>
      api("PUT", `/api/alerts/channels/${v.id}`, v.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts", "channels"] }),
  });
}

export const useTestChannel = () =>
  useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>("POST", `/api/alerts/channels/${id}/test`),
  });
