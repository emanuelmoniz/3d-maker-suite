import {
  defaultSlicePrinter,
  type FilamentProfile,
  type PlateSetup,
  type PlateSetupInput,
  type PlateState,
  type ProjectModel,
  presetMisfit,
  printerFitsFile,
} from "@3d-maker-suite/core";
import type { TFunction } from "i18next";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { useMachineProfiles, useModelInfo, usePrintProfiles } from "../lib/catalog.ts";
import { spoolName, useProfiles, useSpools } from "../lib/filament.ts";
import { formatDuration, formatWeight } from "../lib/format.ts";
import { useSlicers } from "../lib/integrations.ts";
import { printerName, usePrinters } from "../lib/printers.ts";
import { Combobox, type ComboOption } from "./Combobox.tsx";

type Plate = ProjectModel["plates"][number];

export type SliceSetupFile = {
  /** Stored as `PlateSetupInput.file`. */
  path: string;
  label: string;
  plates: Plate[];
  /** The printer the 3MF was made for: a printer of that model (and nozzle) slices it as saved. */
  printerModel?: string | null;
  nozzleDiameter?: number | null;
  /** The print preset the 3MF was saved with, for the "as saved in the file" option. */
  printProfile?: string | null;
  thumbnailUrl?: (thumbnail: string) => string;
};

export type SliceSetupProps = {
  /** The 3MFs to pick from: a project's models, or (Step 18) a quote's uploads. */
  files: SliceSetupFile[];
  value: PlateSetupInput[];
  onChange: (next: PlateSetupInput[]) => void;
  /** By `plateKey`; from the server, so a changed file shows. */
  states?: Record<string, PlateState>;
  /** Preferred for new plates when it fits the file, and when no printer does. */
  defaultPrinterId: string | null | undefined;
  disabled?: boolean;
  /** Extra line under a picked plate's name (e.g. its slice result), by `plateKey`. */
  plateInfo?: (key: string) => ReactNode;
  /** The project's slicer, for plates without their own; else they use the default slicer. */
  projectSlicerId?: string | null;
};

export const plateKey = (p: { file: string; plate: number }) => `${p.file}#${p.plate}`;

// Static keys so `pnpm i18n:check` sees them. Stored as `code` or `code: <the slicer's text>`.
const SLICE_ERRORS: Record<string, string> = {
  no_slicer: "projects:slicing.error.no_slicer",
  not_allowed: "projects:slicing.error.not_allowed",
  no_preset: "projects:slicing.error.no_preset",
  no_machine_preset: "projects:slicing.error.no_machine_preset",
  no_printer_profile: "projects:slicing.error.no_printer_profile",
  slice_failed: "projects:slicing.error.slice_failed",
};
const sliceError = (t: TFunction, error: string) => {
  const at = error.indexOf(": ");
  const [code, detail] = at < 0 ? [error, ""] : [error.slice(0, at), error.slice(at + 2)];
  const key = SLICE_ERRORS[code];
  return key && (detail || code !== "slice_failed")
    ? t(key, { detail })
    : t("projects:slicing.error.unknown");
};

/** Under a picked plate: queued / slicing, the last result, or why it failed. */
export function PlateSlice({
  plate: p,
}: {
  plate: Pick<PlateSetup, "job" | "result" | "error" | "needsSlicing"> & { state?: PlateState };
}) {
  const { t } = useTranslation();
  if (p.job)
    return (
      <span className="block text-sm text-muted">
        {p.job === "running" ? t("projects:slicing.running") : t("projects:slicing.queued")}
      </span>
    );
  return (
    <>
      {p.result && (
        <span className="block text-sm text-muted">
          {t("projects:slicing.result", {
            time: formatDuration(p.result.printTimeSeconds),
            weight: formatWeight(p.result.weightGrams),
          })}
        </span>
      )}
      {p.error ? (
        <span className="block text-sm text-bad">{sliceError(t, p.error)}</span>
      ) : (
        p.needsSlicing &&
        (p.state ?? "ok") === "ok" && (
          <span className="block text-sm text-warn">{t("projects:slicing.needsSlicing")}</span>
        )
      )}
    </>
  );
}

