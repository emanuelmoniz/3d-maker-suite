import {
  type Delivery,
  type DeliveryInput,
  type EffectiveRights,
  exceeds,
  type Role,
  type RoleCreateInput,
  type RolePatch,
  type User,
  type UserCreateInput,
  type UserPatch,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import { useCan } from "./auth.ts";
import { usePreferences } from "./preferences.ts";

/** Users | Roles: users.manage, unless the accounts switch is off. */
export const useUsersShown = () => {
  const on = usePreferences().data?.values.accountsEnabled ?? true;
  return useCan("users.manage") && on;
};

const KEY = ["users"];
const ROLES = ["roles"];

/**
 * Whether the editing user may give someone this role (ADR-0016): an enabled role, and outside
 * the Admin role not the Admin role nor one with more than they have.
 */
export const mayAssign = (own: EffectiveRights | undefined, r: Role) =>
  !r.disabled && (!!own?.admin || (!!own && r.builtIn !== "admin" && !exceeds(own, r).length));

export const useUsers = (enabled: boolean) =>
  useQuery({ queryKey: KEY, queryFn: () => api<User[]>("GET", "/api/users"), enabled });

/** The roles (ADR-0016), with their users count. */
export const useRoles = (enabled: boolean) =>
  useQuery({ queryKey: ROLES, queryFn: () => api<Role[]>("GET", "/api/roles"), enabled });

export function useUserActions() {
  const qc = useQueryClient();
  // A role's users count follows its users.
  const refresh = () => Promise.all([KEY, ROLES].map((k) => qc.invalidateQueries({ queryKey: k })));
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

export function useRoleActions() {
  const qc = useQueryClient();
  // Rights are read per request; `me` too, in case the role is the caller's own.
  const refresh = () =>
    Promise.all([ROLES, ["me"]].map((k) => qc.invalidateQueries({ queryKey: k })));
  return {
    create: useMutation({
      mutationFn: (body: RoleCreateInput) => api<Role>("POST", "/api/roles", body),
      onSuccess: refresh,
    }),
    patch: useMutation({
      mutationFn: ({ id, ...body }: RolePatch & { id: string }) =>
        api<Role>("PATCH", `/api/roles/${id}`, body),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api("DELETE", `/api/roles/${id}`),
      onSuccess: refresh,
    }),
  };
}

const DELIVERY = ["delivery"];

/** Where my notify alerts go (ADR-0016); `userId` = another user's, for an admin. */
export const useDelivery = (userId?: string) =>
  useQuery({
    queryKey: [...DELIVERY, userId],
    queryFn: () =>
      api<Delivery>("GET", userId ? `/api/users/${userId}/delivery` : "/api/auth/me/delivery"),
  });

export function useSaveDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DeliveryInput) => api<Delivery>("PATCH", "/api/auth/me/delivery", body),
    onSuccess: (d) => qc.setQueryData([...DELIVERY, undefined], d),
  });
}

export const useTestDelivery = () =>
  useMutation({
    mutationFn: () => api<{ channel: string; ok: boolean }[]>("POST", "/api/auth/me/delivery/test"),
  });
