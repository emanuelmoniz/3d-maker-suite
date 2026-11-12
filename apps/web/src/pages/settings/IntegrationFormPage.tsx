import type { AdapterInfo } from "@3d-maker-suite/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import {
  libraryOf,
  useAdapterName,
  useAdapters,
  useCreateIntegration,
  useIntegrations,
} from "../../lib/integrations.ts";

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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const adapterName = useAdapterName();
  const id = useId();
  const search = useSearch({ strict: false }) as { product?: string };
  // A workstation's slicer is set up on its machine page (Plan 5.5.0 Step 9).
  const adapters = (useAdapters().data ?? []).filter((a) => a.kind !== "worker");
  const existing = useIntegrations().data ?? [];
  const create = useCreateIntegration();

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

  const config = adapter && !slicer ? fieldsOf(adapter.config) : [];
  const secrets = adapter && !adapter.login ? fieldsOf(adapter.secrets) : [];

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!adapter) return;
    const f = new FormData(e.currentTarget);
    create.mutate(
      {
        adapterId: adapter.id,
        config: read(f, "config", config),
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
          <Button
            type="submit"
            variant="primary"
            disabled={!adapter || (slicer && taken) || create.isPending}
          >
            {t("integrations:form.save")}
          </Button>
          <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
        </div>
      </form>
    </>
  );
}
