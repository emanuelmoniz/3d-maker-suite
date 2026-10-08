import type { ChannelSettings } from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { useChannels, useSaveChannel, useTestChannel } from "../../lib/alerts.ts";

// i18n keys are written out in full so `pnpm i18n:check` can see them.
type Field = { name: string; label: string; secret?: boolean };
const STATUS = {
  saved: "alerts:channels.status.saved",
  testOk: "alerts:channels.status.testOk",
  testFailed: "alerts:channels.status.testFailed",
} as const;
const CHANNELS: { id: string; title: string; fields: Field[] }[] = [
  {
    id: "ntfy",
    title: "alerts:channels.ntfy.name",
    fields: [
      { name: "server", label: "alerts:channels.ntfy.server" },
      { name: "topic", label: "alerts:channels.ntfy.topic" },
      { name: "token", label: "alerts:channels.ntfy.token", secret: true },
    ],
  },
  {
    id: "email",
    title: "alerts:channels.email.name",
    fields: [
      { name: "host", label: "alerts:channels.email.host" },
      { name: "port", label: "alerts:channels.email.port" },
      { name: "user", label: "alerts:channels.email.user" },
      { name: "password", label: "alerts:channels.email.password", secret: true },
      { name: "from", label: "alerts:channels.email.from" },
      { name: "to", label: "alerts:channels.email.to" },
    ],
  },
];

function ChannelForm({ def, saved }: { def: (typeof CHANNELS)[number]; saved?: ChannelSettings }) {
  const { t } = useTranslation();
  const save = useSaveChannel();
  const test = useTestChannel();
  const [status, setStatus] = useState<"saved" | "testOk" | "testFailed" | null>(null);

  const submit = (f: FormData) => {
    const get = (n: string) => String(f.get(n) ?? "").trim();
    const fields = (secret: boolean) =>
      Object.fromEntries(
        def.fields.filter((x) => !!x.secret === secret).map((x) => [x.name, get(x.name)]),
      );
    save.mutate(
      {
        id: def.id,
        input: { enabled: f.get("enabled") === "on", config: fields(false), secrets: fields(true) },
      },
      { onSuccess: () => setStatus("saved"), onError: () => setStatus(null) },
    );
  };

  return (
    <form
      // Re-keyed by what is saved, so the inputs show the stored values after a save.
      key={JSON.stringify(saved)}
      action={submit}
      className="grid gap-3 border-t border-border pt-4 first:border-0 first:pt-0"
    >
      <h3 className="font-medium">{t(def.title)}</h3>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" defaultChecked={saved?.enabled} />
        {t("alerts:channels.enabled")}
      </label>
      {def.fields.map((x) => (
        <FormField
          key={x.name}
          label={t(x.label)}
          hint={
            x.secret && saved?.secretsSet.includes(x.name)
              ? t("alerts:channels.secretKept")
              : undefined
          }
        >
          {(p) => (
            <input
              {...p}
              name={x.name}
              className={inputClass}
              type={x.secret ? "password" : "text"}
              autoComplete="off"
              defaultValue={x.secret ? "" : (saved?.config[x.name] ?? "")}
            />
          )}
        </FormField>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {t("alerts:channels.save")}
        </Button>
        <Button
          disabled={!saved?.enabled || test.isPending}
          onClick={() =>
            test.mutate(def.id, { onSuccess: (r) => setStatus(r.ok ? "testOk" : "testFailed") })
          }
        >
          {t("alerts:channels.test")}
        </Button>
        <span role="status" className={status === "testFailed" ? "text-bad" : "text-muted"}>
          {status && t(STATUS[status])}
          {save.isError && t("alerts:channels.status.invalid")}
        </span>
      </div>
    </form>
  );
}

export function ChannelsSection() {
  const { data } = useChannels();
  return (
    <>
      {CHANNELS.map((def) => (
        <ChannelForm key={def.id} def={def} saved={data?.find((c) => c.id === def.id)} />
      ))}
    </>
  );
}
