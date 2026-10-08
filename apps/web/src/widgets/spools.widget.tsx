import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { filamentLabel, useProfiles, useSpools } from "../lib/filament.ts";
import { formatWeight } from "../lib/format.ts";
import { usePreferences } from "../lib/preferences.ts";
import { defineWidget } from "./registry.ts";
import { WidgetCard } from "./Widget.tsx";

defineWidget({
  type: "lowSpools",
  title: "dashboard:widgets.lowSpools",
  span: 2,
  settings: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
  fields: [{ key: "limit", label: "dashboard:fields.limit", kind: "number", min: 1, max: 20 }],
  Component: function LowSpoolsWidget({ settings: s }) {
    const { t } = useTranslation();
    const threshold = usePreferences().data?.values.lowSpoolGrams ?? 0;
    const profiles = useProfiles().data?.items ?? [];
    const low = (useSpools().data?.items ?? [])
      .filter((x) => !x.archivedAt && x.status !== "empty" && x.remainingGrams <= threshold)
      .sort((a, b) => a.remainingGrams - b.remainingGrams);
    return (
      <WidgetCard
        title={t("dashboard:widgets.lowSpools")}
        more={
          <Link to="/filament" className="text-accent hover:underline">
            {t("dashboard:viewAll")}
          </Link>
        }
      >
        {low.length ? (
          <ul className="divide-y divide-border">
            {low.slice(0, s.limit).map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 py-2">
                <Link
                  to="/filament/spools/$id"
                  params={{ id: x.id }}
                  className="flex items-center gap-2 font-medium hover:underline"
                >
                  <span
                    aria-hidden
                    className="size-3 rounded-full border border-border"
                    style={{ background: x.colorHex }}
                  />
                  {filamentLabel(profiles.find((p) => p.id === x.profileId))}
                </Link>
                <span className="text-warn">{formatWeight(x.remainingGrams)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t("dashboard:spoolsNone")}</p>
        )}
      </WidgetCard>
    );
  },
});
