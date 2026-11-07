import type { Integration, LibrarySources } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useCan } from "../../lib/auth.ts";
import {
  useAdapterName,
  useAdapters,
  useIntegrations,
  useLocationLabel,
  useSyncIntegration,
} from "../../lib/integrations.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useCatalogSources, usePickCatalogSource } from "../../lib/presets.ts";
import { ProfilesFromZip } from "../settings/ManagedSlicer.tsx";
import { Policies } from "../settings/PolicyRow.tsx";
import { DeviceSlicers } from "./DeviceSlicers.tsx";

/** One integration's import cards of a part, with its sync. */
function Cards({
  integration,
  part,
}: {
  integration: Integration;
  part: "catalog" | "userPresets";
}) {
  const sync = useSyncIntegration(integration.id);
  return <Policies integration={integration} sync={sync} part={part} />;
}

const optionValue = (o: { integrationId?: string; deviceId?: string }) =>
  o.integrationId ? `i:${o.integrationId}` : `d:${o.deviceId}`;

/** Where the library's system catalog comes from, and its Catalog and System presets cards. */
function CatalogSource({ lib, rows }: { lib: LibrarySources; rows: Integration[] }) {
  const { t } = useTranslation();
  const locationLabel = useLocationLabel();
  const manage = useCan("catalog", "manage");
  const pick = usePickCatalogSource();
  const byId = (id: string) => rows.find((i) => i.id === id);
  const label = (o: LibrarySources["options"][number]) =>
    "deviceId" in o
      ? t("catalog:sources.source.device", { name: o.name })
      : o.readable
        ? locationLabel(byId(o.integrationId) ?? { kind: "local", deviceName: null })
        : t("catalog:sources.source.unreadable", {
            name: locationLabel(byId(o.integrationId) ?? { kind: "local", deviceName: null }),
          });
  const current =
    lib.source && lib.options.find((o) => optionValue(o) === optionValue(lib.source ?? {}));
  const cards = lib.cardsOf ? byId(lib.cardsOf) : undefined;
  const id = `source-${lib.library}`;
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <h3 id={id} className="font-semibold">
        {t("catalog:sources.source.title")}
      </h3>
      <p className="max-w-prose text-muted">{t("catalog:sources.source.hint")}</p>
      {manage && lib.options.length > 0 ? (
        <label className="grid max-w-sm gap-1">
          <span className="text-sm font-medium">{t("catalog:sources.source.label")}</span>
          <select
            className="min-h-10 rounded-md border border-border bg-surface px-3"
            value={current ? optionValue(current) : ""}
            disabled={pick.isPending}
            onChange={(e) => {
              const [kind, value] = [e.target.value.slice(0, 1), e.target.value.slice(2)];
              pick.mutate({
                library: lib.library,
                pick: kind === "i" ? { integrationId: value } : { deviceId: value },
              });
            }}
          >
            {!current && <option value="">{t("catalog:sources.source.none")}</option>}
            {lib.options.map((o) => (
              <option key={optionValue(o)} value={optionValue(o)}>
                {label(o)}
              </option>
            ))}
          </select>
          {lib.source && !lib.source.picked && (
            <span className="text-sm text-muted">{t("catalog:sources.source.default")}</span>
          )}
        </label>
      ) : (
        <p>
          {current
            ? t(
                lib.source?.picked
                  ? "catalog:sources.source.is"
                  : "catalog:sources.source.isDefault",
                { name: label(current) },
              )
            : t("catalog:sources.source.none")}
        </p>
      )}
      {pick.isError && (
        <p role="alert" className="text-bad">
          {t("hub:errors.generic")}
        </p>
      )}
      {lib.source && "deviceId" in lib.source && (
        <p className="max-w-prose text-muted">{t("catalog:sources.source.fromDevice")}</p>
      )}
      {cards && <Cards integration={cards} part="catalog" />}
    </section>
  );
}

/**
 * Catalog → Sources: what fills the catalog, per slicer library (ADR-0020). Its catalog source,
 * the routes its user presets take, the zip for a slicer with no folder of yours, and with the
 * hub on, each device's Send presets and Install.
 */
export function SourcesTab() {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const locationLabel = useLocationLabel();
  const adapters = useAdapters().data ?? [];
  const admin = useCan("integrations.manage");
  const devices = useCan("catalog", "write") && !!usePreferences().data?.values.hubEnabled;
  const list = useIntegrations().data;
  const libraries = useCatalogSources().data;
  if (!list || !libraries) return null;
  if (!libraries.length)
    return (
      <p className="text-muted">
        {t("catalog:sources.empty")}{" "}
        <Link to="/integrations" className="underline">
          {t("catalog:sources.toIntegrations")}
        </Link>
      </p>
    );
  return libraries.map((lib) => {
    const name = adapterName(lib.library);
    const routes = lib.routes.flatMap((r) => list.find((i) => i.id === r.integrationId) ?? []);
    const count = (id: string) => lib.routes.find((r) => r.integrationId === id)?.presets ?? 0;
    // A server slicer or a worker has no folder of yours to read: a zip brings your presets.
    const zip =
      admin &&
      routes.some((i) => i.kind === "server" || i.kind === "worker") &&
      adapters.find((a) => a.libraryId === lib.library);
    return (
      <section
        key={lib.library}
        id={`library-${lib.library}`}
        aria-labelledby={`sources-${lib.library}`}
        className="grid scroll-mt-4 gap-8"
      >
        <h2 id={`sources-${lib.library}`} className="text-lg font-semibold">
          {name}
        </h2>
        <CatalogSource lib={lib} rows={list} />
        {routes.length > 0 && (
          <section aria-labelledby={`routes-${lib.library}`} className="grid gap-4">
            <div className="grid gap-1">
              <h3 id={`routes-${lib.library}`} className="font-semibold">
                {t("catalog:sources.routes.title")}
              </h3>
              <p className="max-w-prose text-muted">{t("catalog:sources.routes.hint")}</p>
            </div>
            {routes.map((i) => (
              <section key={i.id} aria-labelledby={`route-${i.id}`} className="grid gap-3">
                <h4 id={`route-${i.id}`} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">
                    {i.kind === "cloud" ? adapterName(i.adapterId) : locationLabel(i)}
                  </span>
                  <span className="text-sm text-muted">
                    {t("catalog:sources.routes.presets", { count: count(i.id) })}
                  </span>
                </h4>
                <Cards integration={i} part="userPresets" />
              </section>
            ))}
          </section>
        )}
        {zip && (
          <section aria-labelledby={`zip-${lib.library}`} className="grid gap-3">
            <h3 id={`zip-${lib.library}`} className="font-semibold">
              {t("catalog:sources.zip")}
            </h3>
            <ProfilesFromZip libraryId={lib.library} />
          </section>
        )}
        {devices && <DeviceSlicers library={lib.library} slicer={name} />}
      </section>
    );
  });
}
