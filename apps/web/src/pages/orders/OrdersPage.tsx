import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SettingsLink } from "../../components/SettingsLink.tsx";
import { Write } from "../../components/Write.tsx";
import { OrdersTable } from "./OrdersTable.tsx";

export function OrdersPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        title={t("nav:items.orders.label")}
        description={t("nav:items.orders.description")}
        actions={
          <Write>
            <Link
              to="/orders/new"
              className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90"
            >
              <Plus className="size-4" aria-hidden />
              {t("orders:list.add")}
            </Link>
            <SettingsLink module="orders" />
          </Write>
        }
      />
      <OrdersTable />
    </>
  );
}
