import type {
  FilamentProfile,
  PlateSetupInput,
  PlateState,
  PrintProfile,
  ProjectModel,
} from "@3d-maker-suite/core";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useModelInfo, usePrintProfiles } from "../lib/catalog.ts";
import { useProfiles } from "../lib/filament.ts";
import { Combobox, type ComboOption } from "./Combobox.tsx";

type Plate = ProjectModel["plates"][number];

export type SliceSetupFile = {
  /** Stored as `PlateSetupInput.file`. */
  path: string;
  label: string;
  plates: Plate[];
  /** The printer model the 3MF was made for; its print profiles are listed first. */
  printerModel?: string | null;
  thumbnailUrl?: (thumbnail: string) => string;
};

export type SliceSetupProps = {
  /** The 3MFs to pick from: a project's models, or (Step 18) a quote's uploads. */
  files: SliceSetupFile[];
  value: PlateSetupInput[];
  onChange: (next: PlateSetupInput[]) => void;
  /** By `plateKey`; from the server, so a changed file shows. */
  states?: Record<string, PlateState>;
  /** What a plate without its own print profile uses ("Default (…)"). */
  defaultPrintProfile: Pick<PrintProfile, "id" | "name"> | null;
  disabled?: boolean;
};

export const plateKey = (p: { file: string; plate: number }) => `${p.file}#${p.plate}`;

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

/**
 * Pick the 3MF files and plates to print, and per plate its print profile and the filament
 * profile per slot. Controlled; saving is up to the parent.
 */
export function SliceSetup({
  files,
  value,
  onChange,
  states = {},
  defaultPrintProfile,
  disabled,
}: SliceSetupProps) {
  const { t } = useTranslation();
  const uid = useId();
  const printProfiles = usePrintProfiles().data ?? [];
  const filaments = useProfiles().data?.items.filter((p) => !p.archivedAt) ?? [];
  const models = useModelInfo();
  const byKey = new Map(value.map((v) => [plateKey(v), v]));
  const order = (next: PlateSetupInput[]) => {
    const rank = new Map(
      files.flatMap((f, i) =>
        f.plates.map((p) => [plateKey({ file: f.path, plate: p.index }), i * 1000 + p.index]),
      ),
    );
    return [...next].sort((a, b) => (rank.get(plateKey(a)) ?? 0) - (rank.get(plateKey(b)) ?? 0));
  };
  const add = (file: string, plates: Plate[]) =>
    plates.map((p) => ({
      file,
      plate: p.index,
      printProfileId: null,
      filaments: defaultFilaments(p, filaments),
    }));
  const setFile = (f: SliceSetupFile, on: boolean) =>
    onChange(
      order([
        ...value.filter((v) => v.file !== f.path),
        ...(on ? add(f.path, f.plates).map((v) => byKey.get(plateKey(v)) ?? v) : []),
      ]),
    );
  const setPlate = (f: SliceSetupFile, p: Plate, on: boolean) =>
    onChange(
      order([
        ...value.filter((v) => plateKey(v) !== plateKey({ file: f.path, plate: p.index })),
        ...(on ? add(f.path, [p]) : []),
      ]),
    );
  const patch = (key: string, change: Partial<PlateSetupInput>) =>
    onChange(value.map((v) => (plateKey(v) === key ? { ...v, ...change } : v)));

  const printOptions = (printerModel?: string | null): ComboOption[] => {
    const fits = (p: PrintProfile) =>
      !!printerModel &&
      models.get(p.printerModelId ?? "")?.model.model.toLowerCase() === printerModel.toLowerCase();
    const option = (p: PrintProfile, group: string) => ({ value: p.id, label: p.name, group });
    return [
      {
        value: "",
        label: defaultPrintProfile
          ? t("projects:slicing.defaultProfile", { name: defaultPrintProfile.name })
          : t("projects:slicing.fromFile"),
      },
      ...printProfiles.filter(fits).map((p) => option(p, t("projects:slicing.forThisPrinter"))),
      ...printProfiles
        .filter((p) => !fits(p))
        .map((p) => option(p, t("projects:slicing.otherProfiles"))),
    ];
  };
  const filamentOptions: ComboOption[] = [
    { value: "", label: t("projects:slicing.fromFile") },
    ...filaments.map((p) => ({
      value: p.id,
      label: p.name || [p.brand, p.material].filter(Boolean).join(" "),
    })),
  ];

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
                        </span>
                      </label>
                      {setup && (
                        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                          <div>
                            <span aria-hidden className="mb-1 block text-sm text-muted">
                              {t("projects:slicing.printProfile")}
                            </span>
                            <Combobox
                              aria-label={t("projects:slicing.printProfileOf", { plate: name })}
                              options={printOptions(f.printerModel)}
                              value={setup.printProfileId ?? ""}
                              disabled={disabled}
                              onChange={(v) => patch(key, { printProfileId: v || null })}
                            />
                          </div>
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
                                options={filamentOptions}
                                value={setup.filaments[slot.slot - 1] ?? ""}
                                disabled={disabled}
                                onChange={(v) => {
                                  const next = [...setup.filaments];
                                  while (next.length < slot.slot) next.push(null);
                                  next[slot.slot - 1] = v || null;
                                  patch(key, { filaments: next });
                                }}
                              />
                            </div>
                          ))}
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
