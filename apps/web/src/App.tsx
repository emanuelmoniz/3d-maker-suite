import { useTranslation } from "react-i18next";

export function App() {
  const { t } = useTranslation();
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem" }}>
      <h1>{t("appName")}</h1>
      <p>{t("hello")}</p>
    </main>
  );
}
