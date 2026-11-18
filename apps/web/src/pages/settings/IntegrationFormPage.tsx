import {
  type AdapterInfo,
  type Integration,
  isNetworkPrinter,
  PRINTER_SERIAL_FIELD,
  type SourceTestResult,
} from "@3d-maker-suite/core";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { type ControlProps, FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { ApiError } from "../../lib/api.ts";
import { useCan } from "../../lib/auth.ts";
import { textLink } from "../../lib/cx.ts";
import { useDevices } from "../../lib/hub.ts";
import {
  isNetworkSource,
  libraryOf,
  sourceTaken,
  useAdapterName,
  useAdapters,
  useCreateIntegration,
  useIntegrations,
  usePatchIntegration,
  useTryIntegration,
  useWorkerSetUp,
} from "../../lib/integrations.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { printerName, usePrinters } from "../../lib/printers.ts";
import { ERRORS, PICK_ERRORS } from "./integrationLabels.ts";

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

// Literal keys so `pnpm i18n:check` sees them: what the server says about a save or a test.
const FORM_ERRORS: Record<string, string> = {
  invalid_config: "integrations:form.errors.invalid_config",
  invalid_secrets: "integrations:form.errors.invalid_secrets",
  device_not_reaching: "integrations:form.errors.device_not_reaching",
  device_outdated: "integrations:form.errors.device_outdated",
  device_offline: "integrations:form.errors.device_offline",
  hub_off: "integrations:form.errors.hub_off",
  integration_exists: "integrations:form.errors.integration_exists",
  printer_required: "integrations:form.errors.printer_required",
  printer_has_source: "integrations:form.errors.printer_has_source",
  no_printer: "integrations:form.errors.no_printer",
};
/** A save's error, or (a printer on the network that didn't answer at save) the test's. */
const errorKey = (error: unknown) =>
  error instanceof ApiError && error.code
    ? (FORM_ERRORS[error.code] ?? ERRORS[error.code as keyof typeof ERRORS])
    : undefined;

export const tileClass =
  "flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-checked:border-accent has-disabled:cursor-not-allowed has-disabled:opacity-60";

/**
 * A source's fields, its machine and a Test of what is typed in (6.0.0 Step 16): the add form's
 * and the Edit page's. On the Edit page, `saved` fills in the config; a secret is never shown, and
 * left empty it keeps the stored one.
 */
function useSourceForm(adapter: AdapterInfo | undefined, saved?: Integration) {
  const { t, i18n } = useTranslation();
  /** None of the adapter's `configAnyOf` fields was filled in. */
  const [missing, setMissing] = useState(false);
  const tryOut = useTryIntegration();
  // A printer on another network is reached through a machine's connector (ADR-0015, LAN reach).
  const hubOn = !!usePreferences().data?.values.hubEnabled;
  const manageHub = useCan("hub.manage");
  const allDevices = useDevices(hubOn && manageHub).data ?? [];
  const slicer = adapter?.kind === "local" || adapter?.kind === "server";

  // A printer on the network is one printer (ADR-0015): a new one from what it says, or one of
  // yours that no other network source is. Yours keeps its name, model and costs.
  const network = isNetworkPrinter(adapter);
  const readsSerial =
    network && PRINTER_SERIAL_FIELD in ((adapter?.config.properties ?? {}) as object);
  const printers = usePrinters({ archived: false }).data?.items ?? [];
  const integrations = useIntegrations().data ?? [];
  const taken = new Set(
    integrations.filter((i) => i.id !== saved?.id && i.printerId).map((i) => i.printerId),
  );
  // The saved link until another is picked (the row may arrive after the first render).
  const [picked, setPrinter] = useState<string>();
  const printer = picked ?? saved?.printerId ?? "new";
  const chosen = printers.find((p) => p.id === printer);
  // Its serial is the printer's: asked for a new printer only.
  const ownField = (f: Field) =>
    !(readsSerial && printer !== "new" && f.name === PRINTER_SERIAL_FIELD);
  const config = adapter && !slicer ? fieldsOf(adapter.config).filter(ownField) : [];
  const secrets = adapter && !adapter.login ? fieldsOf(adapter.secrets) : [];
  const anyOf = adapter && !slicer ? adapter.configAnyOf : [];
  // Only a machine with the matching switch on: Reach printers, or Reach spool libraries. The one
  // it is reached from now stays, also when its switch went off (it is paused then).
  const devices = allDevices.filter(
    (d) =>
      d.id === saved?.deviceId ||
      (adapter?.capabilities.includes("printerStatus") ? d.reachPrinters : d.reachSpoolLibraries),
  );
  const reach = hubOn && manageHub && !!adapter && isNetworkSource(adapter) && devices.length > 0;
  const label = (name: string) =>
    t(`integrations:adapters.${adapter?.id}.fields.${name}`, { defaultValue: name });
  const anyOfError = !missing
    ? undefined
    : readsSerial && printer !== "new"
      ? t("integrations:form.anyOfPrinter")
      : t(`integrations:adapters.${adapter?.id}.anyOf`, {
          defaultValue: t("integrations:form.anyOf", {
            fields: new Intl.ListFormat(i18n.language, { type: "disjunction" }).format(
              anyOf.map(label),
            ),
          }),
        });
  const stored = (saved?.config ?? {}) as Record<string, unknown>;

  /** What the form holds; undefined (and said) when none of `configAnyOf` is filled in. */
  const values = (form: HTMLFormElement) => {
    const f = new FormData(form);
    const cfg = read(f, "config", config);
    const printerSerial = readsSerial && printer !== "new" && !!chosen?.serial?.trim();
    if (anyOf.length && !printerSerial && !anyOf.some((k) => cfg[k] !== undefined)) {
      setMissing(true);
      return undefined;
    }
    return {
      config: cfg,
      // Empty ones aren't sent: the stored ones stay.
      secrets: read(f, "secrets", secrets) as Record<string, string>,
      deviceId: reach ? String(f.get("deviceId") ?? "") || null : (saved?.deviceId ?? null),
      ...(network && { printer }),
      // A new printer's name: at create only, the printer's own after that (6.1.0 Step 10b).
      ...(network &&
        !saved &&
        printer === "new" && { printerName: String(f.get("printerName") ?? "").trim() }),
    };
  };

  const test = (form: HTMLFormElement | null) => {
    const v = form && adapter && values(form);
    if (!v) return;
    tryOut.mutate({
      adapterId: adapter.id,
      ...v,
      ...(saved && { integrationId: saved.id }),
    });
  };

  const input = (prefix: "config" | "secrets", { name, type, required, options }: Field) => {
    const kept = prefix === "secrets" && saved?.storedKeys?.includes(name);
    const value = prefix === "config" ? stored[name] : undefined;
    return (
      <FormField
        key={`${adapter?.id}-${prefix}-${name}`}
        label={label(name)}
        hint={
          kept
            ? t("integrations:form.secretKept")
            : prefix === "secrets"
              ? t("integrations:form.secretHint")
              : undefined
        }
        // Said once, on the first of the fields it is about.
        error={prefix === "config" && name === anyOf[0] ? anyOfError : undefined}
      >
        {(p) =>
          type === "boolean" ? (
            <input
              {...p}
              type="checkbox"
              name={`${prefix}.${name}`}
              defaultChecked={value === true}
              className="size-4"
            />
          ) : options ? (
            <Combobox
              {...p}
              name={`${prefix}.${name}`}
              defaultValue={typeof value === "string" ? value : undefined}
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
              // A stored key isn't asked again.
              required={required && !kept}
              defaultValue={value === undefined || value === null ? undefined : String(value)}
              type={prefix === "secrets" ? "password" : type === "string" ? "text" : "number"}
              autoComplete={prefix === "secrets" ? "new-password" : "off"}
              className={inputClass}
            />
          )
        }
      </FormField>
    );
  };

  const fields = (
    <div className="grid gap-4 sm:max-w-md">
      {network && (
        <FormField
          key={`${adapter?.id}-printer`}
          label={t("integrations:form.printer")}
          hint={t("integrations:form.printerHint")}
        >
          {(p) => (
            <Combobox
              {...p}
              value={printer}
              onChange={(v) => {
                setPrinter(v);
                setMissing(false);
                if (tryOut.data || tryOut.isError) tryOut.reset();
              }}
              options={[
                { value: "new", label: t("integrations:form.printerNew") },
                ...printers
                  .filter((x) => !taken.has(x.id))
                  .map((x) => ({ value: x.id, label: printerName(t, x) })),
              ]}
            />
          )}
        </FormField>
      )}
      {network &&
        (printer === "new"
          ? !saved && (
              <FormField
                key={`${adapter?.id}-printerName`}
                label={t("integrations:form.printerName")}
                hint={t("integrations:form.printerNameHint")}
              >
                {(p) => <input {...p} name="printerName" maxLength={100} className={inputClass} />}
              </FormField>
            )
          : chosen && (
              <p className="wrap-anywhere">
                <span className="text-muted">{t("integrations:form.printerCurrentName")}: </span>
                {printerName(t, chosen)}
                {saved && (
                  <>
                    {" "}
                    <Link to="/printers/$id/edit" params={{ id: chosen.id }} className={textLink}>
                      {t("integrations:form.printerRename")}
                    </Link>
                  </>
                )}
              </p>
            ))}
      {config.map((field) => input("config", field))}
      {secrets.map((field) => input("secrets", field))}
      {reach ? (
        <FormField
          key={`${adapter.id}-reach`}
          label={t("integrations:form.reach")}
          hint={t("integrations:form.reachHint")}
        >
          {(p) => (
            <ReachSelect
              {...p}
              devices={devices}
              defaultValue={saved ? (saved.deviceId ?? "") : undefined}
            />
          )}
        </FormField>
      ) : (
        saved?.viaDeviceName && (
          <p className="text-muted">
            {t("integrations:account.through", { machine: saved.viaDeviceName })}
          </p>
        )
      )}
    </div>
  );

  return {
    fields,
    hasFields: config.length > 0 || secrets.length > 0,
    values,
    test,
    tryOut,
    /** A changed field: what was said about the old values goes. */
    changed: () => {
      setMissing(false);
      if (tryOut.data || tryOut.isError) tryOut.reset();
    },
  };
}

function ReachSelect({
  devices,
  defaultValue,
  ...p
}: ControlProps & {
  devices: { id: string; name: string; online: boolean }[];
  defaultValue?: string;
}) {
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as { via?: string };
  return (
    <select
      {...p}
      name="deviceId"
      defaultValue={defaultValue ?? (devices.some((d) => d.id === search.via) ? search.via : "")}
      className={inputClass}
    >
      <option value="">{t("integrations:form.reachServer")}</option>
      {devices.map((d) => (
        <option key={d.id} value={d.id}>
          {t(d.online ? "integrations:form.reachDevice" : "integrations:form.reachDeviceOffline", {
            name: d.name,
          })}
        </option>
      ))}
    </select>
  );
}

/** What a Test said: the printer it found, or why it failed. */
function TestLine({ tryOut }: { tryOut: ReturnType<typeof useTryIntegration> }) {
  const { t } = useTranslation();
  const r: SourceTestResult | undefined = tryOut.data;
  if (tryOut.isPending)
    return (
      <p role="status" className="text-muted">
        {t("integrations:form.testing")}
      </p>
    );
  if (tryOut.isError)
    return (
      <p role="status" className="text-bad">
        {t(errorKey(tryOut.error) ?? "integrations:card.actionError")}
      </p>
    );
  if (!r) return null;
  if (!r.ok)
    return (
      <p role="status" className="text-bad">
        {t(ERRORS[r.code])}
      </p>
    );
  const [one] = r.printers;
  const printer =
    one &&
    (one.model
      ? t("integrations:form.printerModel", { name: one.name, model: one.model })
      : one.name);
  return (
    <p role="status" className="wrap-anywhere text-ok">
      {r.printers.length > 1
        ? t("integrations:form.testFoundMany", { count: r.printers.length })
        : !one
          ? t("integrations:card.testOk")
          : one.serial
            ? t("integrations:form.testFoundSerial", { printer, serial: one.serial })
            : t("integrations:form.testFound", { printer })}
    </p>
  );
}

/**
 * Where a slicer goes (6.1.0 Step 9): this server, or a machine with Use slicer as server worker on
 * (ADR-0022). A taken place is disabled with its reason; a machine with the switch off links to its
 * page.
 */
function WhereField({
  name,
  value,
  onChange,
  server,
  machines,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  server: { text: string; taken: boolean };
  machines: {
    id: string;
    name: string;
    hint: string;
    reason?: string;
    off?: boolean;
  }[];
}) {
  const { t } = useTranslation();
  const tile = (v: string, title: string, text: string, disabled: boolean, extra?: ReactNode) => (
    <label key={v} className={tileClass}>
      <input
        type="radio"
        name={name}
        className="mt-1"
        value={v}
        checked={value === v}
        disabled={disabled}
        onChange={() => onChange(v)}
      />
      <span className="grid min-w-0 gap-1">
        <span className="font-medium wrap-anywhere">{title}</span>
        <span className={disabled ? "text-warn" : "text-muted"}>{text}</span>
        {extra}
      </span>
    </label>
  );
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-3 font-semibold">{t("integrations:form.where")}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {tile(
          "server",
          t("integrations:locations.server"),
          server.taken ? t("integrations:form.taken") : server.text,
          server.taken,
        )}
        {machines.map((m) =>
          tile(
            m.id,
            m.name,
            m.reason ?? m.hint,
            !!m.reason,
            m.off && (
              <Link
                to="/hub/devices/$id"
                params={{ id: m.id }}
                className={textLink}
                // A link inside a disabled tile's label still works.
                onClick={(e) => e.stopPropagation()}
              >
                {t("integrations:form.whereOpenMachine")}
              </Link>
            ),
          ),
        )}
      </div>
    </fieldset>
  );
}

