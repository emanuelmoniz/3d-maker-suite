import type { SlicerPreset, SlicerPresetKind, SlicerPresetVersion } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Download, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dependents } from "../../components/ArchiveActions.tsx";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { useCan } from "../../lib/auth.ts";
import { useMachinePresets, useProcessPresets } from "../../lib/catalog.ts";
import { useFilamentPresets } from "../../lib/filament.ts";
import { formatDateTime } from "../../lib/format.ts";
import {
  presetDownloadUrl,
  useDeletedPresets,
  useDeletePreset,
  usePresetDetail,
  usePresets,
  useResolveHeld,
  useRestorePreset,
} from "../../lib/presets.ts";

// Written out so `pnpm i18n:check` sees the keys. The most edited kind first.
const KINDS: [SlicerPresetKind, string][] = [
  ["filament", "hub:presets.kinds.filament"],
  ["process", "hub:presets.kinds.process"],
  ["machine", "hub:presets.kinds.machine"],
];
const LIBRARIES: Record<string, string> = {
  "bambu-studio": "hub:presets.libraries.bambuStudio",
  "orca-slicer": "hub:presets.libraries.orcaSlicer",
};

const useLibraryName = () => {
  const { t } = useTranslation();
  return (id: string) => (LIBRARIES[id] ? t(LIBRARIES[id]) : id);
};

const iconButton =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent";

/** "Version 3, saved 2 Nov 14:05 by Ana on Studio PC"; who is left out when the hub saved it. */
function SavedLine({ v }: { v: SlicerPresetVersion }) {
  const { t } = useTranslation();
  const when = formatDateTime(v.savedAt);
  const key = v.savedUser
    ? v.savedDevice
      ? "hub:presets.savedOn"
      : "hub:presets.savedBy"
    : v.savedDevice
      ? "hub:presets.savedFrom"
      : "hub:presets.savedHub";
  return <>{t(key, { version: v.version, when, user: v.savedUser, device: v.savedDevice })}</>;
}

