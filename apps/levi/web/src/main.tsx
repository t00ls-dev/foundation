import { createRoot } from "react-dom/client";
import { Admin } from "./admin.js";
import { App } from "./app.js";
import { takeLinkReturn } from "./session.js";
import "./style.css";
import "./shell.css";

const link = takeLinkReturn(window.location, window.history);
const root = document.getElementById("root");
if (!root) throw new Error("A interface não pôde ser iniciada.");
createRoot(root).render(
  window.location.pathname === "/admin" ? <Admin /> : <App link={link} />,
);
