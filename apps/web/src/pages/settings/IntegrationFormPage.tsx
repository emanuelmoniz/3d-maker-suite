import type { AdapterInfo } from "@3d-maker-suite/core";
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
  isNetworkSource,
  libraryOf,
  useAdapterName,
  useAdapters,
  useCreateIntegration,
  useIntegrations,
} from "../../lib/integrations.ts";
import { usePreferences } from "../../lib/preferences.ts";

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

export const tileClass =
  "flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-checked:border-accent has-disabled:cursor-not-allowed has-disabled:opacity-60";

/** Add an account, or a slicer on this server:the one installed here if found, else a download. */
export function IntegrationCreatePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const adapterName = useAdapterName();
  /** None of the adapter's `configAnyOf` fields was filled in. */
  const [missing, setMissing] = useState(false);
  const id = useId();
  const search = useSearch({ strict: false }) as { product?: string; via?: string };
  // A workstation's slicer is set up on its machine page (Plan 5.5.0 Step 9).
  const adapters = (useAdapters().data ?? []).filter((a) => a.kind !== "worker");
  const existing = useIntegrations().data ?? [];
  const create = useCreateIntegration();
  // A printer on another network is reached through a machine's connector (ADR-0015, LAN reach).
  const hubOn = !!usePreferences().data?.values.hubEnabled;
  const manageHub = useCan("hub.manage");
  const allDevices = useDevices(hubOn && manageHub).data ?? [];

  // One product per library (a slicer's local and server adapters), else per adapter.
  const products = [...new Set(adapters.map((a) => a.libraryId ?? a.id))];
  const [picked, setProduct] = useState(search.product);
  const product = products.includes(picked ?? "") ? picked : products[0];
  const choices = adapters.filter((a) => (a.libraryId ?? a.id) === product);
  const local = choices.find((a) => a.kind === "local");
  const server = choices.find((a) => a.kind === "server");
  const slicer = !!(local || server);
  const adapter = slicer ? (local?.detectedConfigDir || !server ? local : server) : choices[0];
  // One install per machine: this server has it already (installed or downloaded).
  const taken = existing.some(
    (i) => libraryOf(i) === product && (i.kind === "local" || i.kind === "server"),
  );
  // A source that takes usage back is set up once (its spools are keyed by the adapter).
  const once =
    !slicer &&
    !!adapter?.capabilities.includes("spoolUsage") &&
    existing.some((i) => i.adapterId === adapter.id);

  const config = adapter && !slicer ? fieldsOf(adapter.config) : [];
  const secrets = adapter && !adapter.login ? fieldsOf(adapter.secrets) : [];
  const anyOf = adapter && !slicer ? adapter.configAnyOf : [];
  // Only a machine with the matching switch on: Reach printers, or Reach spool libraries.
  const devices = allDevices.filter((d) =>
    adapter?.capabilities.includes("printerStatus") ? d.reachPrinters : d.reachSpoolLibraries,
  );
  const reach = hubOn && manageHub && !!adapter && isNetworkSource(adapter) && devices.length > 0;
  const label = (name: string) =>
    t(`integrations:adapters.${adapter?.id}.fields.${name}`, { defaultValue: name });
  const anyOfError = missing
    ? t(`integrations:adapters.${adapter?.id}.anyOf`, {
        defaultValue: t("integrations:form.anyOf", {
          fields: new Intl.ListFormat(i18n.language, { type: "disjunction" }).format(
            anyOf.map(label),
          ),
        }),
      })
    : undefined;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!adapter) return;
    const f = new FormData(e.currentTarget);
    const values = read(f, "config", config);
    if (anyOf.length && !anyOf.some((k) => values[k] !== undefined)) {
      setMissing(true);
      return;
    }
    const via = reach ? String(f.get("deviceId") ?? "") : "";
    create.mutate(
      {
        adapterId: adapter.id,
        config: values,
        secrets: read(f, "secrets", secrets) as Record<string, string>,
        ...(via && { deviceId: via }),
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
      label={label(name)}
      hint={prefix === "secrets" ? t("integrations:form.secretHint") : undefined}
      // Said once, on the first of the fields it is about.
      error={prefix === "config" && name === anyOf[0] ? anyOfError : undefined}
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
      <form onSubmit={onSubmit} onInput={() => setMissing(false)} className="grid max-w-2xl gap-8">
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
                  onChange={() => {
                    setProduct(p);
                    setMissing(false);
                  }}
                />
                <span className="font-medium">{adapterName(p)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {slicer && adapter && (
          <div className="grid gap-2">
            <p className={taken ? "text-warn" : undefined}>
              {taken
                ? t("integrations:form.taken")
                : t(
                    adapter.kind === "local"
                      ? "integrations:form.installedHere"
                      : "integrations:form.downloadHere",
                    { name: adapterName(product ?? "") },
                  )}
            </p>
            {!taken && <p className="text-muted">{t("integrations:form.machineHint")}</p>}
          </div>
        )}

        {once && <p className="text-warn">{t("integrations:form.takenSource")}</p>}
        {!once && (config.length > 0 || secrets.length > 0) && (
          <div className="grid gap-4 sm:max-w-md">
            {config.map((field) => input("config", field))}
            {secrets.map((field) => input("secrets", field))}
            {reach && (
              <FormField
                key={`${adapter.id}-reach`}
                label={t("integrations:form.reach")}
                hint={t("integrations:form.reachHint")}
              >
                {(p) => (
                  <select
                    {...p}
                    name="deviceId"
                    defaultValue={devices.some((d) => d.id === search.via) ? search.via : ""}
                    className={inputClass}
                  >
                    <option value="">{t("integrations:form.reachServer")}</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {t(
                          d.online
                            ? "integrations:form.reachDevice"
                            : "integrations:form.reachDeviceOffline",
                          {
                            name: d.name,
                          },
                        )}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            )}
          </div>
        )}
        {create.isError && (
          <p role="alert" className="text-bad">
            {t("integrations:form.error")}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={!adapter || (slicer && taken) || once || create.isPending}
          >
            {t("integrations:form.save")}
          </Button>
          <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
        </div>
      </form>
    </>
  );
}
