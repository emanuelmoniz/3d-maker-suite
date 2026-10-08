import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import common from "./locales/en/common.json";

await i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  resources: { en: { common } },
});

document.title = i18n.t("common:appName");
export default i18n;
