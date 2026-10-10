import type { ImportResult, ReviewedType } from "@3d-maker-suite/core";
import { Link, useParams } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useSourcePreview } from "../../lib/import.ts";
import { ReviewTable } from "./ReviewTable.tsx";

// i18n keys are written out in full so `pnpm i18n:check` can see them.
const TITLE: Record<ReviewedType, string> = {
  spools: "integrations:capabilities.spools",
  brands: "integrations:capabilities.brands",
  printerModels: "integrations:capabilities.printerModels",
  machineProfiles: "integrations:capabilities.machineProfiles",
  filamentBrands: "integrations:capabilities.filamentBrands",
  filamentProfiles: "integrations:capabilities.filamentProfiles",
};

/** The review of what one integration, or one uploaded slicer zip, offers for one type. */
export function SourceReviewPage() {
  const { t } = useTranslation();
  const { source, id, type } = useParams({ strict: false }) as {
    source: "integration" | "zip";
    id: string;
    type: ReviewedType;
  };
  const zip = source === "zip";
  const [includeSystem, setIncludeSystem] = useState(false);
  const [done, setDone] = useState<ImportResult | null>(null);
  const preview = useSourcePreview(source, id, type, includeSystem);

  return (
    <>
      <PageHeader
        title={t(TITLE[type])}
        description={t("import:source.description")}
        // A zip goes back to the zip, where its other types wait.
        backTo={zip ? { to: "/import/slicer-zip/$id", params: { id } } : { to: "/integrations" }}
      />
      <div className="grid gap-4">
        {preview.isError && (
          <p role="alert" className="text-bad">
            {t(zip ? "import:zip.expired" : "import:source.error")}{" "}
            <Link
              to={zip ? "/import/slicer-zip" : "/integrations"}
              className="font-medium underline"
            >
              {t(zip ? "import:zip.again" : "import:source.openIntegrations")}
            </Link>
          </p>
        )}
        {preview.data?.dir && (
          <p className="text-muted">{t("import:source.reading", { dir: preview.data.dir })}</p>
        )}
        {!zip && type === "filamentProfiles" && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeSystem}
              onChange={(e) => setIncludeSystem(e.target.checked)}
            />
            {t("import:source.includeSystem")}
          </label>
        )}
        {preview.isFetching && <p role="status">{t("import:source.loading")}</p>}
        {done && (
          <p role="status" className="font-medium text-ok">
            {t("import:done.summary", { created: done.created, updated: done.updated })}
          </p>
        )}
        {preview.data &&
          (preview.data.rows.length ? (
            // Applying reads the source again: what is left comes back as a fresh review.
            <ReviewTable
              key={preview.data.uploadId}
              entity={preview.data.entity}
              preview={preview.data}
              onCancel={() => history.back()}
              onDone={setDone}
            />
          ) : (
            <EmptyState
              icon={Layers}
              title={t("import:source.emptyTitle")}
              description={t("import:source.emptyBody")}
            />
          ))}
      </div>
    </>
  );
}
