import type { Delivery } from "@3d-maker-suite/core";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Section } from "../../components/Section.tsx";
import { Switch } from "../../components/Switch.tsx";
import { useMe, useMyRole, useRights, useUpdateMe } from "../../lib/auth.ts";
import { useDelivery, useSaveDelivery, useTestDelivery } from "../../lib/users.ts";
import { AccountSection } from "./AccountSection.tsx";
import { AlertKindsEditor } from "./AlertKindsEditor.tsx";

function DeliveryForm({ delivery, email }: { delivery: Delivery; email: string }) {
  const { t } = useTranslation();
  const save = useSaveDelivery();
  const test = useTestDelivery();
  const [on, setOn] = useState(delivery.email);
  const [clearToken, setClearToken] = useState(false);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const token = String(f.get("ntfyToken") ?? "");
    save.mutate({
      email: on,
      emailTo: String(f.get("emailTo") ?? ""),
      ntfyTopic: String(f.get("ntfyTopic") ?? ""),
      // Empty keeps the stored token; null removes it.
      ntfyToken: clearToken ? null : token,
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-muted">{t("users:delivery.hint")}</p>
      <div>
        <Switch
          label={t("users:delivery.email")}
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
        />
      </div>
      <FormField
        label={t("users:delivery.emailTo")}
        hint={t("users:delivery.emailToHint", { email })}
      >
        {(p) => (
          <input
            {...p}
            name="emailTo"
            type="email"
            defaultValue={delivery.emailTo ?? ""}
            placeholder={email}
            className={inputClass}
          />
        )}
      </FormField>
      <FormField label={t("users:delivery.ntfyTopic")} hint={t("users:delivery.ntfyTopicHint")}>
        {(p) => (
          <input
            {...p}
            name="ntfyTopic"
            defaultValue={delivery.ntfyTopic ?? ""}
            maxLength={64}
            pattern="[\-\w]*"
            autoComplete="off"
            className={inputClass}
          />
        )}
      </FormField>
      <FormField
        label={t("users:delivery.ntfyToken")}
        hint={t(delivery.ntfyTokenSet ? "users:delivery.tokenSet" : "users:delivery.tokenHint")}
      >
        {(p) => (
          <input
            {...p}
            name="ntfyToken"
            type="password"
            autoComplete="off"
            disabled={clearToken}
            maxLength={200}
            className={inputClass}
          />
        )}
      </FormField>
      {delivery.ntfyTokenSet && (
        <Switch
          label={t("users:delivery.removeToken")}
          checked={clearToken}
          onChange={(e) => setClearToken(e.target.checked)}
        />
      )}
      {save.isError && (
        <p role="alert" className="text-bad">
          {t("users:account.error")}
        </p>
      )}
      {save.isSuccess && (
        <p role="status" className="text-muted">
          {t("users:delivery.saved")}
        </p>
      )}
      {test.data && (
        <p role="status" className="text-muted">
          {test.data.length
            ? test.data
                .map((r) =>
                  t(r.ok ? "users:delivery.testOk" : "users:delivery.testFailed", {
                    channel: r.channel === "email" ? t("users:delivery.email") : "ntfy",
                  }),
                )
                .join(" ")
            : t("users:delivery.testNone")}
        </p>
      )}
      {test.isError && (
        <p role="alert" className="text-bad">
          {t("users:account.error")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {t("common:actions.save")}
        </Button>
        <Button disabled={test.isPending || save.isPending} onClick={() => test.mutate()}>
          {t("users:delivery.test")}
        </Button>
      </div>
    </form>
  );
}

/** My account: name and password, which alerts I get, and where notify alerts go. */
export function MyAccountPage() {
  const { t } = useTranslation();
  const user = useMe();
  const role = useMyRole();
  const rights = useRights();
  const update = useUpdateMe();
  const delivery = useDelivery();

  return (
    <>
      <PageHeader title={t("users:account.title")} description={user?.email} />
      {!user || !rights ? (
        <p className="text-muted">{t("users:account.noAccounts")}</p>
      ) : (
        <div className="grid max-w-2xl gap-5">
          <Section title={t("users:account.profile")}>
            <AccountSection />
          </Section>
          <Section title={t("users:alerts.title")} id="alerts" wide>
            <p className="mb-3 text-muted">{t("users:alerts.mineHint", { role: role?.name })}</p>
            <AlertKindsEditor
              permissions={rights.permissions}
              value={user.alertKinds}
              role={role?.alertKinds ?? {}}
              onChange={(alertKinds) => update.mutate({ alertKinds })}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                disabled={update.isPending || !Object.keys(user.alertKinds).length}
                onClick={() => update.mutate({ alertKinds: {} })}
              >
                {t("users:alerts.resetAll")}
              </Button>
              {update.isError && (
                <span role="alert" className="text-bad">
                  {t("users:account.error")}
                </span>
              )}
            </div>
          </Section>
          <Section title={t("users:delivery.title")} id="delivery">
            {delivery.data ? (
              <DeliveryForm
                key={JSON.stringify(delivery.data)}
                delivery={delivery.data}
                email={user.email}
              />
            ) : delivery.isError ? (
              <p role="alert" className="text-bad">
                {t("users:account.error")}
              </p>
            ) : null}
          </Section>
        </div>
      )}
    </>
  );
}
