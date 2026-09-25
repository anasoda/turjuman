import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { UiProvider } from "./components/ui";
import { SessionProvider } from "./lib/session";
import { applyTheme, getTheme } from "./lib/theme";
import "./styles/global.css";

applyTheme(getTheme());
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme(getTheme()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <UiProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </UiProvider>
    </BrowserRouter>
  </StrictMode>
);
