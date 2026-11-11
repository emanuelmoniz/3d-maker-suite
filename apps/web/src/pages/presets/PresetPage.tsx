import type {
  FilamentPreset,
  InUseDetails,
  MachinePreset,
  ProcessPreset,
} from "@3d-maker-suite/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { ArchiveActions, ArchivedBadge, Dependents } from "../../components/ArchiveActions.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useCanSettings } from "../../components/SettingsLink.tsx";
import { Write } from "../../components/Write.tsx";
import { api } from "../../lib/api.ts";
import { useModelInfo } from "../../lib/catalog.ts";
import { filamentLabel } from "../../lib/filament.ts";
import { formatNumber } from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { SourceBadge } from "../catalog/sources.tsx";
import { Info } from "../filament/SpoolDetailPage.tsx";
import { AllSettings } from "./AllSettings.tsx";

const KINDS = {
  filament: { path: "/api/filament/presets", back: "/catalog/filament", hash: "filament-presets" },
  machine: { path: "/api/machine-presets", back: "/catalog/printers", hash: "machine-presets" },
  process: { path: "/api/process-presets", back: "/catalog/printers", hash: "process-presets" },
} as const;

type Row = (FilamentPreset | MachinePreset | ProcessPreset) & { source?: string };

function Card({ title, children }: { title: ReactNode; children: ReactNode }) {
  const heading = useId();
  return (
    <section
      aria-labelledby={heading}
      className="rounded-lg border border-border bg-surface p-4 sm:p-5"
    >
      <h2 id={heading} className="mb-3 flex items-center gap-2 text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** What the app uses from the preset, by kind. */
function Fields({ kind, row }: { kind: keyof typeof KINDS; row: Row }) {
  const { t } = useTranslation();
  const info = useModelInfo();
  const none = t("filament:detail.none");
  const mm = (v: number | null) =>
    v === null ? none : t("printers:catalog.mm", { value: formatNumber(v) });
  if (kind === "filament") {
    const p = row as FilamentPreset;
    return (
      <>
        <Info label={t("filament:presets.brand")}>{p.brand || none}</Info>
        <Info label={t("filament:presets.material")}>{p.material}</Info>
        <Info label={t("filament:presets.name")}>{p.name || none}</Info>
        <Info label={t("filament:presets.diameter")}>{formatNumber(p.diameterMm)}</Info>
        <Info label={t("filament:presets.density")}>{formatNumber(p.densityGcm3)}</Info>
        <Info label={t("filament:presets.nozzleTemp")}>{p.nozzleTempC ?? none}</Info>
        <Info label={t("filament:presets.bedTemp")}>{p.bedTempC ?? none}</Info>
      </>
    );
  }
  const p = row as MachinePreset | ProcessPreset;
  return (
    <>
      <Info label={t("printers:catalog.presets.model")}>
        {(p.printerModelId && info.get(p.printerModelId)?.label) || none}
      </Info>
      <Info label={t("printers:catalog.presets.nozzle")}>{mm(p.nozzleDiameterMm)}</Info>
      {"layerHeightMm" in p && (
        <Info label={t("printers:catalog.processPresets.layer")}>{mm(p.layerHeightMm)}</Info>
      )}
    </>
  );
}

/**
 * One preset of any kind (ADR-0020): what the app uses, where it comes from and is used, and every
 * setting of its file. The preset is read-only: it is edited in the slicer.
 */
export function PresetPage({ kind }: { kind: keyof typeof KINDS }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id: string };
  const { path, back, hash } = KINDS[kind];
  const { data: row, isError } = useQuery({
    queryKey: ["catalog-preset", kind, id],
    queryFn: () => api<Row>("GET", `${path}/${id}`),
    // A preset that isn't there won't be in a moment.
    retry: false,
  });
  const hub = !!usePreferences().data?.values.hubEnabled;
  const library = useCanSettings("catalog");
  const use = useQuery({
    queryKey: ["catalog-preset", kind, id, "use"],
    queryFn: () => api<InUseDetails>("GET", `${path}/${id}/use`),
  });

  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("catalog:preset.notFound")}
      </p>
    );
  if (!row) return null;

  const name = kind === "filament" ? filamentLabel(row as FilamentPreset) : row.name;
  const archived = row.archivedAt !== null;
  // A preset from a user preset links to its entry in the library (hub on, Catalog settings).
  const preset = hub && library ? row.sourcePreset?.match(/^([^:]+):user\/(.+)$/) : null;

  return (
    <>
      <PageHeader
        title={name}
        backTo={{ to: back }}
        actions={
          <Write can="catalog" level="manage">
            <ArchiveActions
              path={`${path}/${id}`}
              name={name}
              archived={archived}
              onDeleted={() => navigate({ to: back, hash })}
            />
          </Write>
        }
      />
      <div className="grid gap-4">
        <Card
          title={
            <>
              {t("catalog:preset.details")}
              {archived && <ArchivedBadge />}
            </>
          }
        >
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fields kind={kind} row={row} />
            <Info label={t("filament:detail.source")}>
              <SourceBadge source={row.source} preset />
              {preset && (
                <Link
                  to="/catalog/settings/library"
                  hash={encodeURIComponent(`${preset[1]}:${kind}:${preset[2]}`)}
                  className="mt-1 block font-medium text-accent hover:underline"
                >
                  {t("catalog:preset.openPreset")}
                </Link>
              )}
            </Info>
          </dl>
        </Card>
        <Card title={t("catalog:preset.usedBy")}>
          {use.data?.dependents.length ? (
            <Dependents details={use.data} />
          ) : (
            use.data && <p className="text-muted">{t("catalog:preset.unused")}</p>
          )}
        </Card>
        <Card title={t("catalog:settings.title")}>
          <AllSettings path={`${path}/${id}`} name={name} />
        </Card>
      </div>
    </>
  );
}

export const FilamentPresetPage = () => <PresetPage kind="filament" />;
export const MachinePresetPage = () => <PresetPage kind="machine" />;
export const ProcessPresetPage = () => <PresetPage kind="process" />;
