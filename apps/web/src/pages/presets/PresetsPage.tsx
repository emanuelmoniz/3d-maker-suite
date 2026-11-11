import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SettingsLink } from "../../components/SettingsLink.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { meQuery, useCan } from "../../lib/auth.ts";
import { PresetsHint } from "./PresetsHint.tsx";
import { FilamentPresets, MachinePresets, ProcessPresets } from "./PresetTables.tsx";

export const PRESET_TABS = ["printer", "process", "filament"] as const;
export type PresetTab = (typeof PRESET_TABS)[number];

// Written out so `pnpm i18n:check` sees the keys.
const INTRO = {
  printer: "catalog:presetIntro.printer",
  process: "catalog:presetIntro.process",
  filament: "catalog:presetIntro.filament",
} as const;
const TABLE = { printer: MachinePresets, process: ProcessPresets, filament: FilamentPresets };

/** The slicer presets (ADR-0021), one tab per kind. Needs `presets` read. */
export function PresetsPage({ tab }: { tab: PresetTab }) {
  const { t } = useTranslation();
  const allowed = useCan("catalog", "read");
  if (!useQuery(meQuery).data) return null;
  if (!allowed) return <Navigate to="/" replace />;
  const Table = TABLE[tab];
  return (
    <>
      <PageHeader
        title={t("nav:items.presets.label")}
        description={t("nav:items.presets.description")}
        actions={<SettingsLink module="presets" />}
      />
      <Tabs
        label={t("catalog:presetTabs.label")}
        items={[
          { to: "/presets/printer", label: t("catalog:presetTabs.printer") },
          { to: "/presets/process", label: t("catalog:presetTabs.process") },
          { to: "/presets/filament", label: t("catalog:presetTabs.filament") },
        ]}
      />
      <p className="mb-8 max-w-prose text-muted">{t(INTRO[tab])}</p>
      <div className="grid gap-10">
        <Table />
        <PresetsHint />
      </div>
    </>
  );
}
