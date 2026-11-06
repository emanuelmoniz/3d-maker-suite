import type { ImportEntity } from "@3d-maker-suite/core";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../../components/PageHeader.tsx";
import { meQuery, useCan } from "../../lib/auth.ts";
import { CATALOG_ENTITIES, ENTITIES } from "../import/entities.ts";
import { ImportFlow } from "../import/ImportFlow.tsx";

/** Upload, review and import of one catalog type. Back returns to the tab it was opened from. */
export function CatalogImportPage() {
  const { t } = useTranslation();
  const { entity } = useParams({ strict: false }) as { entity: ImportEntity };
  const allowed = useCan("catalog", "manage");
  const loaded = !!useQuery(meQuery).data;
  if (!loaded) return null;
  if (!CATALOG_ENTITIES.includes(entity)) return <Navigate to="/catalog/printers" replace />;
  const tab = ENTITIES[entity].to as "/catalog/printers" | "/catalog/filament";
  return (
    <>
      <PageHeader
        title={t("catalog:transfer.title", { name: t(ENTITIES[entity].label) })}
        description={t("catalog:transfer.description")}
        backTo={{ to: tab }}
      />
      {allowed ? (
        <div className="grid max-w-5xl gap-4">
          <ImportFlow entity={entity} />
        </div>
      ) : (
        <Navigate to={tab} replace />
      )}
    </>
  );
}
