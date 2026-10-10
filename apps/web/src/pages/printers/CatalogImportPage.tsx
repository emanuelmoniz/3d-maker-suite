import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { type CatalogType, useCatalogImport, useCatalogPreview } from "../../lib/slicerCatalog.ts";

const KIND = {
  brand: "integrations:catalogImport.kinds.brand",
  model: "integrations:catalogImport.kinds.model",
  machine: "integrations:catalogImport.kinds.machine",
  filamentBrand: "integrations:catalogImport.kinds.filamentBrand",
  material: "integrations:catalogImport.kinds.material",
  filamentProfile: "integrations:catalogImport.kinds.filamentProfile",
} as const;
const STATUS = {
  new: "integrations:catalogImport.statuses.new",
  imported: "integrations:catalogImport.statuses.imported",
  changed: "integrations:catalogImport.statuses.changed",
} as const;
const TITLE = {
  brands: "integrations:capabilities.brands",
  printerModels: "integrations:capabilities.printerModels",
  machineProfiles: "integrations:capabilities.machineProfiles",
  filamentBrands: "integrations:capabilities.filamentBrands",
  filamentProfiles: "integrations:capabilities.filamentProfiles",
} as const;
// Where to go after the import.
const BACK = {
  brands: "/printers",
  printerModels: "/printers",
  machineProfiles: "/printers",
  filamentBrands: "/filament",
  filamentProfiles: "/filament",
} as const;

/** Preview -> confirm for one catalog type of one slicer integration, or of an uploaded zip. */
export function CatalogImportPage({ zip = false }: { zip?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id, type } = useParams({ strict: false }) as { id: string; type: CatalogType };
  const base = zip ? "slicer-zip" : "slicer-catalog";
  // A zip import goes back to the zip, where the other types wait.
  const back = zip ? `/import/slicer-zip/${id}` : BACK[type];
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const preview = useCatalogPreview(id, type, base);
  const run = useCatalogImport(id, type, base);

  const items = preview.data?.items ?? [];
  const importable = (s: string) => s !== "imported";
  const picked = items.filter((i) => importable(i.status) && !unchecked.has(i.key));
  const toggle = (key: string) =>
    setUnchecked((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <>
      <PageHeader
        title={t(TITLE[type])}
        description={t("integrations:catalogImport.description")}
      />
      <div className="grid gap-4">
        {preview.isError && (
          <p role="alert" className="text-bad">
            {t(zip ? "import:zip.expired" : "integrations:catalogImport.notFound")}{" "}
            <Link
              to={zip ? "/import/slicer-zip" : "/settings/integrations"}
              className="font-medium underline"
            >
              {t(zip ? "import:zip.again" : "integrations:catalogImport.openIntegrations")}
            </Link>
          </p>
        )}
        {preview.data && (
          <>
            {preview.data.dir && (
              <p className="text-muted">
                {t("integrations:catalogImport.reading", { dir: preview.data.dir })}
              </p>
            )}
            {!items.length ? (
              <EmptyState
                icon={Layers}
                title={t("integrations:catalogImport.emptyTitle")}
                description={t("integrations:catalogImport.emptyBody")}
              />
            ) : (
              <DataTable
                label={t("integrations:catalogImport.table")}
                rows={items}
                rowKey={(i) => i.key}
                columns={[
                  {
                    id: "pick",
                    header: "",
                    cell: (i) => (
                      <input
                        type="checkbox"
                        aria-label={t("integrations:catalogImport.pick", { name: i.label })}
                        disabled={!importable(i.status)}
                        checked={importable(i.status) && !unchecked.has(i.key)}
                        onChange={() => toggle(i.key)}
                      />
                    ),
                  },
                  {
                    id: "name",
                    header: t("integrations:catalogImport.name"),
                    cell: (i) => <span className="font-medium">{i.label}</span>,
                    sortValue: (i) => i.label.toLowerCase(),
                  },
                  {
                    id: "kind",
                    header: t("integrations:catalogImport.kind"),
                    cell: (i) => t(KIND[i.kind]),
                    sortValue: (i) => i.kind,
                  },
                  {
                    id: "status",
                    header: t("integrations:catalogImport.status"),
                    cell: (i) => t(STATUS[i.status]),
                    sortValue: (i) => i.status,
                  },
                ]}
              />
            )}
            {run.isError && (
              <p role="alert" className="text-bad">
                {t("integrations:catalogImport.error")}
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                disabled={!picked.length || run.isPending}
                onClick={() =>
                  run.mutate(
                    { keys: picked.map((i) => i.key) },
                    { onSuccess: () => navigate({ to: back }) },
                  )
                }
              >
                {t("integrations:catalogImport.import", { count: picked.length })}
              </Button>
              <Link to={back} className="text-muted hover:underline">
                {t("common:actions.cancel")}
              </Link>
            </div>
          </>
        )}
      </div>
    </>
  );
}
