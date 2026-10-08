import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import common from "./locales/en/common.json";
import nav from "./locales/en/nav.json";

// Feature namespaces are code-split and loaded on demand by route loaders.
const lazy = import.meta.glob<{ default: object }>("./locales/*/*.json");

export async function loadNamespace(ns: string) {
  const lng = i18n.resolvedLanguage ?? "en";
  if (i18n.hasResourceBundle(lng, ns)) return;
  const load = lazy[`./locales/${lng}/${ns}.json`];
  if (load) i18n.addResourceBundle(lng, ns, (await load()).default);
}

await i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  resources: { en: { common, nav } },
  interpolation: { escapeValue: false },
});

export default i18n;
