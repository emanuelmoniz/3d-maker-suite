import type { Collection, Tag, TaggableType, Tagging, TagInput } from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api.ts";

export const useTags = () =>
  useQuery({ queryKey: ["tags", "list"], queryFn: () => api<Tag[]>("GET", "/api/tags") });

export const useCollections = () =>
  useQuery({
    queryKey: ["tags", "collections"],
    queryFn: () => api<Collection[]>("GET", "/api/collections"),
  });

export const useTaggings = (type: TaggableType) =>
  useQuery({
    queryKey: ["tags", "taggings", type],
    queryFn: () => api<Tagging[]>("GET", `/api/tags/taggings?entityType=${type}`),
  });

/** `tagsOf(entityId)` -> its tags, for list columns. */
export function useTagsOf(type: TaggableType) {
  const tags = useTags().data ?? [];
  const taggings = useTaggings(type).data ?? [];
  return (entityId: string) =>
    taggings
      .filter((g) => g.entityId === entityId)
      .map((g) => tags.find((t) => t.id === g.tagId))
      .filter((t): t is Tag => !!t);
}

/** Current tag ids of one row (edit forms). `undefined` until loaded. */
export function useTagIds(type: TaggableType, entityId: string | undefined) {
  const { data } = useTaggings(type);
  return data && (entityId ? data.filter((g) => g.entityId === entityId).map((g) => g.tagId) : []);
}

/**
 * Form state for a TagPicker. `persist(id)` saves the picked tags once the row itself is saved
 * (nothing is sent if the picker was never touched).
 */
export function useTagEditor(type: TaggableType, entityId?: string) {
  const saved = useTagIds(type, entityId);
  const [picked, setPicked] = useState<string[] | null>(null);
  const set = useSetTags(type);
  return {
    value: picked ?? saved ?? [],
    onChange: setPicked,
    persist: async (id: string) => {
      if (picked) await set.mutateAsync({ id, tagIds: picked });
    },
  };
}

export const useCreateTag = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: TagInput) => api<Tag>("POST", "/api/tags", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tags"] }),
  });
};

/** Replaces the tags of one row. Call it after the row itself is saved. */
export const useSetTags = (type: TaggableType) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; tagIds: string[] }) =>
      api("PUT", `/api/tags/taggings/${type}/${v.id}`, { tagIds: v.tagIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tags"] }),
  });
};
