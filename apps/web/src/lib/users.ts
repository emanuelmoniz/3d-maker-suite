import type { User, UserCreateInput, UserPatch } from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

const KEY = ["users"];

export const useUsers = (enabled: boolean) =>
  useQuery({ queryKey: KEY, queryFn: () => api<User[]>("GET", "/api/users"), enabled });

export function useUserActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  return {
    create: useMutation({
      mutationFn: (body: UserCreateInput) => api<User>("POST", "/api/users", body),
      onSuccess: refresh,
    }),
    patch: useMutation({
      mutationFn: ({ id, ...body }: UserPatch & { id: string }) =>
        api<User>("PATCH", `/api/users/${id}`, body),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api("DELETE", `/api/users/${id}`),
      onSuccess: refresh,
    }),
  };
}
