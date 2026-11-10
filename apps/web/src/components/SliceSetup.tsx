import {
  defaultSlicePrinter,
  fitsMachine,
  foreignFilaments,
  type PlateSetup,
  type PlateSetupInput,
  type PlateState,
  type ProjectModel,
  presetMisfit,
  printerFitsFile,
  resolvePlate,
  slotAdvice,
  spoolPresets,
} from "@3d-maker-suite/core";
import type { TFunction } from "i18next";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCatalogWithArchived, useModelInfo } from "../lib/catalog.ts";
import { cx } from "../lib/cx.ts";
import { spoolName, useFilamentPresets, useSpools } from "../lib/filament.ts";
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
  processPreset?: string | null;
  /** The machine preset the 3MF was saved with, as above. */
  machinePreset?: string | null;
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
  no_printer_preset: "projects:slicing.error.no_printer_preset",
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
type Choice = Pick<
  PlateSetupInput,
  "printerId" | "machinePresetId" | "processPresetId" | "useDefaultProcessPreset"
>;

/**
 * A plate as the server slices it (`resolvePlate`) with a slicer, and `misfit`: what that slicer
 * has no preset for among the plate's presets (`presetMisfit`), else undefined.
 */
export function usePlateFit(defaultPrinterId: string | null | undefined) {
  const { t } = useTranslation();
  const slicers = useSlicers();
  const prints = useCatalogWithArchived("process-presets").data ?? [];
  const machines = useCatalogWithArchived("machine-presets").data ?? [];
  const filaments = useFilamentPresets().data?.items ?? [];
  const models = useModelInfo();
  // Printers with what `printerFitsFile` compares: the model's name and brand, and the nozzle.
  const printers = (usePrinters({ archived: false }).data?.items ?? []).map((p) => {
    const info = models.get(p.modelId ?? "");
    return { ...p, model: info?.model.model ?? "", brand: info?.brand?.name ?? null };
  });
  const fileInfo = (f: FileInfo) => ({
    printerModel: f.printerModel ?? null,
    nozzleDiameter: f.nozzleDiameter ?? null,
  });
  const libraryOf = (slicerId: string | undefined) =>
    slicers.slicers.find((s) => s.id === slicerId)?.library ?? undefined;
  const resolve = (f: FileInfo, v: Choice, slicerId: string | undefined) =>
    resolvePlate(v, fileInfo(f), {
      printers,
      defaultPrinterId,
      machines,
      prints,
      library: libraryOf(slicerId),
    });
  const misfit = (f: FileInfo, v: Choice, slicerId: string | undefined) => {
    const library = libraryOf(slicerId);
    if (!library) return undefined;
    const r = resolve(f, v, slicerId);
    return presetMisfit(library, {
      print: prints.find((p) => p.id === r.presetId),
      machines: r.fromFile ? undefined : r.machine ? [r.machine] : [],
      printer: r.printer && printerName(t, r.printer),
    });
  };
  /** The plate's filaments that slicer slices with the 3MF's own (another slicer's presets). */
  const foreign = (v: PlateSetupInput, slicerId: string | undefined) => {
    const library = libraryOf(slicerId);
    if (!library) return [];
    const picked = v.filaments.flatMap((id) => {
      const p = id ? filaments.find((x) => x.id === id) : undefined;
      return p ? [{ ...p, name: p.name || [p.brand, p.material].filter(Boolean).join(" ") }] : [];
    });
    return foreignFilaments(library, picked).map((f) => f.name);
  };
  return { printers, prints, fileInfo, libraryOf, resolve, misfit, foreign };
}

/**
 * The plate's setup top to bottom, as in the slicer: each line feeds the next, so the rail shows
 * why changing one resets the ones below.
 */
