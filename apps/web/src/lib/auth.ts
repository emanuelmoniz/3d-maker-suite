import type { Me, MeUpdate, SetupInput, UserLoginInput } from "@3d-maker-suite/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

/** `user` is null while no accounts exist: every page works as before. */
export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: () => api<Me>("GET", "/api/auth/me"),
  staleTime: Number.POSITIVE_INFINITY,
});

export const useMe = () => useQuery(meQuery).data?.user;

/** The caller's role; the no-users mode counts as admin. Undefined while loading. */
export const useRole = () => {
  const { data } = useQuery(meQuery);
  return data && (data.user?.role ?? "admin");
};

/** Whether the role may change data (`write`: editor, admin) or manage the server (`admin`). The server enforces the same; this only hides buttons. */
export function useCan(level: "write" | "admin") {
  const role = useRole();
  if (!role) return false;
  return level === "write" ? role !== "viewer" : role === "admin";
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
