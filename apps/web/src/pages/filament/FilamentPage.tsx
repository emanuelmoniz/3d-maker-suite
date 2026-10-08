import type { Spool } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Plus, Spool as SpoolIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import {
  filamentLabel,
  useAdjustSpool,
  usePatchProfile,
  usePatchSpool,
  useProfiles,
  useSpoolHistory,
  useSpools,
} from "../../lib/filament.ts";
import { formatCurrency, formatDateTime, formatNumber, formatWeight } from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";

const STATUS = {
  new: "filament:spools.statuses.new",
  in_use: "filament:spools.statuses.in_use",
  empty: "filament:spools.statuses.empty",
} as const;
const ENTRY = {
  manual: "filament:adjust.entryKinds.manual",
  print: "filament:adjust.entryKinds.print",
  correction: "filament:adjust.entryKinds.correction",
} as const;
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

const addClass =
  "inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90";
const AddLink = ({ to, children }: { to: string; children: string }) => (
  <Link to={to} className={addClass}>
    <Plus className="size-4" aria-hidden />
    {children}
  </Link>
);

const label = filamentLabel;

function Swatch({ hex }: { hex: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-4 shrink-0 rounded-full border border-border"
      style={{ backgroundColor: hex }}
    />
  );
}

/** Modal: set the remaining weight, and see every change so far. Native <dialog> like ConfirmDialog. */
function AdjustDialog({
  spool,
  title,
  onClose,
}: {
  spool: Spool | null;
  title: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const adjust = useAdjustSpool();
  const history = useSpoolHistory(spool?.id);
  useEffect(() => {
    const d = ref.current;
    if (!d || !!spool === d.open) return;
    if (spool) d.showModal();
    else d.close();
  }, [spool]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!spool) return;
    const f = new FormData(e.currentTarget);
    adjust.mutate(
      {
        id: spool.id,
        kind: text(f, "kind") === "correction" ? "correction" : "manual",
        remainingGrams: Number(text(f, "remaining")),
        note: text(f, "note") || null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape closes natively
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(92vw,28rem)] rounded-lg border border-border bg-surface p-5 text-fg"
    >
      {spool && (
        <div className="grid gap-4">
          <form key={spool.id} onSubmit={onSubmit} className="grid gap-4">
            <div>
              <h2 className="text-base font-semibold">{t("filament:adjust.title")}</h2>
              <p className="mt-1 text-muted">
                {t("filament:adjust.summary", {
                  filament: title,
                  weight: formatWeight(spool.remainingGrams),
                })}
              </p>
            </div>
            <FormField label={t("filament:adjust.kind")}>
              {(p) => (
                <select {...p} name="kind" className={inputClass}>
                  <option value="manual">{t("filament:adjust.kinds.manual")}</option>
                  <option value="correction">{t("filament:adjust.kinds.correction")}</option>
                </select>
              )}
            </FormField>
            <FormField label={t("filament:adjust.remaining")}>
              {(p) => (
                <input
                  {...p}
                  name="remaining"
                  type="number"
                  required
                  min={0}
                  step={0.1}
                  defaultValue={spool.remainingGrams}
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField label={t("filament:adjust.note")}>
              {(p) => <input {...p} name="note" className={inputClass} />}
            </FormField>
            {adjust.isError && (
              <p role="alert" className="text-bad">
                {t("filament:adjust.error")}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
              <Button type="submit" variant="primary" disabled={adjust.isPending}>
                {t("filament:adjust.save")}
              </Button>
            </div>
          </form>
          <section>
            <h3 className="mb-2 font-medium">{t("filament:adjust.historyTitle")}</h3>
            {history.data && !history.data.length && (
              <p className="text-muted">{t("filament:adjust.historyEmpty")}</p>
            )}
            <ul className="grid max-h-56 gap-1 overflow-y-auto">
              {history.data?.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-x-3">
                  <span>
                    {t(ENTRY[e.kind])}
                    {e.note && <span className="text-muted"> · {e.note}</span>}
                    <span className="block text-xs text-muted">{formatDateTime(e.createdAt)}</span>
                  </span>
                  <span className="tabular-nums">
                    {e.deltaGrams > 0 ? "+" : ""}
                    {formatNumber(e.deltaGrams, { maximumFractionDigits: 1 })} g
                    <span className="block text-xs text-muted">
                      {formatWeight(e.remainingAfter)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </dialog>
  );
}

export function FilamentPage() {
  const { t } = useTranslation();
  const prefs = usePreferences().data?.values;
  const profiles = useProfiles();
  const spools = useSpools();
  const patchProfile = usePatchProfile();
  const patchSpool = usePatchSpool();
  const [adjusting, setAdjusting] = useState<Spool | null>(null);
  const profileOf = new Map(profiles.data?.items.map((p) => [p.id, p]));
  // Keep the dialog in sync after a save (the list refetches).
  const current = adjusting && (spools.data?.items.find((s) => s.id === adjusting.id) ?? adjusting);

  return (
    <>
      <PageHeader
        title={t("nav:items.filament.label")}
        description={t("nav:items.filament.description")}
      />
      {(profiles.isError || spools.isError) && (
        <p role="alert" className="text-bad">
          {t("filament:loadError")}
        </p>
      )}
      <div className="grid gap-8">
        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{t("filament:spools.title")}</h2>
            <AddLink to="/filament/spools/new">{t("filament:spools.add")}</AddLink>
          </div>
          {spools.data && !spools.data.items.length ? (
            <EmptyState
              icon={SpoolIcon}
              title={t("filament:spools.emptyTitle")}
              description={t("filament:spools.emptyBody")}
            />
          ) : (
            spools.data && (
              <DataTable
                label={t("filament:spools.table")}
                rows={spools.data.items}
                rowKey={(s) => s.id}
                columns={[
                  {
                    id: "filament",
                    header: t("filament:spools.filament"),
                    cell: (s) => (
                      <span className="flex items-center gap-2">
                        <Swatch hex={profileOf.get(s.profileId)?.colorHex ?? "#808080"} />
                        <span className="font-medium">{label(profileOf.get(s.profileId))}</span>
                      </span>
                    ),
                    sortValue: (s) => label(profileOf.get(s.profileId)).toLowerCase(),
                  },
                  {
                    id: "remaining",
                    header: t("filament:spools.remaining"),
                    numeric: true,
                    cell: (s) => (
                      <>
                        {formatWeight(s.remainingGrams)}
                        {s.remainingGrams <= (prefs?.lowSpoolGrams ?? 0) &&
                          s.status !== "empty" && (
                            <span className="ml-2 rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">
                              {t("filament:spools.low")}
                            </span>
                          )}
                      </>
                    ),
                    sortValue: (s) => s.remainingGrams,
                  },
                  {
                    id: "status",
                    header: t("filament:spools.status"),
                    cell: (s) => t(STATUS[s.status]),
                    sortValue: (s) => s.status,
                  },
                  {
                    id: "location",
                    header: t("filament:spools.location"),
                    cell: (s) => s.location ?? "",
                    sortValue: (s) => (s.location ?? "").toLowerCase(),
                  },
                  {
                    id: "action",
                    header: "",
                    cell: (s) => (
                      <span className="flex gap-1">
                        <Button onClick={() => setAdjusting(s)}>
                          {t("filament:spools.adjust")}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => patchSpool.mutate({ id: s.id, patch: { archived: true } })}
                        >
                          {t("filament:spools.archive")}
                        </Button>
                      </span>
                    ),
                  },
                ]}
              />
            )
          )}
        </section>

        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{t("filament:profiles.title")}</h2>
            <AddLink to="/filament/profiles/new">{t("filament:profiles.add")}</AddLink>
          </div>
          {profiles.data && (
            <DataTable
              label={t("filament:profiles.table")}
              rows={profiles.data.items}
              rowKey={(p) => p.id}
              columns={[
                {
                  id: "name",
                  header: t("filament:spools.filament"),
                  cell: (p) => (
                    <span className="flex items-center gap-2">
                      <Swatch hex={p.colorHex} />
                      <span className="font-medium">{label(p)}</span>
                    </span>
                  ),
                  sortValue: (p) => label(p).toLowerCase(),
                },
                {
                  id: "temps",
                  header: `${t("filament:profiles.nozzleTemp")} / ${t("filament:profiles.bedTemp")}`,
                  cell: (p) =>
                    p.nozzleTempC === null && p.bedTempC === null
                      ? ""
                      : t("filament:profiles.temps", {
                          nozzle: p.nozzleTempC ?? "–",
                          bed: p.bedTempC ?? "–",
                        }),
                },
                {
                  id: "price",
                  header: t("filament:profiles.pricePerKg"),
                  numeric: true,
                  cell: (p) =>
                    p.pricePerKg === null
                      ? ""
                      : formatCurrency(p.pricePerKg / 100, prefs?.currency),
                  sortValue: (p) => p.pricePerKg ?? -1,
                },
                {
                  id: "action",
                  header: "",
                  cell: (p) => (
                    <Button
                      variant="ghost"
                      onClick={() => patchProfile.mutate({ id: p.id, patch: { archived: true } })}
                    >
                      {t("filament:profiles.archive")}
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </section>
      </div>
      <AdjustDialog
        spool={current}
        title={label(current ? profileOf.get(current.profileId) : undefined)}
        onClose={() => setAdjusting(null)}
      />
    </>
  );
}