function SetupRail({ children }: { children: ReactNode }) {
  return <ol className="grid">{children}</ol>;
}
function SetupRow({
  label,
  first,
  last,
  readOnly,
  children,
}: {
  label: string;
  first?: boolean;
  last?: boolean;
  /** Then the label is the only name of the line for screen readers. */
  readOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="flex w-2.5 shrink-0 flex-col items-center">
        <span className={cx("h-1.5 w-px sm:h-3", !first && "bg-border")} />
        <span className="size-2.5 rounded-full border-2 border-muted bg-surface" />
        <span className={cx("w-px flex-1", !last && "bg-border")} />
      </span>
      <div className="grid min-w-0 flex-1 gap-1 pb-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start sm:gap-3">
        <span aria-hidden={!readOnly} className="text-sm text-muted sm:pt-2">
          {label}
        </span>
        <div className="min-w-0">{children}</div>
      </div>
    </li>
  );
}
const ReadOnly = ({ children }: { children: ReactNode }) => (
  <p className="py-2 wrap-anywhere">{children}</p>
);

/**
 * Pick the 3MF files and plates to print, and per plate its slicer, printer, machine preset,
 * process preset and per slot its filament preset and spool; above them, defaults to set on all
 * picked plates at once. Controlled; saving is up to the parent.
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
  const allPresets = useFilamentPresets().data?.items ?? [];
  const filaments = allPresets.filter((p) => !p.archivedAt);
  const spools = useSpools().data?.items ?? [];
  const { printers, prints, fileInfo, libraryOf, resolve, misfit, foreign } =
    usePlateFit(defaultPrinterId);
  const byKey = new Map(value.map((v) => [plateKey(v), v]));
  const slicerOf = (v: Pick<PlateSetupInput, "slicerIntegrationId">) =>
    slicers.resolve([v.slicerIntegrationId, projectSlicerId]);
  const resolved = (f: FileInfo, v: PlateSetupInput) => resolve(f, v, slicerOf(v));
  const order = (next: PlateSetupInput[]) => {
    const rank = new Map(
      files.flatMap((f, i) =>
        f.plates.map((p) => [plateKey({ file: f.path, plate: p.index }), i * 1000 + p.index]),
      ),
    );
    return [...next].sort((a, b) => (rank.get(plateKey(a)) ?? 0) - (rank.get(plateKey(b)) ?? 0));
  };
  /** As the server stores it: a plate off the file's machine slices with the default preset. */
  const settle = (f: FileInfo, v: PlateSetupInput): PlateSetupInput => ({
    ...v,
    useDefaultProcessPreset:
      !v.processPresetId && (v.useDefaultProcessPreset || !resolved(f, v).fromFile),
  });
  // New plates: the printer that fits the file, the file's settings when it does, else its default.
  const add = (f: SliceSetupFile, plates: Plate[]): PlateSetupInput[] => {
    const printer = defaultSlicePrinter(printers, defaultPrinterId, fileInfo(f));
    return plates.map((p) =>
      settle(f, {
        file: f.path,
        plate: p.index,
        printerId: printer?.id ?? null,
        machinePresetId: null,
        processPresetId: null,
        useDefaultProcessPreset: false,
        // One entry per slot, all as saved in the file.
        filaments: Array.from(
          { length: Math.max(0, ...p.filaments.map((x) => x.slot)) },
          () => null,
        ),
        spools: [],
        kept: [],
        slicerIntegrationId: null,
      }),
    );
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

  const ofSlicer = (library: string | null | undefined, source: string | null) =>
    !library || !!source?.startsWith(`${library}:`);
  /** Another slicer's filament presets go back to the file's; hand-made ones and spools stay. */
  const ownFilaments = (list: (string | null)[], library: string | undefined) =>
    list.map((id) => {
      const p = allPresets.find((x) => x.id === id);
      return p?.sourcePreset && !ofSlicer(library, p.sourcePreset) ? null : id;
    });
  /** A changed slicer, printer or machine preset: the picks below it go back to their default. */
  const below = (f: FileInfo, v: PlateSetupInput, change: Partial<PlateSetupInput>) =>
    settle(f, { ...v, processPresetId: null, useDefaultProcessPreset: false, ...change });
  const slicerChange = (v: PlateSetupInput, id: string | null): Partial<PlateSetupInput> => ({
    slicerIntegrationId: id,
    machinePresetId: null,
    filaments: ownFilaments(v.filaments, libraryOf(slicers.resolve([id, projectSlicerId]))),
  });
  const setOf = (f: FileInfo, key: string, v: PlateSetupInput, change: Partial<PlateSetupInput>) =>
    onChange(value.map((x) => (plateKey(x) === key ? below(f, v, change) : x)));

  // Your printers, the ones made for the file (`fits`) first.
  const printerOptions = (fits: (p: (typeof printers)[number]) => boolean): ComboOption[] => {
    const made = printers.filter(fits);
    const group = (p: (typeof printers)[number]) =>
      made.length
        ? t(
            made.includes(p)
              ? "projects:slicing.printersForFile"
              : "projects:slicing.printersOther",
          )
        : undefined;
    return [...made, ...printers.filter((p) => !made.includes(p))].map((p) => ({
      value: p.id,
      label: printerName(t, p),
      group: group(p),
    }));
  };
  type Resolved = ReturnType<typeof resolve>;
  // Null: the file's on its printer (`fromFile`), else the printer's own, so that one isn't
  // listed twice. The one picked always stays listed.
  const machineOptions = (r: Resolved, own: Resolved["machine"], fileLabel: string) => [
    {
      value: "",
      label: r.fits ? fileLabel : (own?.name ?? t("projects:slicing.machineNone")),
    },
    ...[...r.machines, ...(r.machine && !r.machines.includes(r.machine) ? [r.machine] : [])]
      .filter((m) => r.fits || m.id !== own?.id)
      .map((m) => ({ value: m.id, label: m.name })),
  ];
  // The file's own (on its machine), the default, then the slicer's presets made for the
  // machine preset. The one picked always stays listed.
  const printOptions = (
    r: Resolved,
    library: string | undefined,
    picked: string | null,
    fileLabel: string,
  ): ComboOption[] => {
    const dflt = prints.find((p) => p.id === r.defaultPresetId);
    const listed = prints.filter(
      (p) =>
        p.id === picked ||
        (!p.archivedAt &&
          ofSlicer(library, p.sourcePreset) &&
          (r.machine
            ? fitsMachine(p, r.machine)
            : !r.printer || p.printerModelId === r.printer.modelId)),
    );
    return [
      ...(r.fromFile ? [{ value: "", label: fileLabel }] : []),
      {
        value: "default",
        label: dflt
          ? t("projects:slicing.printDefault", { name: dflt.name })
          : t("projects:slicing.printDefaultNone"),
      },
      ...listed.map((p) => ({
        value: p.id,
        label: p.name,
        group: t("projects:slicing.forThisMachine"),
      })),
    ];
  };
  const printValue = (v: Choice, r: Resolved) =>
    v.processPresetId ?? (v.useDefaultProcessPreset || !r.fromFile ? "default" : "");
  const printPick = (value: string) => ({
    processPresetId: value === "" || value === "default" ? null : value,
    useDefaultProcessPreset: value === "default",
  });
  const fromFileLabel = (name: string | null | undefined) =>
    name ? t("projects:slicing.fromFilePreset", { name }) : t("projects:slicing.fromFile");

  // A plate without its own slicer (or whose one can't slice now) uses the project's, then the default.
  const inherited = slicers.usable(projectSlicerId);
  const inheritedLabel = t(
    inherited ? "projects:slicing.slicerProject" : "projects:slicing.slicerDefault",
    { name: slicers.nameOf(slicers.resolve([projectSlicerId])) },
  );
  // Each slicer as it would be picked: presets back to their default there.
  const slicerOptions = (f: FileInfo, v: PlateSetupInput): ComboOption[] => [
    { value: "", label: inheritedLabel },
    ...slicers.slicers.map((s) => ({
      value: s.id,
      label: misfit(f, below(f, v, slicerChange(v, s.id)), s.id)
        ? t("projects:slicing.slicerMisfit", { name: s.name })
        : s.name,
    })),
  ];
  /** Before slicing: no machine preset, or the plate's slicer has no preset for a preset. */
  // In the server's order: the process preset, then the machine preset.
  const warningOf = (f: SliceSetupFile, v: PlateSetupInput, r: Resolved) => {
    const slicer = slicerOf(v);
    const name = misfit(f, v, slicer);
    if (name === undefined) return null;
    return r.printer && !r.fromFile && !r.machine && name === printerName(t, r.printer)
      ? t("projects:slicing.error.no_machine_preset", { detail: name })
      : t("projects:slicing.presetMisfit", { slicer: slicers.nameOf(slicer), name });
  };
  /** Filaments picked from another slicer's presets: sliced with the 3MF's, still priced. */
  const foreignOf = (v: PlateSetupInput) => {
    const slicer = slicerOf(v);
    const names = foreign(v, slicer);
    return names.length
      ? t("projects:slicing.filamentFromFile", {
          slicer: slicers.nameOf(slicer),
          names: formatList(names),
          count: names.length,
        })
      : null;
  };

  // A slot's preset and spool are separate picks (ADR-0020); neither changes the other.
  // ponytail: "fits its printer" = the plate's slicer's presets; presets keep no printer list
  // (variants are merged, slicing picks the printer's). Store `compatible_printers` if it matters.
  const presetsOf = (v: PlateSetupInput) =>
    filaments.filter((p) => ofSlicer(libraryOf(slicerOf(v)), p.sourcePreset));
  const spoolOf = (v: PlateSetupInput, slot: number) =>
    spools.find((s) => s.id === v.spools[slot - 1]);
  const presetLabel = (p: (typeof allPresets)[number]) =>
    p.name || [p.brand, p.material].filter(Boolean).join(" ");
  // As saved in the file (its preset's name), the spool's presets, then the slicer's others. The
  // one picked always stays listed.
  const presetOptions = (v: PlateSetupInput, slot: Plate["filaments"][number]): ComboOption[] => {
    const spool = spoolOf(v, slot.slot);
    const own = presetsOf(v);
    const forSpool = (spool && spoolPresets(spool, own)?.presets) || [];
    const picked = allPresets.find((p) => p.id === v.filaments[slot.slot - 1]);
    const rest = [...own, ...(picked && !own.includes(picked) ? [picked] : [])].filter(
      (p) => !forSpool.includes(p),
    );
    return [
      { value: "", label: fromFileLabel(slot.preset) },
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
      name: id ? null : slot.preset,
      material: id ? (allPresets.find((p) => p.id === id)?.material ?? null) : slot.type,
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

  // Defaults for all plates: not stored; the project's slicer and the default printer to start.
  const [defaults, setDefaults] = useState<Choice & Pick<PlateSetupInput, "slicerIntegrationId">>({
    slicerIntegrationId: null,
    printerId: null,
    machinePresetId: null,
    processPresetId: null,
    useDefaultProcessPreset: false,
  });
  const pickedFiles = files.filter((f) => value.some((v) => v.file === f.path));
  const noFile = { printerModel: null, nozzleDiameter: null };
  const defaultsPrinter = resolve(noFile, defaults, undefined).printer;
  // "As saved in the file" where the printer is a picked file's: resolve as for that file.
  const fitFile =
    (defaultsPrinter && pickedFiles.find((f) => printerFitsFile(defaultsPrinter, fileInfo(f)))) ||
    noFile;
  const defaultsChoice = { ...defaults, printerId: defaultsPrinter?.id ?? null };
  const defaultsSlicer = slicerOf(defaults);
  const dr = resolve(fitFile, defaultsChoice, defaultsSlicer);
  const fromFileWhere = t("projects:slicing.defaults.fromFile");
  const defaultMachines = machineOptions(
    dr,
    resolve(fitFile, { ...defaultsChoice, machinePresetId: null }, defaultsSlicer).machine,
    fromFileWhere,
  );
  const setDefault = (change: Partial<typeof defaults>) =>
    setDefaults((d) => ({
      ...d,
      processPresetId: null,
      useDefaultProcessPreset: false,
      ...change,
    }));
  const applyDefaults = () =>
    onChange(
      value.map((v) => {
        const f = files.find((x) => x.path === v.file);
        return f
          ? settle(f, {
              ...v,
              ...defaultsChoice,
              filaments: ownFilaments(v.filaments, libraryOf(defaultsSlicer)),
            })
          : v;
      }),
    );

  if (!files.length) return <p className="text-muted">{t("projects:slicing.noFiles")}</p>;
  const slicerLine = (
    label: string,
    val: string | null,
    onPick: (id: string | null) => void,
    options: ComboOption[],
  ) =>
    slicers.slicers.length > 1 ? (
      <Combobox
        aria-label={label}
        options={options}
        value={slicers.usable(val) ?? ""}
        disabled={disabled}
        onChange={(id) => onPick(id || null)}
      />
    ) : (
      <ReadOnly>{slicers.slicers[0]?.name}</ReadOnly>
    );
  return (
    <div className="space-y-4">
      {value.length > 0 && (
        <section
          aria-labelledby={`${uid}-defaults`}
          className="rounded-lg border border-border bg-surface p-3"
        >
          <h3 id={`${uid}-defaults`} className="font-medium">
            {t("projects:slicing.defaults.title")}
          </h3>
          <p className="mb-3 text-sm text-muted">{t("projects:slicing.defaults.hint")}</p>
          <SetupRail>
            {slicers.slicers.length > 0 && (
              <SetupRow
                first
                label={t("projects:slicing.slicer")}
                readOnly={slicers.slicers.length === 1}
              >
                {slicerLine(
                  t("projects:slicing.slicer"),
                  defaults.slicerIntegrationId,
                  (id) => setDefault({ slicerIntegrationId: id, machinePresetId: null }),
                  [
                    { value: "", label: inheritedLabel },
                    ...slicers.slicers.map((s) => ({ value: s.id, label: s.name })),
                  ],
                )}
              </SetupRow>
            )}
            <SetupRow first={!slicers.slicers.length} label={t("projects:slicing.printer")}>
              <Combobox
                aria-label={t("projects:slicing.printer")}
                options={printerOptions((p) =>
                  pickedFiles.some((f) => printerFitsFile(p, fileInfo(f))),
                )}
                value={defaultsPrinter?.id ?? ""}
                disabled={disabled || !printers.length}
                onChange={(id) => setDefault({ printerId: id, machinePresetId: null })}
              />
            </SetupRow>
            <SetupRow
              label={t("projects:slicing.machinePreset")}
              readOnly={defaultMachines.length === 1}
            >
              {defaultMachines.length > 1 ? (
                <Combobox
                  aria-label={t("projects:slicing.machinePreset")}
                  options={defaultMachines}
                  value={defaults.machinePresetId ?? ""}
                  disabled={disabled}
                  onChange={(id) => setDefault({ machinePresetId: id || null })}
                />
              ) : (
                <ReadOnly>{defaultMachines[0]?.label}</ReadOnly>
              )}
            </SetupRow>
            <SetupRow last label={t("projects:slicing.processPreset")}>
              <Combobox
                aria-label={t("projects:slicing.processPreset")}
                options={printOptions(
                  dr,
                  libraryOf(defaultsSlicer),
                  defaults.processPresetId,
                  fromFileWhere,
                )}
                value={printValue(defaults, dr)}
                disabled={disabled}
                onChange={(v) => setDefaults((d) => ({ ...d, ...printPick(v) }))}
              />
            </SetupRow>
          </SetupRail>
          <Button className="mt-1" disabled={disabled} onClick={applyDefaults}>
            {t("projects:slicing.defaults.apply", { count: value.length })}
          </Button>
        </section>
      )}
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
                  const r = setup && resolved(f, setup);
                  const warning = setup && r && warningOf(f, setup, r);
                  const note = setup && foreignOf(setup);
                  const machines =
                    setup &&
                    r &&
                    machineOptions(
                      r,
                      resolved(f, { ...setup, machinePresetId: null }).machine,
                      fromFileLabel(f.machinePreset),
                    );
                  return (
                    <li key={key} className="flex flex-wrap gap-3 border-t border-border pt-3">
                      <label htmlFor={plateId} className="flex min-w-48 items-start gap-2">
                        <input
                          id={plateId}
                          type="checkbox"
                          className="mt-1"
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
                      {setup && r && machines && (
                        <div className="min-w-0 flex-1 basis-80 space-y-3">
                          <SetupRail>
                            {slicers.slicers.length > 0 && (
                              <SetupRow
                                first
                                label={t("projects:slicing.slicer")}
                                readOnly={slicers.slicers.length === 1}
                              >
                                {slicerLine(
                                  t("projects:slicing.slicerOf", { plate: name }),
                                  setup.slicerIntegrationId,
                                  (id) => setOf(f, key, setup, slicerChange(setup, id)),
                                  slicerOptions(f, setup),
                                )}
                              </SetupRow>
                            )}
                            <SetupRow
                              first={!slicers.slicers.length}
                              label={t("projects:slicing.printer")}
                            >
                              <Combobox
                                aria-label={t("projects:slicing.printerOf", { plate: name })}
                                options={printerOptions((x) => printerFitsFile(x, fileInfo(f)))}
                                value={r.printer?.id ?? ""}
                                disabled={disabled || !printers.length}
                                onChange={(id) =>
                                  setOf(f, key, setup, { printerId: id, machinePresetId: null })
                                }
                              />
                            </SetupRow>
                            <SetupRow
                              label={t("projects:slicing.machinePreset")}
                              readOnly={machines.length === 1}
                            >
                              {machines.length > 1 ? (
                                <Combobox
                                  aria-label={t("projects:slicing.machinePresetOf", {
                                    plate: name,
                                  })}
                                  options={machines}
                                  value={setup.machinePresetId ?? ""}
                                  disabled={disabled}
                                  onChange={(id) =>
                                    setOf(f, key, setup, { machinePresetId: id || null })
                                  }
                                />
                              ) : (
                                <ReadOnly>{machines[0]?.label}</ReadOnly>
                              )}
                            </SetupRow>
                            <SetupRow last label={t("projects:slicing.processPreset")}>
                              <Combobox
                                aria-label={t("projects:slicing.processPresetOf", { plate: name })}
                                aria-describedby={r.presetId ? `${plateId}-hint` : undefined}
                                options={printOptions(
                                  r,
                                  libraryOf(slicerOf(setup)),
                                  setup.processPresetId,
                                  fromFileLabel(f.processPreset),
                                )}
                                value={printValue(setup, r)}
                                disabled={disabled}
                                onChange={(v) => patch(key, printPick(v))}
                              />
                              {r.presetId && (
                                <p id={`${plateId}-hint`} className="mt-1 text-sm text-muted">
                                  {t("projects:slicing.processPresetHint")}
                                </p>
                              )}
                            </SetupRow>
                          </SetupRail>
                          <div className="grid gap-2 sm:grid-cols-2">
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
                          </div>
                          {warning && <p className="text-sm text-warn">{warning}</p>}
                          {note && <p className="text-sm text-muted">{note}</p>}
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
