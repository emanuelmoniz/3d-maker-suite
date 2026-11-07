import { type Integration, isCatalogType } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useCan } from "../../lib/auth.ts";
import {
  libraryOf,
  useAdapterName,
  useAdapters,
  useIntegrations,
  useLocationLabel,
  useSyncIntegration,
} from "../../lib/integrations.ts";
import { ProfilesFromZip } from "../settings/ManagedSlicer.tsx";
import { Policies } from "../settings/PolicyRow.tsx";

/** One install's import cards, under where it runs. */
function SourceRow({ integration: i }: { integration: Integration }) {
  const locationLabel = useLocationLabel();
  const sync = useSyncIntegration(i.id);
  return (
    <section aria-labelledby={`source-${i.id}`} className="grid gap-3">
      <h3 id={`source-${i.id}`} className="font-semibold">
        {locationLabel(i)}
      </h3>
      <Policies integration={i} sync={sync} part="catalog" />
    </section>
  );
}

/**
 * Catalog → Sources: what fills the catalog, per slicer library (ADR-0020). For now the import
 * cards that left the Integrations page; Plan 5.4.0 Step 21 adds the routes, the catalog source
 * and the device table.
 */
export function SourcesTab() {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const adapters = useAdapters().data ?? [];
  const admin = useCan("integrations.manage");
  const list = useIntegrations().data;
  const rows = (list ?? []).filter(
    (i) => i.enabled && i.policies.some((p) => isCatalogType(p.type)),
  );
  const libraries = [...new Set(rows.map(libraryOf))];
  if (!list) return null;
  if (!rows.length)
    return (
      <p className="text-muted">
        {t("catalog:sources.empty")}{" "}
        <Link to="/integrations" className="underline">
          {t("catalog:sources.toIntegrations")}
        </Link>
      </p>
    );
  return libraries.map((lib) => {
    const installs = rows.filter((i) => libraryOf(i) === lib);
    // A server slicer or a worker has no folder of yours to read: a zip brings your presets.
    const zip =
      admin &&
      installs.some((i) => i.kind === "server" || i.kind === "worker") &&
      adapters.find((a) => a.libraryId === lib);
    return (
      <section
        key={lib}
        id={`library-${lib}`}
        aria-labelledby={`sources-${lib}`}
        className="grid scroll-mt-4 gap-6"
      >
        <h2 id={`sources-${lib}`} className="text-lg font-semibold">
          {adapterName(lib)}
        </h2>
        {installs.map((i) => (
          <SourceRow key={i.id} integration={i} />
        ))}
        {zip && (
          <section aria-labelledby={`zip-${lib}`} className="grid gap-3">
            <h3 id={`zip-${lib}`} className="font-semibold">
              {t("integrations:managed.profilesTitle")}
            </h3>
            <ProfilesFromZip libraryId={lib} />
          </section>
        )}
      </section>
    );
  });
}
