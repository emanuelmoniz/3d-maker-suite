import type { Stats, StatsQuery } from "@3d-maker-suite/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";

/** Filters as the page holds them: one id per filter, "" for all, dates as yyyy-mm-dd. */
export type StatsFilters = {
  from: string;
  to: string;
  printerId: string;
  spoolId: string;
  profileId: string;
  projectId: string;
  tagId: string;
  outcome: string;
  bucket: StatsQuery["bucket"];
};

export const statsQs = (f: StatsFilters) =>
  new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();

export const useStats = (f: StatsFilters) =>
  useQuery({
    queryKey: ["stats", f],
    queryFn: () => api<Stats>("GET", `/api/stats?${statsQs(f)}`),
    placeholderData: keepPreviousData,
  });
