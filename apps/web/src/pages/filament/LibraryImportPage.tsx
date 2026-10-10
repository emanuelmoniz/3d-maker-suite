import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Spool } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useLibraryImport, useLibraryPreview } from "../../lib/filament.ts";
import { formatCurrency } from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";

const STATUS = {
  new: "filament:library.statuses.new",
  imported: "filament:library.statuses.imported",
  changed: "filament:library.statuses.changed",
  duplicate: "filament:library.statuses.duplicate",
} as const;

/** Slicer presets of one integration (the FilamentPage shows one link per capable integration). */
export function LibraryImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currency = usePreferences().data?.values.currency;
  const { id } = useParams({ strict: false }) as { id: string };
  const [includeSystem, setIncludeSystem] = useState(false);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const preview = useLibraryPreview(id, includeSystem);
  const run = useLibraryImport(id);

  const items = preview.data?.items ?? [];
  const importable = (s: string) => s === "new" || s === "changed";
  const picked = items.filter((i) => importable(i.status) && !unchecked.has(i.presetId));
  const toggle = (id: string) =>
    setUnchecked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <>
      <PageHeader
        title={t("filament:library.title")}
        description={t("filament:library.description")}
      />
      <div className="grid gap-4">
        {preview.isError && (
          <p role="alert" className="text-bad">
            {t("filament:library.notFound")}{" "}
            <Link to="/integrations" className="font-medium underline">
              {t("filament:library.openIntegrations")}
            </Link>
          </p>
        )}
        {preview.data && (
          <>
            <p className="text-muted">{t("filament:library.reading", { dir: preview.data.dir })}</p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeSystem}
                onChange={(e) => setIncludeSystem(e.target.checked)}
              />
              {t("filament:library.includeSystem")}
            </label>
            {!items.length ? (
              <EmptyState
                icon={Spool}
                title={t("filament:library.emptyTitle")}
                description={t("filament:library.emptyBody")}
              />
            ) : (
              <DataTable
                label={t("filament:library.table")}
                rows={items}
                rowKey={(i) => i.presetId}
                columns={[
                  {
                    id: "pick",
                    header: "",
                    cell: (i) => (
                      <input
                        type="checkbox"
                        aria-label={t("filament:library.pick", { name: i.name })}
                        disabled={!importable(i.status)}
                        checked={importable(i.status) && !unchecked.has(i.presetId)}
                        onChange={() => toggle(i.presetId)}
                      />
                    ),
                  },
                  {
                    id: "name",
                    header: t("filament:library.name"),
                    cell: (i) => <span className="font-medium">{i.name}</span>,
                    sortValue: (i) => i.name.toLowerCase(),
                  },
                  {
                    id: "brand",
                    header: t("filament:profiles.brand"),
                    cell: (i) => i.brand,
                    sortValue: (i) => i.brand.toLowerCase(),
                  },
                  {
                    id: "material",
                    header: t("filament:profiles.material"),
                    cell: (i) => i.material,
                    sortValue: (i) => i.material,
                  },
                  {
                    id: "price",
                    header: t("filament:profiles.pricePerKg"),
                    numeric: true,
                    cell: (i) =>
                      i.pricePerKg === null ? "" : formatCurrency(i.pricePerKg / 100, currency),
                    sortValue: (i) => i.pricePerKg ?? -1,
                  },
                  {
                    id: "status",
                    header: t("filament:library.status"),
                    cell: (i) => t(STATUS[i.status]),
                    sortValue: (i) => i.status,
                  },
                ]}
              />
            )}
            {run.isError && (
              <p role="alert" className="text-bad">
                {t("filament:library.error")}
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                disabled={!picked.length || run.isPending}
                onClick={() =>
                  run.mutate(
                    { includeSystem, presetIds: picked.map((i) => i.presetId) },
                    { onSuccess: () => navigate({ to: "/filament" }) },
                  )
                }
              >
                {t("filament:library.import", { count: picked.length })}
              </Button>
              <Link to="/filament" className="text-muted hover:underline">
                {t("common:actions.cancel")}
              </Link>
            </div>
          </>
        )}
      </div>
    </>
  );
}
