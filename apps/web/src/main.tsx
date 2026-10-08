import { createRoot } from "react-dom/client";
import "./i18n.ts";
import { App } from "./App.tsx";

// biome-ignore lint/style/noNonNullAssertion: root exists in index.html
createRoot(document.getElementById("root")!).render(<App />);
