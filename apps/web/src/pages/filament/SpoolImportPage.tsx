import { Link, useNavigate } from "@tanstack/react-router";
import { Spool } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import {
  filamentLabel,
  useLibrarySources,
  useLibrarySpoolImport,
  useLibrarySpools,
  useProfiles,
} from "../../lib/filament.ts";
import { formatWeight } from "../../lib/format.ts";

// ponytail: only the first library with an inventory (Bambu Studio); add a picker with a second one.
export function SpoolImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const source = useLibrarySources().data?.find((s) => s.spools);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  // spoolId -> profile picked by hand; otherwise the suggested match from the server.
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const preview = useLibrarySpools(source?.id);
  const profiles = useProfiles().data?.items ?? [];
  const run = useLibrarySpoolImport(source?.id ?? "");

  const items = preview.data?.items ?? [];
  const profileOf = (i: (typeof items)[number]) => chosen[i.spoolId] ?? i.profileId ?? "";
  // A spool needs a profile to be imported; import never creates one.
  const pickable = (i: (typeof items)[number]) => !i.imported && !!profileOf(i);
  const picked = items.filter((i) => pickable(i) && !unchecked.has(i.spoolId));
  const toggle = (id: string) =>
    setUnchecked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <>
      <PageHeader
        title={t("filament:spoolImport.title")}
        description={t("filament:spoolImport.description")}
      />
      <div className="grid gap-4">
        {preview.isError && (
          <p role="alert" className="text-bad">
            {t("filament:library.notFound")}{" "}
            <Link to="/settings" className="font-medium underline">
              {t("filament:library.openSettings")}
            </Link>
          </p>
        )}
        {preview.data && (
          <>
            <p className="text-muted">
              {t("filament:spoolImport.reading", { dir: preview.data.dir })}{" "}
              {t("filament:spoolImport.profileHint")}{" "}
              <Link to="/filament/import" className="font-medium underline">
                {t("filament:library.link")}
              </Link>
            </p>
            {!items.length ? (
              <EmptyState
                icon={Spool}
                title={t("filament:spoolImport.emptyTitle")}
                description={t("filament:spoolImport.emptyBody")}
              />
            ) : (
              <DataTable
                label={t("filament:spoolImport.table")}
                rows={items}
                rowKey={(i) => i.spoolId}
                columns={[
                  {
                    id: "pick",
                    header: "",
                    cell: (i) => (
                      <input
                        type="checkbox"
                        aria-label={t("filament:library.pick", { name: i.profile.name })}
                        disabled={!pickable(i)}
                        checked={pickable(i) && !unchecked.has(i.spoolId)}
                        onChange={() => toggle(i.spoolId)}
                      />
                    ),
                  },
                  {
                    id: "name",
                    header: t("filament:spoolImport.filament"),
                    cell: (i) => (
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="inline-block size-4 shrink-0 rounded-full border border-border"
                          style={{ backgroundColor: i.colorHex }}
                        />
                        <span className="font-medium">{i.profile.name}</span>
                      </span>
                    ),
                    sortValue: (i) => i.profile.name.toLowerCase(),
                  },
                  {
                    id: "profile",
                    header: t("filament:spools.profile"),
                    cell: (i) =>
                      i.imported ? (
                        ""
                      ) : (
                        <select
                          aria-label={t("filament:spoolImport.profileFor", {
                            name: i.profile.name,
                          })}
                          value={profileOf(i)}
                          onChange={(e) =>
                            setChosen((c) => ({ ...c, [i.spoolId]: e.target.value }))
                          }
                          className={inputClass}
                        >
                          <option value="">{t("filament:spoolImport.noProfile")}</option>
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {filamentLabel(p)}
                            </option>
                          ))}
                        </select>
                      ),
                  },
                  {
                    id: "brand",
                    header: t("filament:profiles.brand"),
                    cell: (i) => i.profile.brand,
                    sortValue: (i) => i.profile.brand.toLowerCase(),
                  },
                  {
                    id: "material",
                    header: t("filament:profiles.material"),
                    cell: (i) => i.profile.material,
                    sortValue: (i) => i.profile.material,
                  },
                  {
                    id: "remaining",
                    header: t("filament:spoolImport.remaining"),
                    numeric: true,
                    cell: (i) =>
                      t("filament:spoolImport.remainingOf", {
                        remaining: formatWeight(i.remainingGrams),
                        initial: formatWeight(i.initialGrams),
                      }),
                    sortValue: (i) => i.remainingGrams,
                  },
                  {
                    id: "status",
                    header: t("filament:library.status"),
                    cell: (i) =>
                      t(
                        i.imported
                          ? "filament:library.statuses.imported"
                          : "filament:library.statuses.new",
                      ),
                    sortValue: (i) => String(i.imported),
                  },
                ]}
              />
            )}
            {run.isError && (
              <p role="alert" className="text-bad">
                {t("filament:spoolImport.error")}
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                disabled={!picked.length || run.isPending}
                onClick={() =>
                  run.mutate(
                    {
                      spools: picked.map((i) => ({ spoolId: i.spoolId, profileId: profileOf(i) })),
                    },
                    { onSuccess: () => navigate({ to: "/filament" }) },
                  )
                }
              >
                {t("filament:spoolImport.import", { count: picked.length })}
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
