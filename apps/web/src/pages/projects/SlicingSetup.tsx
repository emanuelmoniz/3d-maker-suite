import type { PlateSetupInput, Project } from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { PlateSlice, plateKey, SliceSetup } from "../../components/SliceSetup.tsx";
import { usePreferences } from "../../lib/preferences.ts";
import {
  projectFileUrl,
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
  const defaultId = usePreferences().data?.values.defaultPrinterId;
  if (!project.meta.models.length || !saved) return null;
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