const baseName = (n: string) => n.split(" @")[0]?.trim().toLowerCase() ?? "";

/** Per slot, the filament profile named like the one saved in the 3MF; null keeps the 3MF's. */
export function defaultFilaments(plate: Plate, profiles: FilamentProfile[]): (string | null)[] {
  const slots = Math.max(0, ...plate.filaments.map((f) => f.slot));
  return Array.from({ length: slots }, (_, i) => {
    const want = plate.filaments.find((f) => f.slot === i + 1)?.profile;
    if (!want) return null;
    const name = baseName(want);
    return (
      profiles.find((p) => !p.archivedAt && p.name.trim().toLowerCase() === name)?.id ??
      profiles.find((p) => !p.archivedAt && p.sourcePreset?.toLowerCase().endsWith(`/${name}`))
        ?.id ??
      null
    );
  });
}

type FileInfo = Pick<SliceSetupFile, "printerModel" | "nozzleDiameter">;

/**
 * A plate's printer and print profile as the server resolves them, and `misfit`: what a slicer
 * has no preset for among the plate's profiles (`presetMisfit`), else undefined.
 */
export function usePlateFit(defaultPrinterId: string | null | undefined) {
  const { t } = useTranslation();
  const slicers = useSlicers();
  const printProfiles = usePrintProfiles().data ?? [];
  const machines = useMachineProfiles().data ?? [];
  const filaments = useProfiles().data?.items ?? [];
  const models = useModelInfo();
  // Printers with what `printerFitsFile` compares: the model's name and brand, and the nozzle.
  const printers = (usePrinters({ archived: false }).data?.items ?? []).map((p) => {
    const info = models.get(p.modelId ?? "");
    return { ...p, model: info?.model.model ?? "", brand: info?.brand?.name ?? null };
  });
  type SlicePrinter = (typeof printers)[number];
  const fileInfo = (f: FileInfo) => ({
    printerModel: f.printerModel ?? null,
    nozzleDiameter: f.nozzleDiameter ?? null,
  });
  const printerOf = (f: FileInfo, v: PlateSetupInput) =>
    printers.find((p) => p.id === v.printerId) ??
    defaultSlicePrinter(printers, defaultPrinterId, fileInfo(f));
  const fitsFile = (f: FileInfo, printer?: SlicePrinter) =>
    !printer || printerFitsFile(printer, fileInfo(f));
  const misfit = (f: FileInfo, v: PlateSetupInput, slicerId: string | undefined) => {
    const library = slicers.slicers.find((s) => s.id === slicerId)?.library;
    if (!library) return undefined;
    const printer = printerOf(f, v);
    const fits = fitsFile(f, printer);
    const profileId =
      v.printProfileId ?? (v.useDefaultPrintProfile || !fits ? printer?.printProfileId : null);
    return presetMisfit(library, {
      print: printProfiles.find((p) => p.id === profileId),
      machines:
        printer && !fits
          ? machines.filter(
              (m) =>
                m.printerModelId === printer.modelId &&
                m.nozzleDiameterMm === printer.nozzleDiameterMm &&
                !m.archivedAt,
            )
          : undefined,
      printer: printer && printerName(t, printer),
      filaments: v.filaments.flatMap((id) => {
        const p = id ? filaments.find((x) => x.id === id) : undefined;
        return p ? [{ ...p, name: p.name || [p.brand, p.material].filter(Boolean).join(" ") }] : [];
      }),
    });
  };
  return { printers, printerOf, fitsFile, misfit };
}

/**
 * Pick the 3MF files and plates to print, and per plate its print profile and the filament
 * profile per slot. Controlled; saving is up to the parent.
 */
