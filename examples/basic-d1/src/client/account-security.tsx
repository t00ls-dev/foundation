import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { accountSecuritySchema } from "../shared/account-security.js";
import { apiRequest } from "./api.js";
import { authClient } from "./auth-client.js";
import {
  AsyncForm,
  FormField,
  type Feedback,
  type FormValues,
} from "./auth-form.js";
import {
  registerSessionRequest,
  releaseSessionRequest,
} from "./session-generation.js";

const unconfirmed =
  "We couldn't confirm whether your password change completed. Try signing in again. If needed, use password reset.";

export function AccountSecurity({
  user,
  onSessionChanged,
}: {
  user: { id: string; email: string };
  onSessionChanged: () => Promise<void>;
}) {
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [passwordPresent, setPasswordPresent] = useState(false);
  const [revision, setRevision] = useState(0);
  const authRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    void apiRequest("/api/account/security", accountSecuritySchema, {
      signal: controller.signal,
    })
      .then(({ hasPassword }) => {
        if (controller.signal.aborted) return;
        setPasswordPresent(hasPassword);
        setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => {
      controller.abort();
      authRequest.current?.abort();
    };
  }, [user.id, revision]);

  async function change(values: FormValues): Promise<Feedback> {
    const controller = registerSessionRequest();
    authRequest.current = controller;
    try {
      const result = await authClient.changePassword({
        currentPassword: values.currentPassword!,
        newPassword: values.password!,
        revokeOtherSessions: true,
        fetchOptions: { signal: controller.signal, retry: 0 },
      });
      // Do not abort our completed mutation when the legitimate session rotates.
      releaseSessionRequest(controller);
      if (result.error) {
        if (
          result.error.status === 400 &&
          result.error.code === "INVALID_PASSWORD"
        )
          return { kind: "error", message: "Current password is incorrect." };
        if (
          result.error.status === 400 &&
          ["PASSWORD_TOO_SHORT", "PASSWORD_TOO_LONG"].includes(
            result.error.code ?? "",
          )
        )
          return {
            kind: "error",
            message: "Password does not meet the server requirements.",
          };
        return { kind: "error", message: unconfirmed, clearFields: true };
      }
      await onSessionChanged();
      const resolved = await authClient.getSession({
        query: { disableCookieCache: true },
      });
      if (resolved.error || resolved.data?.user.id !== user.id)
        return { kind: "error", message: unconfirmed, clearFields: true };
      return {
        kind: "success",
        message: "Password updated. Other sessions have been signed out.",
        clearFields: true,
      };
    } catch {
      return { kind: "error", message: unconfirmed, clearFields: true };
    } finally {
      releaseSessionRequest(controller);
      if (authRequest.current === controller) authRequest.current = null;
    }
  }

  async function sendReset(): Promise<Feedback> {
    const controller = registerSessionRequest();
    authRequest.current = controller;
    try {
      const result = await authClient.requestPasswordReset({
        email: user.email,
        redirectTo: "/reset-password",
        fetchOptions: { signal: controller.signal, retry: 0 },
      });
      return result.error
        ? {
            kind: "error",
            message: "Could not request a password link. Please try again.",
          }
        : {
            kind: "success",
            message: "If the account exists, a reset link was sent.",
          };
    } catch {
      return {
        kind: "error",
        message: "Could not request a password link. Please try again.",
      };
    } finally {
      releaseSessionRequest(controller);
      if (authRequest.current === controller) authRequest.current = null;
    }
  }

  return (
    <section className="auth-page" aria-label="Account security">
      <h1>Security</h1>
      {state === "loading" ? (
        <p role="status">Loading security settings...</p>
      ) : state === "error" ? (
        <>
          <p role="alert">
            Could not load security settings. Please try again.
          </p>
          <button onClick={() => setRevision((value) => value + 1)}>
            Retry security settings
          </button>
        </>
      ) : passwordPresent ? (
        <>
          <p>
            Changing your password signs out other sessions. This browser
            receives a replacement session.
          </p>
          <AsyncForm
            title="Change password"
            action={change}
            submitLabel="Change password"
            pendingLabel="Changing password..."
            requiredFields={["currentPassword", "password", "confirmPassword"]}
          >
            <FormField
              label="Current password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
            />
            <FormField
              label="New password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
            />
            <FormField
              label="Confirm new password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
            />
          </AsyncForm>
        </>
      ) : (
        <>
          <p>You don't have a password yet.</p>
          <p>
            Use an email link to set one. Password reset does not sign out
            existing sessions.
          </p>
          <AsyncForm
            title="Set a password by email"
            action={sendReset}
            submitLabel="Send password link"
            pendingLabel="Sending password link..."
            requiredFields={[]}
          >
            <p>The link will be sent to your account email.</p>
          </AsyncForm>
        </>
      )}
      <nav className="auth-links" aria-label="Security options">
        <Link to="/">Back to bookmarks</Link>
        <Link to="/forgot-password">Use password reset</Link>
      </nav>
    </section>
  );
}
