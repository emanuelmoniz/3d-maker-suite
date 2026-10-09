import type { AdapterInfo } from "@3d-maker-suite/core";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useAdapterName, useAdapters, useCreateIntegration } from "../../lib/integrations.ts";

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

export function IntegrationCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const adapterName = useAdapterName();
  const adapters = useAdapters().data ?? [];
  const create = useCreateIntegration();
  const [adapterId, setAdapterId] = useState("");
  const adapter = adapters.find((a) => a.id === (adapterId || adapters[0]?.id));
  const config = adapter ? fieldsOf(adapter.config) : [];
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
            ? navigate({ to: "/settings/integrations/$id/login", params: { id: row.id } })
            : navigate({ to: "/settings/integrations" }),
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
          <select {...p} name={`${prefix}.${name}`} className={inputClass}>
            {options.map((o) => (
              <option key={o} value={o}>
                {t(`integrations:adapters.${adapter?.id}.options.${name}.${o}`, {
                  defaultValue: o,
                })}
              </option>
            ))}
          </select>
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
      <PageHeader title={t("integrations:form.title")} backTo={{ to: "/settings/integrations" }} />
      <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
        <FormField label={t("integrations:form.adapter")}>
          {(p) => (
            <select
              {...p}
              className={inputClass}
              value={adapter?.id ?? ""}
              onChange={(e) => setAdapterId(e.target.value)}
            >
              {adapters.map((a) => (
                <option key={a.id} value={a.id}>
                  {adapterName(a.id)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        {config.map((field) => input("config", field))}
        {secrets.map((field) => input("secrets", field))}
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
