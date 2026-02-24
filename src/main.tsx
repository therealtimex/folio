import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./components/theme-provider";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="folio-theme">
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
