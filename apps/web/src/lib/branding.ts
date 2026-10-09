import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api.ts";
import { usePreferences } from "./preferences.ts";

export type BrandingKind = "logo" | "favicon";
type Branding = Record<BrandingKind, number | null>;

const useBranding = () =>
  useQuery({ queryKey: ["branding"], queryFn: () => api<Branding>("GET", "/api/branding") });

/** URL of the custom image (cache-busted by its version), or undefined when none is set. */
export const useBrandingUrl = (kind: BrandingKind) => {
  const v = useBranding().data?.[kind];
  return v == null ? undefined : `/api/branding/${kind}?v=${v}`;
};

/** Custom name, falling back to the translated default. */
export function useAppName() {
  const { t } = useTranslation();
  return usePreferences().data?.values.appName || t("common:appName");
}

export function useSaveBranding(kind: BrandingKind) {
  const qc = useQueryClient();
  const done = (data?: Branding) => qc.setQueryData(["branding"], data ?? undefined);
  return {
    upload: useMutation({
      mutationFn: (file: File) => api<Branding>("PUT", `/api/branding/${kind}`, file),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: () => api("DELETE", `/api/branding/${kind}`),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["branding"] }),
    }),
  };
}

/** Keeps the tab title and favicon in sync with the saved branding. */
export function useApplyBranding() {
  const name = useAppName();
  const favicon = useBrandingUrl("favicon");
  useEffect(() => {
    document.title = name;
  }, [name]);
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    link.removeAttribute("type");
    link.href = favicon ?? "data:,";
  }, [favicon]);
}
