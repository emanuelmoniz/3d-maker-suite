import {
  defaultSlicePrinter,
  foreignFilaments,
  type PlateSetup,
  type PlateSetupInput,
  type PlateState,
  type ProjectModel,
  presetMisfit,
  printerFitsFile,
  slotAdvice,
  spoolPresets,
} from "@3d-maker-suite/core";
import type { TFunction } from "i18next";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { useCatalogWithArchived, useMachineProfiles, useModelInfo } from "../lib/catalog.ts";
import { cx } from "../lib/cx.ts";
import { spoolName, useProfiles, useSpools } from "../lib/filament.ts";
import { formatDuration, formatList, formatWeight } from "../lib/format.ts";
import { useSlicers } from "../lib/integrations.ts";
import { printerName, usePrinters } from "../lib/printers.ts";
import { Button } from "./Button.tsx";
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
  empty_plate: "projects:slicing.error.empty_plate",
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

/**
 * Under a picked plate: queued / slicing, the last result, or why it failed; one waiting for its
 * slice worker keeps its last result.
 */
export function PlateSlice({
  plate: p,
}: {
  plate: Pick<PlateSetup, "job" | "result" | "error" | "needsSlicing"> & { state?: PlateState };
}) {
  const { t } = useTranslation();
  if (p.job && p.job !== "waiting")
    return (
      <span className="block text-sm text-muted">
        {p.job === "running" ? t("projects:slicing.running") : t("projects:slicing.queued")}
      </span>
    );
  return (
    <>
      {p.job === "waiting" && (
        <span className="block text-sm text-warn">{t("projects:slicing.waiting")}</span>
      )}
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
        !p.job &&
        (p.state ?? "ok") === "ok" && (
          <span className="block text-sm text-warn">{t("projects:slicing.needsSlicing")}</span>
        )
      )}
    </>
  );
}

type FileInfo = Pick<SliceSetupFile, "printerModel" | "nozzleDiameter">;

/**
 * A plate's printer and print profile as the server resolves them, `misfit`: what a slicer has
 * no preset for among the plate's profiles (`presetMisfit`), else undefined, and `fromFile`.
 */
export function usePlateFit(defaultPrinterId: string | null | undefined) {
  const { t } = useTranslation();
  const slicers = useSlicers();
  const printProfiles = useCatalogWithArchived("print-profiles").data ?? [];
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
    });
  };
  /** The plate's filaments that slicer slices with the 3MF's own (another slicer's presets). */
  const fromFile = (v: PlateSetupInput, slicerId: string | undefined) => {
    const library = slicers.slicers.find((s) => s.id === slicerId)?.library;
    if (!library) return [];
    const picked = v.filaments.flatMap((id) => {
      const p = id ? filaments.find((x) => x.id === id) : undefined;
      return p ? [{ ...p, name: p.name || [p.brand, p.material].filter(Boolean).join(" ") }] : [];
    });
    return foreignFilaments(library, picked).map((f) => f.name);
  };
  return { printers, printerOf, fitsFile, misfit, fromFile };
}

