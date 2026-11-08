import { type AdapterInfo, type IntegrationKind, workerConfigSchema } from "@3d-maker-suite/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useCan } from "../../lib/auth.ts";
import { useDevices } from "../../lib/hub.ts";
import {
  libraryOf,
  useAdapterName,
  useAdapters,
  useCreateIntegration,
  useIntegrations,
} from "../../lib/integrations.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useDeviceCatalogSource } from "../../lib/presets.ts";
import { LOCATION_ICONS } from "./integrationLabels.ts";

// The adapter's zod schemas arrive as JSON Schema; flat string/number/boolean fields are enough
// for API-key and URL style vendors. Adapters with an interactive sign-in (2FA, email codes) get
// their secrets from IntegrationLoginPage instead.
type Field = { name: string; type: string; required: boolean; options?: string[] };
const fieldsOf = (s: AdapterInfo["config"]): Field[] => {
  const props = (s.properties ?? {}) as Record<string, { type?: string; enum?: string[] }>;
  const required = (s.required ?? []) as string[];
  return Object.entries(props).map(([name, p]) => ({
    name,
    type: p.type ?? "string",
    required: required.includes(name),
    options: p.enum,
  }));
};

function read(f: FormData, prefix: string, fields: Field[]) {
  const out: Record<string, string | number | boolean> = {};
  for (const { name, type } of fields) {
    const raw = String(f.get(`${prefix}.${name}`) ?? "").trim();
    if (type === "boolean") out[name] = f.has(`${prefix}.${name}`);
    else if (raw) out[name] = type === "number" || type === "integer" ? Number(raw) : raw;
  }
  return out;
}

/** Where a slicer runs, in the order offered (Plan 5.4.0 Step 20). */
const LOCATIONS = ["local", "server", "worker"] as const satisfies IntegrationKind[];
type Location = (typeof LOCATIONS)[number];
const isLocation = (k: IntegrationKind): k is Location => (LOCATIONS as string[]).includes(k);
// Written out so `pnpm i18n:check` sees the keys.
const LOCATION_TEXT = {
  local: ["integrations:form.locations.local", "integrations:form.locations.localHint"],
  server: ["integrations:form.locations.server", "integrations:form.locations.serverHint"],
  worker: ["integrations:form.locations.worker", "integrations:form.locations.workerHint"],
} as const;
const SOURCES = {
  installed: "integrations:form.source.installed",
  managed: "integrations:form.source.managed",
} as const;

const tileClass =
  "flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-checked:border-accent has-disabled:cursor-not-allowed has-disabled:opacity-60";

