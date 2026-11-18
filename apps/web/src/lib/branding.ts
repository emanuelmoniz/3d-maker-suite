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

export type PublicBranding = { appName: string; showName: boolean; logo: number | null };

/** Readable without a session: the sign-in page. Errors and loading both fall back to the defaults. */
export const usePublicBranding = () =>
  useQuery({
    queryKey: ["branding", "public"],
    queryFn: () => api<PublicBranding>("GET", "/api/branding/public"),
    retry: false,
  });

/**
 * Which mark the app shows, one rule for the sidebar, the sign-in card and the connector page
 * (which has its own copy in `apps/connector/src/status.ts`, keep them in step):
 * an uploaded logo always shows, with the name or alone; without one, icon + name, or the
 * horizontal logo when the name is hidden.
 */
export function brandMark({ logo, showName }: { logo: unknown; showName: boolean }) {
  if (logo) return showName ? "logo+name" : "logo";
  return showName ? "icon+name" : "wordmark";
}

/** Custom name, falling back to the translated default. */
export function useAppName() {
  const { t } = useTranslation();
  return usePreferences().data?.values.appName || t("common:appName");
}

export function useSaveBranding(kind: BrandingKind) {
  const qc = useQueryClient();
  const done = (data?: Branding) => {
    qc.setQueryData(["branding"], data ?? undefined);
    void qc.invalidateQueries({ queryKey: ["branding", "public"] });
  };
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
    link.href = favicon ?? "/icon.svg";
  }, [favicon]);
}