/**
 * Add an account, or a slicer: on this server (the one installed here if found, else a download)
 * or on a machine that is a server worker.
 */
export function IntegrationCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const adapterName = useAdapterName();
  const id = useId();
  const search = useSearch({ strict: false }) as { product?: string; via?: string };
  // A machine's install is a slicer's Where, not a product of its own.
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
  // A source that takes usage back is set up once (its spools are keyed by the adapter).
  const once = !slicer && sourceTaken(adapter, existing);
  const form = useSourceForm(adapter);
  // An account that signs in has no key to test before it does.
  const testable = !!adapter && !slicer && !adapter.login && !once;

  // A slicer's machines (ADR-0022): only with the hub on and a worker adapter for its type.
  const hubOn = !!usePreferences().data?.values.hubEnabled;
  const onMachine = useWorkerSetUp(slicer ? product : undefined);
  const machines =
    slicer && hubOn && onMachine.worker
      ? onMachine.devices.map((d) => {
          const found = onMachine.found(d.id);
          return {
            id: d.id,
            name: d.name,
            hint: found?.version
              ? t("integrations:form.whereFoundVersion", { version: found.version })
              : found
                ? t("integrations:form.whereFound")
                : t("integrations:form.whereDownload"),
            reason: onMachine.withRow.has(d.id)
              ? t("integrations:form.whereTaken")
              : !d.useAsWorker
                ? t("integrations:form.whereOff")
                : undefined,
            off: !onMachine.withRow.has(d.id) && !d.useAsWorker,
          };
        })
      : [];
  const free = machines.filter((m) => !m.reason).map((m) => m.id);
  const [pickedWhere, setWhere] = useState<string>();
  // `?via=` preselects its machine; else this server while free; else the first free machine.
  const fallback =
    search.via && free.includes(search.via)
      ? search.via
      : !taken
        ? "server"
        : (free[0] ?? "server");
  const where =
    pickedWhere && (pickedWhere === "server" ? !taken : free.includes(pickedWhere))
      ? pickedWhere
      : fallback;
  const toMachine = slicer && where !== "server";
  const blocked = slicer && (toMachine ? !free.includes(where) : taken);
  const failed = toMachine ? onMachine.create : create;
  const failedCode =
    toMachine && failed.error instanceof ApiError && failed.error.code
      ? PICK_ERRORS[failed.error.code]
      : undefined;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!adapter) return;
    if (toMachine) {
      onMachine.setUp(where, {
        onSuccess: (row) => navigate({ to: "/integrations", hash: `integration-${row.id}` }),
      });
      return;
    }
    const v = form.values(e.currentTarget);
    if (!v) return;
    create.mutate(
      {
        adapterId: adapter.id,
        config: v.config,
        secrets: v.secrets,
        ...(v.deviceId && { deviceId: v.deviceId }),
        ...(v.printer && { printer: v.printer }),
        ...(v.printerName && { printerName: v.printerName }),
      },
      {
        onSuccess: (row) =>
          adapter.login
            ? navigate({ to: "/integrations/$id/login", params: { id: row.id } })
            : navigate({ to: "/integrations", hash: `integration-${row.id}` }),
      },
    );
  };

  return (
    <>
      <PageHeader title={t("integrations:form.title")} backTo={{ to: "/integrations" }} />
      <form onSubmit={onSubmit} onInput={form.changed} className="grid max-w-2xl gap-8">
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
                    form.changed();
                  }}
                />
                <span className="font-medium">{adapterName(p)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {slicer && adapter && (
          <WhereField
            name={`${id}-where`}
            value={where}
            onChange={setWhere}
            server={{
              taken,
              text: t(
                adapter.kind === "local"
                  ? "integrations:form.installedHere"
                  : "integrations:form.downloadHere",
                { name: adapterName(product ?? "") },
              ),
            }}
            machines={machines}
          />
        )}

        {once && <p className="text-warn">{t("integrations:form.takenSource")}</p>}
        {!once && !toMachine && form.hasFields && form.fields}
        {testable && <TestLine tryOut={form.tryOut} />}
        {failed.isError && (
          <p role="alert" className="text-bad">
            {t(failedCode ?? errorKey(failed.error) ?? "integrations:form.error")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={!adapter || blocked || once || failed.isPending}
          >
            {t("integrations:form.save")}
          </Button>
          {testable && (
            <Button busy={form.tryOut.isPending} onClick={(e) => form.test(e.currentTarget.form)}>
              {t("integrations:form.test")}
            </Button>
          )}
          <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
        </div>
      </form>
    </>
  );
}

/**
 * Edit a network source or an account (6.0.0 Step 16): the add form's fields with what is saved,
 * keys left empty kept, the machine it is reached from, and Test before saving.
 */
export function IntegrationEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const adapterName = useAdapterName();
  const { id } = useParams({ strict: false }) as { id: string };
  const integrations = useIntegrations();
  const saved = integrations.data?.find((i) => i.id === id);
  const adapter = useAdapters().data?.find((a) => a.id === saved?.adapterId);
  const patch = usePatchIntegration(id);
  const editable = !!adapter && adapter.kind !== "local" && adapter.kind !== "server";
  const form = useSourceForm(editable ? adapter : undefined, saved);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!saved || !editable) return;
    const v = form.values(e.currentTarget);
    if (!v) return;
    patch.mutate(
      {
        config: v.config,
        ...(Object.keys(v.secrets).length > 0 && { secrets: v.secrets }),
        // Only a new machine: picking one is hub.manage, and the one it has may be switched off.
        ...(v.deviceId !== (saved.deviceId ?? null) && { deviceId: v.deviceId }),
        // Another printer moves the link; a source with none yet gets one.
        ...(v.printer && v.printer !== saved.printerId && { printer: v.printer }),
      },
      { onSuccess: () => navigate({ to: "/integrations", hash: `integration-${saved.id}` }) },
    );
  };

  const name = saved
    ? saved.account?.name || saved.account?.email || adapterName(saved.adapterId)
    : "";
  return (
    <>
      <PageHeader
        title={t("integrations:form.editTitle", { name })}
        backTo={{ to: "/integrations" }}
      />
      {integrations.isSuccess && (!saved || (adapter && !editable)) ? (
        <p className="text-muted">{t("integrations:form.notEditable")}</p>
      ) : (
        <form
          // A new form once the row is there: the fields start from what is saved.
          key={saved && adapter ? saved.id : "loading"}
          onSubmit={onSubmit}
          onInput={form.changed}
          className="grid max-w-2xl gap-8"
        >
          {form.fields}
          <TestLine tryOut={form.tryOut} />
          {patch.isError && (
            <p role="alert" className="text-bad">
              {t(errorKey(patch.error) ?? "integrations:form.editError")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={!saved || !editable || patch.isPending}
            >
              {t("integrations:form.saveChanges")}
            </Button>
            <Button
              disabled={!saved || !editable}
              busy={form.tryOut.isPending}
              onClick={(e) => form.test(e.currentTarget.form)}
            >
              {t("integrations:form.test")}
            </Button>
            <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
          </div>
        </form>
      )}
    </>
  );
}
