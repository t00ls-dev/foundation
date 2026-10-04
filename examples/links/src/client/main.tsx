import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { PageProgressProvider } from "@t00ls-dev/ui/patterns/page-progress";
import { App } from "./app.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <React.StrictMode>
    <PageProgressProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PageProgressProvider>
  </React.StrictMode>,
);