/** The earlier versions, read when the row opens; `onRestore` makes one the next version. */
function Versions({
  preset,
  onRestore,
}: {
  preset: SlicerPreset;
  onRestore?: (version: number) => void;
}) {
  const { t } = useTranslation();
  const detail = usePresetDetail(preset.id, true);
  if (detail.isPending) return <p className="text-muted">{t("hub:presets.loadingVersions")}</p>;
  if (detail.isError)
    return (
      <p role="alert" className="text-bad">
        {t("hub:presets.loadError")}
      </p>
    );
  if (!detail.data.versions.length)
    return <p className="text-muted">{t("hub:presets.noVersions")}</p>;
  return (
    <ol aria-label={t("hub:presets.versions", { name: preset.name })} className="grid gap-1">
      {detail.data.versions.map((v) => (
        <li key={v.version} className="flex items-center justify-between gap-2">
          <span className="min-w-0 text-muted wrap-anywhere">
            <SavedLine v={v} />
          </span>
          <span className="flex shrink-0">
            {onRestore && (
              <button
                type="button"
                onClick={() => onRestore(v.version)}
                className={iconButton}
                aria-label={t("hub:presets.restoreVersion", { version: v.version })}
              >
                <RotateCcw className="size-4" aria-hidden />
              </button>
            )}
            <a
              href={presetDownloadUrl(preset.id, v.version)}
              download
              className={iconButton}
              aria-label={t("hub:presets.downloadVersion", { version: v.version })}
            >
              <Download className="size-4" aria-hidden />
            </a>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Why a removal waits, or what a removal waits on (ADR-0019); nothing when none. */
function RemovalLine({ preset: p }: { preset: SlicerPreset }) {
  const { t, i18n } = useTranslation();
  const devices = new Intl.ListFormat(i18n.language).format(p.removedOn);
  const text = p.held
    ? t(p.held.reason === "shared" ? "hub:presets.heldShared" : "hub:presets.heldMass", {
        device: p.held.device,
      })
    : p.removedOn.length
      ? t(p.usedBy.length ? "hub:presets.removedInUse" : "hub:presets.removedOn", { devices })
      : null;
  return text ? <span className="block text-sm text-warn wrap-anywhere">{text}</span> : null;
}

function PresetRow({
  preset: p,
  catalogRow,
  onDelete,
  onRestore,
}: {
  preset: SlicerPreset;
  catalogRow?: { to: string; id: string };
  onDelete?: () => void;
  onRestore?: (version: number) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panel = `preset-${p.id}`;
  return (
    <li className="py-2">
      <div className="flex items-start gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen(!open)}
          className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-md px-1 py-1 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ChevronRight
            className={`mt-0.5 size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="block font-medium wrap-anywhere">{p.name}</span>
            {p.inherits && (
              <span className="block text-muted wrap-anywhere">
                {t("hub:presets.inherits", { name: p.inherits })}
              </span>
            )}
            <span className="block text-sm text-muted wrap-anywhere">
              <SavedLine v={p} />
            </span>
            {p.owner && (
              <span className="block text-sm text-muted wrap-anywhere">
                {t("hub:presets.owner", { user: p.owner })}
              </span>
            )}
            <RemovalLine preset={p} />
          </span>
        </button>
        <a
          href={presetDownloadUrl(p.id)}
          download
          className={iconButton}
          aria-label={t("hub:presets.download", { name: p.name })}
        >
          <Download className="size-4" aria-hidden />
        </a>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className={`${iconButton} text-muted hover:text-bad focus-visible:text-bad`}
            aria-label={t("hub:presets.delete", { name: p.name })}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {open && (
        <div id={panel} className="mt-1 ml-7 grid gap-3 border-l-2 border-border pl-3">
          {p.usedBy.length > 0 && <Dependents details={{ dependents: p.usedBy }} />}
          {catalogRow && (
            <Link
              to={catalogRow.to}
              params={{ id: catalogRow.id }}
              className="font-medium text-accent hover:underline"
            >
              {t("hub:presets.openPreset")}
            </Link>
          )}
          <Versions preset={p} onRestore={onRestore} />
        </div>
      )}
    </li>
  );
}

/** Pick one of a few; a pressed button is the current one. */
function Switcher<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-wrap gap-1">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <Button
          key={o.value}
          variant={o.value === value ? "primary" : "secondary"}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </fieldset>
  );
}

/** Catalog settings → Preset library (ADR-0017, ADR-0023): the one library the hub slicer and workers use. */
export function PresetsTab() {
  const { t } = useTranslation();
  const presets = usePresets();
  const manage = useCan("catalog", "write");
  const integrations = useCan("integrations.manage");
  const libName = useLibraryName();
  const remove = useDeletePreset();
  const restore = useRestorePreset();
  const resolve = useResolveHeld();
  const deleted = useDeletedPresets(manage);
  // A preset page links here as `#<library>:<kind>:<name>` (see `presetLink`).
  const [from = "", fromKind, ...fromName] = decodeURIComponent(location.hash.slice(1)).split(":");
  const [library, setLibrary] = useState<string | null>(from || null);
  const [kind, setKind] = useState<SlicerPresetKind>(
    KINDS.some(([k]) => k === fromKind) ? (fromKind as SlicerPresetKind) : "filament",
  );
  const [query, setQuery] = useState(fromName.join(":"));
  const catalogRows = [
    ...(useFilamentPresets().data?.items ?? []).map((p) => ({
      ...p,
      to: "/catalog/filament-presets/$id",
    })),
    ...(useMachinePresets().data ?? []).map((p) => ({
      ...p,
      to: "/catalog/printer-presets/$id",
    })),
    ...(useProcessPresets().data ?? []).map((p) => ({ ...p, to: "/catalog/process-presets/$id" })),
  ];
  const presetOf = (p: SlicerPreset) => {
    const hit = catalogRows.find((r) => r.sourcePreset === `${p.library}:user/${p.name}`);
    return hit && { to: hit.to, id: hit.id };
  };
  const [deleting, setDeleting] = useState<SlicerPreset | null>(null);

  const all = presets.data ?? [];
  // A library with only deleted presets left still offers Restore.
  const libraries = [...new Set([...all, ...(deleted.data ?? [])].map((p) => p.library))];
  const lib = library && libraries.includes(library) ? library : libraries[0];
  const inLib = all.filter((p) => p.library === lib);
  const conflicts = inLib.filter((p) => p.conflict);
  // Per device: its held removals in this library and why (ADR-0019).
  const held = new Map<string, { device: string; reason: string; count: number }>();
  for (const p of inLib)
    if (p.held) {
      const h = held.get(p.held.deviceId) ?? { ...p.held, count: 0 };
      held.set(p.held.deviceId, { ...h, count: h.count + 1 });
    }
  const gone = (deleted.data ?? []).filter((p) => p.library === lib && !p.conflict);
  const restoreOf = (p: SlicerPreset) =>
    manage ? (version?: number) => restore.mutate({ id: p.id, version }) : undefined;
  const q = query.trim().toLocaleLowerCase();
  const shown = inLib.filter(
    (p) => !p.conflict && p.kind === kind && (!q || p.name.toLocaleLowerCase().includes(q)),
  );
  const close = () => {
    setDeleting(null);
    remove.reset();
  };

  return (
    <>
      {presets.isError && (
        <p role="alert" className="text-bad">
          {t("hub:presets.loadError")}
        </p>
      )}
      {presets.data && !all.length && (
        <EmptyState
          icon={SlidersHorizontal}
          title={t("hub:presets.emptyTitle")}
          description={t("hub:presets.emptyBody")}
          action={
            integrations && (
              <Link to="/integrations" className="font-medium text-accent hover:underline">
                {t("hub:presets.toIntegrations")}
              </Link>
            )
          }
        />
      )}
      {lib && (
        <div className="grid gap-5">
          {libraries.length > 1 && (
            <Switcher
              label={t("hub:presets.library")}
              options={libraries.map((l) => ({ value: l, label: libName(l) }))}
              value={lib}
              onChange={setLibrary}
            />
          )}

          {restore.isError && (
            <p role="alert" className="text-bad">
              {t("hub:errors.generic")}
            </p>
          )}

          {manage && held.size > 0 && (
            <section
              aria-labelledby="preset-held"
              className="rounded-lg border border-l-4 border-border border-l-warn bg-surface px-4 py-3"
            >
              <h2 id="preset-held" className="text-base font-semibold">
                {t("hub:presets.heldTitle")}
              </h2>
              <p className="mt-0.5 max-w-prose text-muted">{t("hub:presets.heldHint")}</p>
              {resolve.isError && (
                <p role="alert" className="text-bad">
                  {t("hub:errors.generic")}
                </p>
              )}
              <ul className="mt-2 divide-y divide-border">
                {[...held].map(([id, h]) => (
                  <li
                    key={id}
                    className="grid gap-2 py-2 sm:flex sm:items-center sm:justify-between"
                  >
                    <span className="wrap-anywhere">
                      {t(
                        h.reason === "shared"
                          ? "hub:presets.heldSharedOn"
                          : "hub:presets.heldMassOn",
                        {
                          device: h.device,
                          count: h.count,
                        },
                      )}
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <Button
                        variant="danger"
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate({ device: id, action: "delete" })}
                        aria-label={t("hub:presets.heldDeleteOn", { device: h.device })}
                      >
                        {t("hub:presets.heldDelete")}
                      </Button>
                      <Button
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate({ device: id, action: "keep" })}
                        aria-label={t("hub:presets.heldKeepOn", { device: h.device })}
                      >
                        {t("hub:presets.heldKeep")}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {conflicts.length > 0 && (
            <section
              aria-labelledby="preset-conflicts"
              className="rounded-lg border border-l-4 border-border border-l-warn bg-surface px-4 py-3"
            >
              <h2 id="preset-conflicts" className="text-base font-semibold">
                {t("hub:presets.conflictsTitle", { count: conflicts.length })}
              </h2>
              <p className="mt-0.5 max-w-prose text-muted">{t("hub:presets.conflictsHint")}</p>
              <ul className="mt-2 divide-y divide-border">
                {conflicts.map((p) => (
                  <PresetRow
                    key={p.id}
                    preset={p}
                    onDelete={manage ? () => setDeleting(p) : undefined}
                  />
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="preset-list" className="grid gap-3">
            <h2 id="preset-list" className="sr-only">
              {libName(lib)}
            </h2>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Switcher
                label={t("hub:presets.kind")}
                options={KINDS.map(([k, key]) => ({
                  value: k,
                  label: t(key, {
                    count: inLib.filter((p) => !p.conflict && p.kind === k).length,
                  }),
                }))}
                value={kind}
                onChange={setKind}
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("hub:presets.search")}
                aria-label={t("hub:presets.search")}
                className="h-9 w-full rounded-md border border-border bg-surface px-3 sm:w-64"
              />
            </div>
            {shown.length ? (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface px-3">
                {shown.map((p) => (
                  <PresetRow
                    key={p.id}
                    preset={p}
                    catalogRow={presetOf(p)}
                    onDelete={manage ? () => setDeleting(p) : undefined}
                    onRestore={restoreOf(p)}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-muted">
                {t(q ? "hub:presets.noMatch" : "hub:presets.noneOfKind")}
              </p>
            )}
          </section>

          {gone.length > 0 && (
            <details className="rounded-lg border border-border bg-surface px-4 py-3">
              <summary className="cursor-pointer font-semibold">
                {t("hub:presets.deletedTitle", { count: gone.length })}
              </summary>
              <p className="mt-1 max-w-prose text-muted">{t("hub:presets.deletedHint")}</p>
              <ul className="mt-2 divide-y divide-border">
                {gone.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="block font-medium wrap-anywhere">{p.name}</span>
                      <span className="block text-sm text-muted">
                        {t("hub:presets.deletedAt", { when: formatDateTime(p.savedAt) })}
                      </span>
                    </span>
                    <Button
                      disabled={restore.isPending}
                      onClick={() => restore.mutate({ id: p.id })}
                      aria-label={t("hub:presets.restoreNamed", { name: p.name })}
                    >
                      {t("hub:presets.restore")}
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        destructive
        title={t("hub:presets.deleteTitle", { name: deleting?.name ?? "" })}
        description={remove.isError ? t("hub:errors.generic") : t("hub:presets.deleteBody")}
        confirmLabel={t("hub:presets.deleteConfirm")}
        onCancel={close}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: close })}
      />
    </>
  );
}