/** Add an account, or a slicer by where it runs: this computer, this server or a workstation. */
export function IntegrationCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const adapterName = useAdapterName();
  const id = useId();
  const search = useSearch({ strict: false }) as { product?: string };
  const adapters = useAdapters().data ?? [];
  const existing = useIntegrations().data ?? [];
  const hub = !!usePreferences().data?.values.hubEnabled;
  const hubManage = useCan("hub.manage");
  const devices = useDevices(hub && hubManage).data ?? [];
  const create = useCreateIntegration();

  // One product per library (a slicer's local, server and worker adapters), else per adapter.
  const products = [...new Set(adapters.map((a) => a.libraryId ?? a.id))];
  const [picked, setProduct] = useState(search.product);
  const product = products.includes(picked ?? "") ? picked : products[0];
  const choices = adapters.filter((a) => (a.libraryId ?? a.id) === product);
  const slicer = choices.some((a) => isLocation(a.kind));

  const taken = (kind: Location) =>
    existing.filter((i) => libraryOf(i) === product && i.kind === kind);
  // A workstation that already runs this slicer isn't offered again.
  const busy = new Set(
    taken("worker").map((i) => workerConfigSchema.safeParse(i.config).data?.deviceId),
  );
  const online = devices.filter((d) => d.online && !busy.has(d.id));
  const why = (kind: Location) =>
    kind !== "worker"
      ? taken(kind).length
        ? t("integrations:form.taken")
        : null
      : !hub
        ? t("integrations:form.noHub")
        : !online.length
          ? t("integrations:form.noDevice")
          : null;
  const locations = LOCATIONS.filter((k) => choices.some((a) => a.kind === k));
  const [chosen, setLocation] = useState<Location>();
  const location = chosen && !why(chosen) ? chosen : locations.find((k) => !why(k));
  const adapter = slicer ? choices.find((a) => a.kind === location) : choices[0];
  const [deviceId, setDeviceId] = useState("");
  const device = online.find((d) => d.id === deviceId) ?? online[0];
  const [source, setSource] = useState<keyof typeof SOURCES>("installed");
  // A slicer folder found on this computer takes the catalog over from a device (ADR-0020).
  const fromDevice = useDeviceCatalogSource(location === "local" ? product : null);

  const config = adapter && !slicer ? fieldsOf(adapter.config) : [];
  const secrets = adapter && !adapter.login ? fieldsOf(adapter.secrets) : [];

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!adapter) return;
    const f = new FormData(e.currentTarget);
    create.mutate(
      {
        adapterId: adapter.id,
        config:
          adapter.kind === "worker"
            ? { deviceId: device?.id ?? "", source }
            : read(f, "config", config),
        secrets: read(f, "secrets", secrets) as Record<string, string>,
      },
      {
        onSuccess: (row) =>
          adapter.login
            ? navigate({ to: "/integrations/$id/login", params: { id: row.id } })
            : navigate({ to: "/integrations", hash: `integration-${row.id}` }),
      },
    );
  };

  const input = (prefix: "config" | "secrets", { name, type, required, options }: Field) => (
    <FormField
      key={`${adapter?.id}-${prefix}-${name}`}
      label={t(`integrations:adapters.${adapter?.id}.fields.${name}`, { defaultValue: name })}
      hint={prefix === "secrets" ? t("integrations:form.secretHint") : undefined}
    >
      {(p) =>
        type === "boolean" ? (
          <input {...p} type="checkbox" name={`${prefix}.${name}`} className="size-4" />
        ) : options ? (
          <Combobox
            {...p}
            name={`${prefix}.${name}`}
            options={options.map((o) => ({
              value: o,
              label: t(`integrations:adapters.${adapter?.id}.options.${name}.${o}`, {
                defaultValue: o,
              }),
            }))}
          />
        ) : (
          <input
            {...p}
            name={`${prefix}.${name}`}
            required={required}
            type={prefix === "secrets" ? "password" : type === "string" ? "text" : "number"}
            autoComplete={prefix === "secrets" ? "new-password" : "off"}
            className={inputClass}
          />
        )
      }
    </FormField>
  );

  return (
    <>
      <PageHeader title={t("integrations:form.title")} backTo={{ to: "/integrations" }} />
      <form onSubmit={onSubmit} className="grid max-w-2xl gap-8">
        <fieldset className="grid gap-3">
          <legend className="mb-3 font-semibold">{t("integrations:form.product")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {products.map((p) => (
              <label key={p} className={tileClass}>
                <input
                  type="radio"
                  name={`${id}-product`}
                  className="mt-1"
                  checked={product === p}
                  onChange={() => setProduct(p)}
                />
                <span className="font-medium">{adapterName(p)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {slicer && (
          <fieldset className="grid gap-3">
            <legend className="mb-3 font-semibold">
              {t("integrations:form.where", { name: adapterName(product ?? "") })}
            </legend>
            {locations.map((k) => {
              const Icon = LOCATION_ICONS[k];
              const reason = why(k);
              return (
                <label key={k} className={tileClass}>
                  <input
                    type="radio"
                    name={`${id}-location`}
                    className="mt-1"
                    checked={location === k}
                    disabled={!!reason}
                    onChange={() => setLocation(k)}
                    aria-describedby={`${id}-${k}`}
                  />
                  <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
                  <span className="grid gap-0.5">
                    <span className="font-medium">{t(LOCATION_TEXT[k][0])}</span>
                    <span id={`${id}-${k}`} className="text-muted">
                      {reason ?? t(LOCATION_TEXT[k][1])}
                    </span>
                  </span>
                </label>
              );
            })}
            {fromDevice && (
              <p role="note" className="text-warn">
                {t("integrations:form.takesCatalog", {
                  name: adapterName(product ?? ""),
                  device: fromDevice,
                })}
              </p>
            )}
          </fieldset>
        )}

        {adapter?.kind === "worker" && device && (
          <div className="grid gap-4 sm:max-w-md">
            <FormField label={t("integrations:form.device")}>
              {(p) => (
                <Combobox
                  {...p}
                  value={device.id}
                  onChange={setDeviceId}
                  options={online.map((d) => ({ value: d.id, label: d.name }))}
                />
              )}
            </FormField>
            <fieldset className="grid gap-2">
              <legend className="mb-2 font-medium">{t("integrations:form.source.label")}</legend>
              {(Object.keys(SOURCES) as (keyof typeof SOURCES)[]).map((s) => (
                <label key={s} className="flex min-h-9 items-center gap-2">
                  <input
                    type="radio"
                    name={`${id}-source`}
                    checked={source === s}
                    onChange={() => setSource(s)}
                  />
                  {t(SOURCES[s])}
                </label>
              ))}
            </fieldset>
          </div>
        )}

        {(config.length > 0 || secrets.length > 0) && (
          <div className="grid gap-4 sm:max-w-md">
            {config.map((field) => input("config", field))}
            {secrets.map((field) => input("secrets", field))}
          </div>
        )}
        {create.isError && (
          <p role="alert" className="text-bad">
            {t("integrations:form.error")}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={!adapter || create.isPending}>
            {t("integrations:form.save")}
          </Button>
          <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
        </div>
      </form>
    </>
  );
}
