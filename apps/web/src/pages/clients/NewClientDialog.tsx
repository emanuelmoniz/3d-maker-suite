import type { Client } from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";
import { AddDialog } from "../../components/AddDialog.tsx";
import { ClientForm } from "./ClientFormPage.tsx";

/** Modal: add a client without leaving the page (orders, quotes). */
export function NewClientDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (client: Client) => void;
}) {
  const { t } = useTranslation();
  return (
    <AddDialog open={open} title={t("clients:form.addTitle")} onClose={onClose}>
      <ClientForm
        onCancel={onClose}
        onSaved={(c) => {
          onSaved(c);
          onClose();
        }}
      />
    </AddDialog>
  );
}
