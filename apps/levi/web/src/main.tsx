import { Invitation, takeInvitation } from "./invitation.js";
import { createRoot } from "react-dom/client";
import { Admin } from "./admin.js";
import { App } from "./app.js";
import { takeLinkReturn } from "./session.js";
import "./style.css";
import "./shell.css";

const invitation = takeInvitation();
const link = takeLinkReturn(window.location, window.history);
const root = document.getElementById("root");
if (!root) throw new Error("A interface não pôde ser iniciada.");
createRoot(root).render(
  invitation !== null ? (
    <Invitation token={invitation} />
  ) : window.location.pathname === "/admin" ? (
    <Admin />
  ) : (
    <App link={link} />
  ),
);
