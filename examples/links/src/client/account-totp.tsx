import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import QRCode from "qrcode";
import { authClient } from "./auth-client.js";
import {
  AsyncForm,
  FormField,
  type Feedback,
  type FormValues,
} from "./auth-form.js";
import { authPath } from "./auth-destination.js";
import {
  currentSessionGeneration,
  registerSessionRequest,
  releaseSessionRequest,
} from "./session-generation.js";
import {
  enrollmentSecret,
  totpError,
  totpPolicy,
  totpUnconfirmed,
} from "./totp.js";
import { readTotpSession } from "./totp-session.js";

type Stage = "idle" | "enable" | "resume" | "confirm" | "disable" | "uncertain";
type Setup = { secret: string; qr: string | null };

export function AccountTotp({
  user,
  sessionId,
  onSessionChanged,
}: {
  user: { id: string; email: string };
  sessionId: string;
  onSessionChanged: () => Promise<void>;
}) {
  const [status, setStatus] = useState<"loading" | "error" | "ready">(
    "loading",
  );
  const [enabled, setEnabled] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    function restored(event: PageTransitionEvent) {
      if (!event.persisted) return;
      const pending = Boolean(request.current);
      request.current?.abort();
      setSetup(null);
      setStage(pending ? "uncertain" : "idle");
      setMessage(pending ? totpUnconfirmed : "");
      setRevision((value) => value + 1);
    }
    window.addEventListener("pageshow", restored);
    return () => {
      mounted.current = false;
      request.current?.abort();
      window.removeEventListener("pageshow", restored);
    };
  }, []);

  useEffect(() => {
    const controller = registerSessionRequest();
    const generation = currentSessionGeneration();
    setStatus("loading");
    void readTotpSession(controller.signal)
      .then((session) => {
        if (
          controller.signal.aborted ||
          generation !== currentSessionGeneration()
        )
          return;
        if (
          !session ||
          session.user.id !== user.id ||
          session.user.email !== user.email ||
          session.session.id !== sessionId ||
          typeof session.user.twoFactorEnabled !== "boolean"
        )
          throw new Error("Session identity changed");
        setEnabled(session.user.twoFactorEnabled);
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      })
      .finally(() => releaseSessionRequest(controller));
    return () => {
      controller.abort();
      releaseSessionRequest(controller);
    };
  }, [user.id, user.email, sessionId, revision]);

  function cancel() {
    const pending = Boolean(request.current);
    request.current?.abort();
    request.current = null;
    setSetup(null);
    setStage(pending ? "uncertain" : "idle");
    setMessage(pending ? totpUnconfirmed : "");
  }

  async function mutate(values: FormValues): Promise<Feedback> {
    const operation = stage;
    const controller = registerSessionRequest();
    request.current = controller;
    controller.signal.addEventListener(
      "abort",
      () => {
        if (mounted.current && request.current === controller) {
          setSetup(null);
          setStage("uncertain");
          setMessage(totpUnconfirmed);
        }
      },
      { once: true },
    );
    const generation = currentSessionGeneration();
    const active = () =>
      mounted.current &&
      request.current === controller &&
      !controller.signal.aborted &&
      generation === currentSessionGeneration();
    const fetchOptions = {
      signal: controller.signal,
      retry: 0,
      disableSignal: true,
    };
    try {
      const result =
        operation === "enable"
          ? await authClient.twoFactor.enable({
              password: values.currentPassword!,
              method: "totp",
              fetchOptions,
            })
          : operation === "resume"
            ? await authClient.twoFactor.getTotpUri({
                password: values.currentPassword!,
                fetchOptions,
              })
            : operation === "disable"
              ? await authClient.twoFactor.disable({
                  password: values.currentPassword!,
                  fetchOptions,
                })
              : await authClient.twoFactor.verifyTotp({
                  code: values.code!,
                  trustDevice: false,
                  fetchOptions,
                });
      if (!active())
        return { kind: "error", message: totpUnconfirmed, clearFields: true };
      if (result.error) {
        const failure = totpError(result.error);
        if (
          ["indeterminate", "setup", "expired", "locked"].includes(failure.kind)
        ) {
          setSetup(null);
          setStage("uncertain");
          setMessage(failure.message);
        }
        return {
          kind: "error",
          message: failure.message,
          clearFields: failure.kind !== "password",
        };
      }
      const resolved = await readTotpSession(controller.signal);
      if (!active())
        return { kind: "error", message: totpUnconfirmed, clearFields: true };
      if (
        !resolved ||
        resolved.user.id !== user.id ||
        resolved.user.email !== user.email
      )
        throw new Error("Session identity changed");
      if (operation === "enable" || operation === "resume") {
        if (operation === "enable" && resolved.user.twoFactorEnabled)
          throw new Error("Unexpected enabled state");
        // Pick only the URI; never retain the response's token/user/backup snapshot.
        const data = result.data as { totpURI?: string } | null;
        const uri = data?.totpURI;
        if (!uri) throw new Error("Missing setup");
        const secret = enrollmentSecret(uri);
        const qr = await QRCode.toDataURL(uri, {
          width: 256,
          margin: 2,
          errorCorrectionLevel: "M",
        }).catch(() => null);
        if (!active())
          return { kind: "error", message: totpUnconfirmed, clearFields: true };
        setSetup({ secret, qr });
        setStage("confirm");
        setMessage("");
        return {
          kind: "success",
          message: "Confirm a code to finish setup.",
          clearFields: true,
        };
      }
      const expected = operation === "confirm";
      if (resolved.user.twoFactorEnabled !== expected)
        throw new Error("Unconfirmed authenticator state");
      setSetup(null);
      setEnabled(expected);
      setStage("idle");
      setMessage(
        expected
          ? "Authenticator confirmed for password sign-in."
          : "Authenticator turned off.",
      );
      // Reconciliation is complete; release before the legitimate session rotation
      // invalidates generations/remounts this section. The body is not trusted.
      releaseSessionRequest(controller);
      await onSessionChanged();
      return {
        kind: "success",
        message: expected
          ? "Authenticator confirmed."
          : "Authenticator turned off.",
        clearFields: true,
      };
    } catch {
      if (active()) {
        setSetup(null);
        setStage("uncertain");
        setMessage(totpUnconfirmed);
      }
      return { kind: "error", message: totpUnconfirmed, clearFields: true };
    } finally {
      releaseSessionRequest(controller);
      if (request.current === controller) request.current = null;
    }
  }

  return (
    <section className="auth-page stack" aria-label="Authenticator settings">
      <h2>Authenticator</h2>
      <p>{totpPolicy}</p>
      <p>
        No recovery codes or trusted devices are provided. Password reset does
        not remove TOTP. Existing sessions are not protected retroactively.
      </p>
      <p>
        If setup was interrupted, finish it below even when the reported status
        says On.
      </p>
      {status === "loading" ? (
        <p role="status">Loading authenticator status...</p>
      ) : status === "error" ? (
        <>
          <p role="alert">Could not verify authenticator status.</p>
          <button onClick={() => setRevision((value) => value + 1)}>
            Check authenticator status
          </button>
        </>
      ) : (
        <>
          <p role="status">
            {stage === "uncertain"
              ? "Last reported status: "
              : "Password sign-in authenticator: "}
            {enabled ? "On" : "Off"}
          </p>
          {message ? (
            <p role={stage === "uncertain" ? "alert" : "status"}>{message}</p>
          ) : null}
          {stage === "idle" || stage === "uncertain" ? (
            <div className="actions">
              {stage === "uncertain" ? (
                <button onClick={() => setRevision((value) => value + 1)}>
                  Check authenticator status
                </button>
              ) : null}
              {!enabled && stage !== "uncertain" ? (
                <button
                  onClick={() => {
                    setStage("enable");
                    setMessage("");
                  }}
                >
                  Set up authenticator
                </button>
              ) : null}
              {enabled || stage === "uncertain" ? (
                <>
                  <button
                    className="button--secondary"
                    onClick={() => {
                      setStage("resume");
                      setMessage("");
                    }}
                  >
                    Finish interrupted setup
                  </button>
                  <button
                    className="button--danger"
                    onClick={() => {
                      setStage("disable");
                      setMessage("");
                    }}
                  >
                    Turn off authenticator
                  </button>
                </>
              ) : null}
            </div>
          ) : (
            <>
              {stage === "confirm" && setup ? (
                <div className="card stack">
                  <p>
                    Scan locally with your authenticator app, or enter the setup
                    key manually. Setup is not complete until a code is
                    confirmed.
                  </p>
                  {setup.qr ? (
                    <img
                      className="totp-qr"
                      src={setup.qr}
                      width="256"
                      height="256"
                      alt="Authenticator setup QR code"
                    />
                  ) : (
                    <p role="status">
                      QR unavailable. Enter the setup key manually.
                    </p>
                  )}
                  <label>
                    Setup key
                    <input
                      className="totp-secret"
                      readOnly
                      autoComplete="off"
                      value={setup.secret}
                      aria-label="Setup key"
                    />
                  </label>
                  <p>
                    Keep this key private. Canceling or leaving this page clears
                    it from the browser; start setup again to replace a pending
                    key.
                  </p>
                </div>
              ) : null}
              <AsyncForm
                key={stage}
                title={
                  stage === "confirm"
                    ? "Confirm authenticator"
                    : stage === "disable"
                      ? "Turn off authenticator"
                      : stage === "resume"
                        ? "Finish interrupted setup"
                        : "Set up authenticator"
                }
                action={mutate}
                submitLabel={
                  stage === "confirm"
                    ? "Confirm code"
                    : stage === "disable"
                      ? "Turn off with password"
                      : "Continue with password"
                }
                pendingLabel="Checking authenticator..."
                requiredFields={
                  stage === "confirm" ? ["code"] : ["currentPassword"]
                }
              >
                {stage === "confirm" ? (
                  <FormField
                    label="Authenticator code"
                    name="code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                  />
                ) : (
                  <>
                    <p>
                      {stage === "disable"
                        ? "This turns off TOTP for password sign-in and rotates this session; other sessions remain. Use this explicitly to clean up an interrupted disable."
                        : "Enter your current password. If you have no password, set one using the existing email password link first."}
                    </p>
                    <FormField
                      label="Authenticator account password"
                      name="currentPassword"
                      type="password"
                      autoComplete="current-password"
                    />
                  </>
                )}
              </AsyncForm>
              <button className="button--secondary" onClick={cancel}>
                Cancel authenticator setup
              </button>
            </>
          )}
        </>
      )}
      <nav className="auth-links" aria-label="Authenticator recovery options">
        <Link to={authPath("/magic-link", "/account")}>
          Use Magic Link instead
        </Link>
        <Link to={authPath("/login", "/account")}>
          Sign in again or use Google
        </Link>
      </nav>
    </section>
  );
}