export function SliceSetup({
  files,
  value,
  onChange,
  states = {},
  defaultPrinterId,
  disabled,
  plateInfo,
  projectSlicerId,
}: SliceSetupProps) {
  const { t } = useTranslation();
  const uid = useId();
  const slicers = useSlicers();
  const printProfiles = usePrintProfiles().data ?? [];
  const allProfiles = useProfiles().data?.items ?? [];
  const filaments = allProfiles.filter((p) => !p.archivedAt);
  const spools = useSpools().data?.items ?? [];
  const { printers, printerOf, fitsFile, misfit } = usePlateFit(defaultPrinterId);
  const byKey = new Map(value.map((v) => [plateKey(v), v]));
  const order = (next: PlateSetupInput[]) => {
    const rank = new Map(
      files.flatMap((f, i) =>
        f.plates.map((p) => [plateKey({ file: f.path, plate: p.index }), i * 1000 + p.index]),
      ),
    );
    return [...next].sort((a, b) => (rank.get(plateKey(a)) ?? 0) - (rank.get(plateKey(b)) ?? 0));
  };
  // New plates: the printer that fits the file, the file's settings when it does, else its default.
  const add = (f: SliceSetupFile, plates: Plate[]): PlateSetupInput[] => {
    const printer = defaultSlicePrinter(printers, defaultPrinterId, {
      printerModel: f.printerModel ?? null,
      nozzleDiameter: f.nozzleDiameter ?? null,
    });
    return plates.map((p) => ({
      file: f.path,
      plate: p.index,
      printerId: printer?.id ?? null,
      printProfileId: null,
      useDefaultPrintProfile: !fitsFile(f, printer),
      filaments: defaultFilaments(p, filaments),
      spools: [],
      slicerIntegrationId: null,
    }));
  };
  const setFile = (f: SliceSetupFile, on: boolean) =>
    onChange(
      order([
        ...value.filter((v) => v.file !== f.path),
        ...(on ? add(f, f.plates).map((v) => byKey.get(plateKey(v)) ?? v) : []),
      ]),
    );
  const setPlate = (f: SliceSetupFile, p: Plate, on: boolean) =>
    onChange(
      order([
        ...value.filter((v) => plateKey(v) !== plateKey({ file: f.path, plate: p.index })),
        ...(on ? add(f, [p]) : []),
      ]),
    );
  const patch = (key: string, change: Partial<PlateSetupInput>) =>
    onChange(value.map((v) => (plateKey(v) === key ? { ...v, ...change } : v)));

  const printerOptions: ComboOption[] = printers.map((p) => ({
    value: p.id,
    label: printerName(t, p),
  }));
  // The printer decides: the file's own settings (only on the file's printer), the printer's
  // default profile, then the profiles of its model (all of them without a printer).
  const printOptions = (f: SliceSetupFile, v: PlateSetupInput): ComboOption[] => {
    const printer = printerOf(f, v);
    const ownDefault = printProfiles.find((p) => p.id === printer?.printProfileId);
    const listed = printProfiles.filter(
      (p) => !printer || p.printerModelId === printer.modelId || p.id === v.printProfileId,
    );
    return [
      ...(fitsFile(f, printer)
        ? [
            {
              value: "",
              label: f.printProfile
                ? t("projects:slicing.fromFileProfile", { name: f.printProfile })
                : t("projects:slicing.fromFile"),
            },
          ]
        : []),
      ...(printer
        ? [
            {
              value: "default",
              label: ownDefault
                ? t("projects:slicing.printerDefault", { name: ownDefault.name })
                : t("projects:slicing.printerDefaultNone"),
            },
          ]
        : []),
      ...listed.map((p) => ({
        value: p.id,
        label: p.name,
        group: t("projects:slicing.forThisPrinter"),
      })),
    ];
  };
  const printValue = (v: PlateSetupInput) =>
    v.printProfileId ?? (v.useDefaultPrintProfile ? "default" : "");
  const setPrintProfile = (key: string, value: string) =>
    patch(key, {
      printProfileId: value === "" || value === "default" ? null : value,
      useDefaultPrintProfile: value === "default",
    });
  const setPrinter = (f: SliceSetupFile, key: string, id: string) => {
    const printer = printers.find((p) => p.id === id);
    patch(key, {
      printerId: id,
      printProfileId: null,
      useDefaultPrintProfile: !fitsFile(f, printer),
    });
  };

  // A plate without its own slicer (or whose one can't slice now) uses the project's, then the default.
  const inherited = slicers.usable(projectSlicerId);
  const slicerOptions = (f: SliceSetupFile, v: PlateSetupInput): ComboOption[] => [
    {
      value: "",
      label: t(inherited ? "projects:slicing.slicerProject" : "projects:slicing.slicerDefault", {
        name: slicers.nameOf(slicers.resolve([projectSlicerId])),
      }),
    },
    ...slicers.slicers.map((s) => ({
      value: s.id,
      label: misfit(f, v, s.id) ? t("projects:slicing.slicerMisfit", { name: s.name }) : s.name,
    })),
  ];
  /** Before slicing: the plate's slicer has no preset for one of its profiles. */
  const misfitOf = (f: SliceSetupFile, v: PlateSetupInput) => {
    const slicer = slicers.resolve([v.slicerIntegrationId, projectSlicerId]);
    const name = misfit(f, v, slicer);
    return name === undefined
      ? null
      : t("projects:slicing.presetMisfit", { slicer: slicers.nameOf(slicer), name });
  };

  const profileOf = (id: string) => allProfiles.find((p) => p.id === id);
  // Spools you can print from (and the one picked, whatever its state), then profiles.
  const filamentOptions = (picked: (string | null)[]): ComboOption[] => [
    { value: "", label: t("projects:slicing.fromFile") },
    ...spools
      .filter((s) => (!s.archivedAt && s.status !== "empty") || picked.includes(s.id))
      .map((s) => ({
        value: `spool:${s.id}`,
        label: t("projects:slicing.spoolOption", {
          name: spoolName(t, s, profileOf(s.profileId)),
          weight: formatWeight(s.remainingGrams),
        }),
        group: t("projects:slicing.spoolsGroup"),
      })),
    ...filaments.map((p) => ({
      value: p.id,
      label: p.name || [p.brand, p.material].filter(Boolean).join(" "),
      group: t("projects:slicing.profilesGroup"),
    })),
  ];
  const setFilament = (key: string, v: PlateSetupInput, slot: number, value: string) => {
    const filamentsNext = [...v.filaments];
    const spoolsNext = [...v.spools];
    while (filamentsNext.length < slot) filamentsNext.push(null);
    while (spoolsNext.length < slot) spoolsNext.push(null);
    const spool = value.startsWith("spool:")
      ? spools.find((s) => s.id === value.slice(6))
      : undefined;
    spoolsNext[slot - 1] = spool?.id ?? null;
    filamentsNext[slot - 1] = spool ? spool.profileId : value || null;
    patch(key, { filaments: filamentsNext, spools: spoolsNext });
  };

  if (!files.length) return <p className="text-muted">{t("projects:slicing.noFiles")}</p>;
  return (
    <div className="space-y-4">
      {files.map((f) => {
        const picked = value.filter((v) => v.file === f.path).length;
        const fileId = `${uid}-${f.path}`;
        return (
          <fieldset key={f.path} className="rounded-lg border border-border bg-surface p-3">
            <legend className="sr-only">{f.label}</legend>
            <label htmlFor={fileId} className="flex items-center gap-2 font-medium">
              <input
                id={fileId}
                type="checkbox"
                checked={picked > 0}
                ref={(el) => {
                  if (el) el.indeterminate = picked > 0 && picked < f.plates.length;
                }}
                disabled={disabled || !f.plates.length}
                onChange={(e) => setFile(f, e.target.checked)}
              />
              <span className="min-w-0 break-all">{f.label}</span>
              <span className="text-muted text-sm font-normal">
                {t("projects:slicing.platesPicked", { count: picked, total: f.plates.length })}
              </span>
            </label>
            {picked > 0 && (
              <ul className="mt-3 space-y-3">
                {f.plates.map((p) => {
                  const key = plateKey({ file: f.path, plate: p.index });
                  const setup = byKey.get(key);
                  const state = states[key];
                  const name = p.name ?? t("projects:detail.plate", { index: p.index });
                  const plateId = `${uid}-${key}`;
                  const warning = setup && misfitOf(f, setup);
                  return (
                    <li key={key} className="flex flex-wrap gap-3 border-t border-border pt-3">
                      <label htmlFor={plateId} className="flex min-w-48 items-center gap-2">
                        <input
                          id={plateId}
                          type="checkbox"
                          checked={!!setup}
                          disabled={disabled}
                          onChange={(e) => setPlate(f, p, e.target.checked)}
                        />
                        {p.thumbnail && f.thumbnailUrl ? (
                          <img
                            src={f.thumbnailUrl(p.thumbnail)}
                            alt=""
                            loading="lazy"
                            className="size-12 shrink-0 rounded bg-surface-2 object-contain"
                          />
                        ) : (
                          <span className="size-12 shrink-0 rounded bg-surface-2" />
                        )}
                        <span>
                          <span className="block">{name}</span>
                          {setup && state && state !== "ok" && (
                            <span className="block text-sm text-warn">
                              {state === "outdated"
                                ? t("projects:slicing.state.outdated")
                                : t("projects:slicing.state.missing")}
                            </span>
                          )}
                          {setup && plateInfo?.(key)}
                        </span>
                      </label>
                      {setup && (
                        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                          <div>
                            <span aria-hidden className="mb-1 block text-sm text-muted">
                              {t("projects:slicing.printer")}
                            </span>
                            <Combobox
                              aria-label={t("projects:slicing.printerOf", { plate: name })}
                              options={printerOptions}
                              value={printerOf(f, setup)?.id ?? ""}
                              disabled={disabled || !printers.length}
                              onChange={(v) => setPrinter(f, key, v)}
                            />
                          </div>
                          <div>
                            <span aria-hidden className="mb-1 block text-sm text-muted">
                              {t("projects:slicing.printProfile")}
                            </span>
                            <Combobox
                              aria-label={t("projects:slicing.printProfileOf", { plate: name })}
                              options={printOptions(f, setup)}
                              value={printValue(setup)}
                              disabled={disabled}
                              onChange={(v) => setPrintProfile(key, v)}
                            />
                          </div>
                          {slicers.slicers.length > 1 && (
                            <div>
                              <span aria-hidden className="mb-1 block text-sm text-muted">
                                {t("projects:slicing.slicer")}
                              </span>
                              <Combobox
                                aria-label={t("projects:slicing.slicerOf", { plate: name })}
                                options={slicerOptions(f, setup)}
                                value={slicers.usable(setup.slicerIntegrationId) ?? ""}
                                disabled={disabled}
                                onChange={(v) => patch(key, { slicerIntegrationId: v || null })}
                              />
                            </div>
                          )}
                          {p.filaments.map((slot) => (
                            <div key={slot.slot}>
                              <span
                                aria-hidden
                                className="mb-1 flex items-center gap-1 text-sm text-muted"
                              >
                                <span
                                  aria-hidden
                                  className="size-3 rounded-full border border-border"
                                  style={{
                                    backgroundColor: slot.color?.slice(0, 7) ?? "transparent",
                                  }}
                                />
                                {t("projects:slicing.slot", {
                                  slot: slot.slot,
                                  material: slot.type ?? t("projects:detail.unknownMaterial"),
                                })}
                              </span>
                              <Combobox
                                aria-label={t("projects:slicing.filamentOf", {
                                  plate: name,
                                  slot: slot.slot,
                                })}
                                options={filamentOptions(setup.spools)}
                                value={
                                  setup.spools[slot.slot - 1]
                                    ? `spool:${setup.spools[slot.slot - 1]}`
                                    : (setup.filaments[slot.slot - 1] ?? "")
                                }
                                disabled={disabled}
                                onChange={(v) => setFilament(key, setup, slot.slot, v)}
                              />
                            </div>
                          ))}
                          {warning && <p className="text-sm text-warn sm:col-span-2">{warning}</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