/**
 * Pick the 3MF files and plates to print, and per plate its print profile and per slot its
 * filament preset and spool. Controlled; saving is up to the parent.
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
  const printProfiles = useCatalogWithArchived("print-profiles").data ?? [];
  const allProfiles = useProfiles().data?.items ?? [];
  const filaments = allProfiles.filter((p) => !p.archivedAt);
  const spools = useSpools().data?.items ?? [];
  const { printers, printerOf, fitsFile, misfit, fromFile } = usePlateFit(defaultPrinterId);
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
      // One entry per slot, all as saved in the file.
      filaments: Array.from({ length: Math.max(0, ...p.filaments.map((x) => x.slot)) }, () => null),
      spools: [],
      kept: [],
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
  /** The slicer library of the plate's slicer; its presets are the only ones it slices with. */
  const libraryOf = (v: PlateSetupInput) =>
    slicers.slicers.find((s) => s.id === slicers.resolve([v.slicerIntegrationId, projectSlicerId]))
      ?.library;
  const ofSlicer = (library: string | null | undefined, source: string | null) =>
    !library || !!source?.startsWith(`${library}:`);
  // The printer decides: the file's own settings (only on the file's printer), the printer's
  // default profile, then the profiles of its model (all of them without a printer) that are
  // presets of the plate's slicer. The one picked always stays listed.
  const printOptions = (f: SliceSetupFile, v: PlateSetupInput): ComboOption[] => {
    const printer = printerOf(f, v);
    const ownDefault = printProfiles.find((p) => p.id === printer?.printProfileId);
    const library = libraryOf(v);
    const listed = printProfiles.filter(
      (p) =>
        p.id === v.printProfileId ||
        (!p.archivedAt &&
          (!printer || p.printerModelId === printer.modelId) &&
          ofSlicer(library, p.sourcePreset)),
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
  /** Filaments picked from another slicer's presets: sliced with the 3MF's, still priced. */
  const fromFileOf = (v: PlateSetupInput) => {
    const slicer = slicers.resolve([v.slicerIntegrationId, projectSlicerId]);
    const names = fromFile(v, slicer);
    return names.length
      ? t("projects:slicing.filamentFromFile", {
          slicer: slicers.nameOf(slicer),
          names: formatList(names),
          count: names.length,
        })
      : null;
  };

  // A slot's preset and spool are separate picks (ADR-0020); neither changes the other.
  // ponytail: "fits its printer" = the plate's slicer's presets; profiles keep no printer list
  // (variants are merged, slicing picks the printer's). Store `compatible_printers` if it matters.
  const presetsOf = (v: PlateSetupInput) =>
    filaments.filter((p) => ofSlicer(libraryOf(v), p.sourcePreset));
  const spoolOf = (v: PlateSetupInput, slot: number) =>
    spools.find((s) => s.id === v.spools[slot - 1]);
  const presetLabel = (p: (typeof allProfiles)[number]) =>
    p.name || [p.brand, p.material].filter(Boolean).join(" ");
  // As saved in the file (its preset's name), the spool's presets, then the slicer's others. The
  // one picked always stays listed.
  const presetOptions = (v: PlateSetupInput, slot: Plate["filaments"][number]): ComboOption[] => {
    const spool = spoolOf(v, slot.slot);
    const own = presetsOf(v);
    const forSpool = (spool && spoolPresets(spool, own)?.presets) || [];
    const picked = allProfiles.find((p) => p.id === v.filaments[slot.slot - 1]);
    const rest = [...own, ...(picked && !own.includes(picked) ? [picked] : [])].filter(
      (p) => !forSpool.includes(p),
    );
    return [
      {
        value: "",
        label: slot.profile
          ? t("projects:slicing.fromFileProfile", { name: slot.profile })
          : t("projects:slicing.fromFile"),
      },
      ...forSpool.map((p) => ({
        value: p.id,
        label: presetLabel(p),
        group: t("projects:slicing.forThisSpool"),
      })),
      ...rest.map((p) => ({
        value: p.id,
        label: presetLabel(p),
        group: t("projects:slicing.presetsGroup"),
      })),
    ];
  };
  // Spools you can print from, and the one picked, whatever its state.
  const spoolOptions = (v: PlateSetupInput): ComboOption[] => [
    { value: "", label: t("projects:slicing.noSpool") },
    ...spools
      .filter((s) => (!s.archivedAt && s.status !== "empty") || v.spools.includes(s.id))
      .map((s) => ({
        value: s.id,
        label: t("projects:slicing.spoolOption", {
          name: spoolName(t, s),
          weight: formatWeight(s.remainingGrams),
        }),
      })),
  ];
  const slotSet = (list: (string | null)[], slot: number, id: string | null) => {
    const next = [...list];
    while (next.length < slot) next.push(null);
    next[slot - 1] = id || null;
    return next;
  };
  // A new preset asks again about the slot's spool; a new spool asks about itself.
  const setSlot = (
    key: string,
    v: PlateSetupInput,
    slot: number,
    field: "filaments" | "spools",
    id: string,
  ) =>
    patch(key, {
      [field]: slotSet(v[field], slot, id),
      ...(field === "filaments" && { kept: slotSet(v.kept, slot, null) }),
    });
  // Keep is stored with the plate: the spool's suggestion or warning stays hidden for that slot.
  const adviceOf = (key: string, v: PlateSetupInput, slot: Plate["filaments"][number]) => {
    const spool = spoolOf(v, slot.slot);
    if (!spool || v.kept[slot.slot - 1] === spool.id) return;
    const id = v.filaments[slot.slot - 1] ?? null;
    const current = {
      id,
      name: id ? null : slot.profile,
      material: id ? (allProfiles.find((p) => p.id === id)?.material ?? null) : slot.type,
    };
    const advice = slotAdvice(spool, current, presetsOf(v));
    if (!advice) return;
    const keep = () => patch(key, { kept: slotSet(v.kept, slot.slot, spool.id) });
    const use =
      advice.preset && (() => setSlot(key, v, slot.slot, "filaments", advice.preset?.id ?? ""));
    const name = advice.preset && presetLabel(advice.preset);
    const message =
      advice.kind === "suggest"
        ? t("projects:slicing.spoolSuggest", { name })
        : t(
            name
              ? "projects:slicing.spoolMismatch"
              : advice.presets.length
                ? "projects:slicing.spoolMismatchSeveral"
                : "projects:slicing.spoolMismatchNone",
            {
              spool: spool.material,
              preset: current.material ?? t("projects:detail.unknownMaterial"),
              name,
            },
          );
    return { warn: advice.kind === "mismatch", message, use, keep };
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
                  const note = setup && fromFileOf(setup);
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
                          {p.filaments.map((slot) => {
                            const advice = adviceOf(key, setup, slot);
                            const adviceId = `${plateId}-slot${slot.slot}`;
                            return (
                              <div
                                key={slot.slot}
                                className="grid gap-2 sm:col-span-2 sm:grid-cols-2"
                              >
                                <span
                                  aria-hidden
                                  className="flex items-center gap-1 text-sm text-muted sm:col-span-2"
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
                                  aria-label={t("projects:slicing.presetOf", {
                                    plate: name,
                                    slot: slot.slot,
                                  })}
                                  aria-describedby={advice ? adviceId : undefined}
                                  options={presetOptions(setup, slot)}
                                  value={setup.filaments[slot.slot - 1] ?? ""}
                                  disabled={disabled}
                                  onChange={(v) => setSlot(key, setup, slot.slot, "filaments", v)}
                                />
                                <Combobox
                                  aria-label={t("projects:slicing.spoolOf", {
                                    plate: name,
                                    slot: slot.slot,
                                  })}
                                  options={spoolOptions(setup)}
                                  value={setup.spools[slot.slot - 1] ?? ""}
                                  disabled={disabled}
                                  onChange={(v) => setSlot(key, setup, slot.slot, "spools", v)}
                                />
                                {advice && (
                                  <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                                    <p
                                      id={adviceId}
                                      className={cx(
                                        "text-sm",
                                        advice.warn ? "text-warn" : "text-muted",
                                      )}
                                    >
                                      {advice.message}
                                    </p>
                                    {advice.use && (
                                      <Button disabled={disabled} onClick={advice.use}>
                                        {t("projects:slicing.usePreset")}
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      disabled={disabled}
                                      onClick={advice.keep}
                                    >
                                      {t("projects:slicing.keepPreset")}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {warning && <p className="text-sm text-warn sm:col-span-2">{warning}</p>}
                          {note && <p className="text-sm text-muted sm:col-span-2">{note}</p>}
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
