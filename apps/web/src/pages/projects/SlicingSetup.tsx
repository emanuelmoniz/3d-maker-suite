import type { PlateSetupInput, Project } from "@3d-maker-suite/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PlateSlice, plateKey, SliceSetup } from "../../components/SliceSetup.tsx";
import { usePreferences } from "../../lib/preferences.ts";
import {
  projectFileUrl,
  usePatchProject,
  useProjectSlicing,
  useSaveProjectSlicing,
  useSliceProject,
} from "../../lib/projects.ts";

/** Which plates a print of the project takes, with the print profile and filaments per plate. */
export function SlicingSetup({ project }: { project: Project }) {
  const { t } = useTranslation();
  const saved = useProjectSlicing(project.id).data;
  const save = useSaveProjectSlicing(project.id);
  const slice = useSliceProject(project.id);
  const [draft, setDraft] = useState<PlateSetupInput[] | null>(null);
  const patch = usePatchProject(project.id);
  const prefs = usePreferences().data?.values;
  const defaultId = prefs?.defaultPrinterId;
  // What "Folder default" means here: on unless the project sits in a root ticked off.
  const folder = project.folderPath ?? "";
  const rootOn = !prefs?.autoSliceOffRoots.some(
    (r) => folder.startsWith(r) && /^([\\/]|$)/.test(folder.slice(r.replace(/[\\/]$/, "").length)),
  );
  const ready = project.meta.models.length > 0 && !!saved;
  // The section appears after its data loads, too late for the browser's own jump to #slicing.
  useEffect(() => {
    if (ready && location.hash === "#slicing") document.getElementById("slicing")?.scrollIntoView();
  }, [ready]);
  if (!ready || !saved) return null;
  const stored = saved.plates.map((p) => ({
    file: p.file,
    plate: p.plate,
    printerId: p.printerId,
    printProfileId: p.printProfileId,
    useDefaultPrintProfile: p.useDefaultPrintProfile,
    filaments: p.filaments,
    spools: p.spools,
  }));
  const value = draft ?? stored;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(stored);
  const byKey = new Map(saved.plates.map((p) => [plateKey(p), p]));
  const left = saved.plates.filter((p) => p.job).length;
  const toSlice = saved.plates.filter((p) => p.needsSlicing).length;
  const sliceStatus = !saved.canSlice
    ? t("projects:slicing.noSlicer")
    : dirty
      ? t("projects:slicing.saveFirst")
      : left
        ? t("projects:slicing.progress", { count: left })
        : slice.isError
          ? t("projects:slicing.startFailed")
          : saved.plates.length && !toSlice
            ? t("projects:slicing.upToDate")
            : t("projects:slicing.sliceHint");
  return (
    <section aria-labelledby="slicing" className="mt-6">
      <h2 id="slicing" className="mb-1 text-base font-semibold">
        {t("projects:slicing.title")}
      </h2>
      <p className="mb-2 text-muted">{t("projects:slicing.hint")}</p>
      <div className="mb-3 max-w-sm">
        <FormField
          label={t("projects:slicing.autoSlice")}
          hint={t("projects:slicing.autoSliceHint")}
        >
          {(p) => (
            <select
              {...p}
              className={inputClass}
              value={project.autoSlice == null ? "" : project.autoSlice ? "on" : "off"}
              disabled={patch.isPending}
              onChange={(e) =>
                patch.mutate({ autoSlice: e.target.value ? e.target.value === "on" : null })
              }
            >
              <option value="">
                {t(
                  rootOn
                    ? "projects:slicing.autoSliceFolderOn"
                    : "projects:slicing.autoSliceFolderOff",
                )}
              </option>
              <option value="on">{t("projects:slicing.autoSliceOn")}</option>
              <option value="off">{t("projects:slicing.autoSliceOff")}</option>
            </select>
          )}
        </FormField>
      </div>
      <SliceSetup
        files={project.meta.models.map((m) => ({
          path: m.file,
          label: m.file,
          plates: m.plates,
          printerModel: m.printerModel,
          nozzleDiameter: m.nozzleDiameter,
          printProfile: m.printProfile,
          thumbnailUrl: (entry) => projectFileUrl(project.id, m.file, entry),
        }))}
        value={value}
        onChange={setDraft}
        states={Object.fromEntries(saved.plates.map((p) => [plateKey(p), p.state]))}
        defaultPrinterId={defaultId}
        disabled={save.isPending}
        plateInfo={(key) => {
          const p = byKey.get(key);
          return p && <PlateSlice plate={p} />;
        }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ plates: value }, { onSuccess: () => setDraft(null) })}
        >
          {t("projects:slicing.save")}
        </Button>
        <p role="status" className={save.isError ? "text-bad" : "text-muted"}>
          {save.isError
            ? t("projects:slicing.saveFailed")
            : save.isSuccess && !dirty
              ? t("projects:slicing.saved")
              : ""}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          disabled={!saved.canSlice || dirty || !!left || !toSlice || slice.isPending}
          onClick={() => slice.mutate()}
        >
          {t("projects:slicing.slice")}
        </Button>
        <p aria-live="polite" className={slice.isError ? "text-bad" : "text-muted"}>
          {sliceStatus}
        </p>
      </div>
    </section>
  );
}
