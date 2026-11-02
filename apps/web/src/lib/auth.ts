import type {
  EffectiveRights,
  Me,
  MeUpdate,
  SetupInput,
  UserLoginInput,
} from "@3d-maker-suite/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

/** `user` is null while no accounts exist: every page works as before. */
export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: () => api<Me>("GET", "/api/auth/me"),
  staleTime: Number.POSITIVE_INFINITY,
});

export const useMe = () => useQuery(meQuery).data?.user;

/** The caller's effective rights (ADR-0016); the no-users mode has the Admin role's. Undefined while loading. */
export const useRights = (): EffectiveRights | undefined => useQuery(meQuery).data;

/** The caller's role (name and built-in kind); null in the no-users mode. */
export const useMyRole = () => useQuery(meQuery).data?.role;

/**
 * Whether the caller may change data (`write`: any write permission) or is in the Admin role
 * (`admin`). The server enforces the real rules; this only hides buttons.
 */
export function useCan(level: "write" | "admin") {
  const r = useRights();
  if (!r) return false;
  return (
    r.admin ||
    (level === "write" &&
      Object.values(r.permissions).some((v) => v === true || v === "write" || v === "manage"))
  );
}

// A full load after each of these: preferences and every cached query belong to one person.
const reload = (to: string) => window.location.assign(to);

export const useLogin = (next: string) =>
  useMutation({
    mutationFn: (body: UserLoginInput) => api("POST", "/api/auth/login", body),
    onSuccess: () => reload(next),
  });

export const useSetup = () =>
  useMutation({
    mutationFn: (body: SetupInput) => api("POST", "/api/auth/setup", body),
    onSuccess: () => reload("/"),
  });

export const useSignOut = () =>
  useMutation({
    mutationFn: () => api("POST", "/api/auth/logout"),
    onSuccess: () => reload("/login"),
  });

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MeUpdate) => api<Me>("PATCH", "/api/auth/me", body),
    onSuccess: (me) => qc.setQueryData(meQuery.queryKey, me),
  });
}

/** Only an in-app path; anything else (`//evil.test`, `https:`) falls back to home. */
export const safeNext = (next: unknown) =>
  typeof next === "string" && next.startsWith("/") && !/^\/[/\\]/.test(next) ? next : "/";
