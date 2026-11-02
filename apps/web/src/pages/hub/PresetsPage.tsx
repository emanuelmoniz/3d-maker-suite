import type { SlicerPreset, SlicerPresetKind, SlicerPresetVersion } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Download, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Switch } from "../../components/Switch.tsx";
import { useCan } from "../../lib/auth.ts";
import { formatDateTime } from "../../lib/format.ts";
import {
  presetDownloadUrl,
  useDeletePreset,
  usePresetDetail,
  usePresetDevices,
  usePresets,
  useSharePresets,
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

/** The earlier versions, read when the row opens. */
function Versions({ preset }: { preset: SlicerPreset }) {
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
          <a
            href={presetDownloadUrl(preset.id, v.version)}
            download
            className={iconButton}
            aria-label={t("hub:presets.downloadVersion", { version: v.version })}
          >
            <Download className="size-4" aria-hidden />
          </a>
        </li>
      ))}
    </ol>
  );
}

function PresetRow({ preset: p, onDelete }: { preset: SlicerPreset; onDelete?: () => void }) {
  const { t, i18n } = useTranslation();
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
            {p.removedOn.length > 0 && (
              <span className="block text-sm text-warn wrap-anywhere">
                {t("hub:presets.removedOn", {
                  devices: new Intl.ListFormat(i18n.language).format(p.removedOn),
                })}
              </span>
            )}
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
        <div id={panel} className="mt-1 ml-7 border-l-2 border-border pl-3">
          <Versions preset={p} />
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

/** Which devices send their slicers' user presets here. */
function SharingDevices() {
  const { t } = useTranslation();
  const devices = usePresetDevices(true);
  const share = useSharePresets();
  return (
    <section
      aria-labelledby="preset-devices"
      className="mt-5 grid gap-2 rounded-lg border border-border bg-surface px-4 py-3"
    >
      <h2 id="preset-devices" className="text-base font-semibold">
        {t("hub:presets.devicesTitle")}
      </h2>
      <p className="max-w-prose text-muted">{t("hub:presets.devicesHint")}</p>
      {share.isError && (
        <p role="alert" className="text-bad">
          {t("hub:errors.generic")}
        </p>
      )}
      {devices.data?.length ? (
        <ul className="divide-y divide-border">
          {devices.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 py-1">
              <span className="min-w-0 wrap-anywhere">
                {d.name}
                {!d.online && (
                  <span className="ml-2 text-sm text-muted">{t("hub:presets.deviceOffline")}</span>
                )}
              </span>
              <Switch
                label={t("hub:presets.share")}
                aria-label={t("hub:presets.shareOn", { name: d.name })}
                checked={d.sharePresets}
                disabled={share.isPending}
                onChange={(e) => share.mutate({ id: d.id, sharePresets: e.target.checked })}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">{t("hub:presets.noDevices")}</p>
      )}
    </section>
  );
}

/** Hub management → Slicer presets (ADR-0017): the one library the hub slicer and workers use. */
export function PresetsPage() {
  const { t } = useTranslation();
  const presets = usePresets();
  const manage = useCan("presets.manage");
  const integrations = useCan("integrations.manage");
  const remove = useDeletePreset();
  const [library, setLibrary] = useState<string | null>(null);
  const [kind, setKind] = useState<SlicerPresetKind>("filament");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<SlicerPreset | null>(null);

  const all = presets.data ?? [];
  const libraries = [...new Set(all.map((p) => p.library))];
  const lib = library && libraries.includes(library) ? library : libraries[0];
  const inLib = all.filter((p) => p.library === lib);
  const conflicts = inLib.filter((p) => p.conflict);
  const q = query.trim().toLocaleLowerCase();
  const shown = inLib.filter(
    (p) => !p.conflict && p.kind === kind && (!q || p.name.toLocaleLowerCase().includes(q)),
  );
  const libName = (id: string) => (LIBRARIES[id] ? t(LIBRARIES[id]) : id);
  const close = () => {
    setDeleting(null);
    remove.reset();
  };

  return (
    <>
      <PageHeader
        title={t("hub:presets.title")}
        description={t("hub:presets.description")}
        backTo={{ to: "/hub" }}
      />
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
                    onDelete={manage ? () => setDeleting(p) : undefined}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-muted">
                {t(q ? "hub:presets.noMatch" : "hub:presets.noneOfKind")}
              </p>
            )}
          </section>
        </div>
      )}
      {manage && <SharingDevices />}

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
