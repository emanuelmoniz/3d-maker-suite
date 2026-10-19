import type { Client } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { ApiError } from "../../lib/api.ts";
import { useClient, useSaveClient } from "../../lib/clients.ts";

// The API's `client_<field>_taken` codes, with the message keys written out for `pnpm i18n:check`.
const TAKEN = {
  client_vat_taken: ["vat", "clients:form.taken.vat"],
  client_mobile_taken: ["mobile", "clients:form.taken.mobile"],
  client_email_taken: ["email", "clients:form.taken.email"],
} as const;

function ClientForm({ client }: { client?: Client }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const save = useSaveClient(client?.id);
  const taken =
    save.error instanceof ApiError ? TAKEN[save.error.code as keyof typeof TAKEN] : undefined;
  const error = (field: string) => (taken?.[0] === field ? t(taken[1]) : undefined);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    save.mutate(body as never, {
      onSuccess: (saved) => navigate({ to: "/clients/$id", params: { id: saved.id } }),
    });
  };

  const input = (
    name: "name" | "mobile" | "vat" | "email",
    label: string,
    props: React.ComponentProps<"input"> = {},
  ) => (
    <FormField label={label} error={error(name)}>
      {(p) => (
        <input
          {...p}
          {...props}
          name={name}
          className={inputClass}
          defaultValue={client?.[name] ?? ""}
        />
      )}
    </FormField>
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
      {input("name", t("clients:form.name"), { required: true })}
      {input("mobile", t("clients:form.mobile"), { required: true, type: "tel" })}
      {input("vat", t("clients:form.vat"))}
      {input("email", t("clients:form.email"), { type: "email" })}
      <FormField label={t("clients:form.address")}>
        {(p) => (
          <textarea
            {...p}
            name="address"
            className={`${inputClass} h-20 py-2`}
            defaultValue={client?.address ?? ""}
          />
        )}
      </FormField>
      <FormField label={t("clients:form.notes")}>
        {(p) => (
          <textarea
            {...p}
            name="notes"
            className={`${inputClass} h-20 py-2`}
            defaultValue={client?.notes ?? ""}
          />
        )}
      </FormField>
      {save.isError && !taken && (
        <p role="alert" className="text-bad">
          {t("clients:form.saveError")}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {t("clients:form.save")}
        </Button>
        <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
      </div>
    </form>
  );
}

export function ClientCreatePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("clients:form.addTitle")} backTo={{ to: "/clients" }} />
      <ClientForm />
    </>
  );
}

export function ClientEditPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data, isError } = useClient(id);
  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("clients:detail.notFound")}
      </p>
    );
  if (!data) return null;
  return (
    <>
      <PageHeader
        title={t("clients:form.editTitle")}
        backTo={{ to: "/clients/$id", params: { id } }}
      />
      <ClientForm key={data.updatedAt} client={data} />
    </>
  );
}
