import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./components/theme-provider";
import "./index.css";

import { LanguageProvider } from "./context/LanguageContext";
import { AppProvider } from "./context/AppContext";
import { TTSProvider } from "./context/TTSContext";
import { ToastContainer } from "./components/Toast";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="folio-theme">
      <LanguageProvider>
        <AppProvider>
          <TTSProvider>
            <App />
            <ToastContainer />
          </TTSProvider>
        </AppProvider>
      </LanguageProvider>
    </ThemeProvider>
  </React.StrictMode>
);
