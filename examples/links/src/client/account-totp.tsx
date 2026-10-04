import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import QRCode from "qrcode";
import { Button } from "@t00ls-dev/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@t00ls-dev/ui/components/dialog";
import { Skeleton } from "@t00ls-dev/ui/components/skeleton";
import { InlineFeedback } from "@t00ls-dev/ui/patterns/inline-feedback";
import { SettingRow } from "@t00ls-dev/ui/patterns/settings";
import { AuthenticatorKey } from "./authenticator-key.js";
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

type Stage =
  | "idle"
  | "enable"
  | "resume"
  | "confirm"
  | "disable"
  | "uncertain"
  | "reconciling"
  | "complete";
type Setup = { secret: string; qr: string | null };

export function AccountTotp({
  user,
  sessionId,
  onSessionChanged,
  onOpenChange,
  completion,
  onConfirmed,
  recoveryObserved,
  disabled,
  onRecoveryObserved,
}: {
  user: { id: string; email: string };
  sessionId: string;
  onSessionChanged: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  completion: boolean | null;
  onConfirmed: (identity: string, enabled: boolean | null) => void;
  recoveryObserved: boolean;
  disabled: boolean;
  onRecoveryObserved: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "error" | "ready">(
    "loading",
  );
  const [enabled, setEnabled] = useState(false);
  const [stage, setStage] = useState<Stage>(
    completion !== null ? "complete" : recoveryObserved ? "uncertain" : "idle",
  );
  const [setup, setSetup] = useState<Setup | null>(null);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const focusTarget = useRef<HTMLDivElement>(null);
  const [exception, setException] = useState(recoveryObserved);
  function observeException() {
    setException(true);
    onRecoveryObserved();
  }

  useEffect(() => {
    mounted.current = true;
    function restored(event: PageTransitionEvent) {
      if (!event.persisted) return;
      const pending = Boolean(request.current);
      request.current?.abort();
      setSetup(null);
      setStage(pending ? "uncertain" : "idle");
      setMessage(pending ? totpUnconfirmed : "");
      if (pending) observeException();
      onOpenChange(false);
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
    if (pending) observeException();
    onOpenChange(false);
    onConfirmed(`${user.id}:${sessionId}`, null);
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
          observeException();
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
          observeException();
          onOpenChange(false);
        }
        return {
          kind: "error",
          message: failure.message,
          clearFields: failure.kind !== "password",
          ...(failure.kind === "password"
            ? { field: "currentPassword" as const }
            : failure.kind === "code"
              ? { field: "code" as const }
              : {}),
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
      setStage("reconciling");
      setMessage("");
      onConfirmed(`${resolved.user.id}:${resolved.session.id}`, expected);
      // Reconciliation is complete; release before the legitimate session rotation
      // invalidates generations/remounts this section. The body is not trusted.
      releaseSessionRequest(controller);
      await onSessionChanged();
      if (mounted.current) setStage("complete");
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
        observeException();
        onOpenChange(false);
      }
      return { kind: "error", message: totpUnconfirmed, clearFields: true };
    } finally {
      releaseSessionRequest(controller);
      if (request.current === controller) request.current = null;
    }
  }

  const open = [
    "enable",
    "resume",
    "confirm",
    "disable",
    "reconciling",
    "complete",
  ].includes(stage);
  const title =
    stage === "complete"
      ? "Authenticator settings updated"
      : stage === "disable"
        ? "Turn off authenticator"
        : stage === "resume"
          ? "Finish interrupted setup"
          : "Set up authenticator";
  function start(next: Stage) {
    setStage(next);
    setMessage("");
    onOpenChange(true);
  }
  return (
    <section aria-label="Authenticator settings">
      <div ref={focusTarget} tabIndex={-1}>
        <SettingRow
          title="Authenticator"
          description={
            <>
              <p className="m-0">{totpPolicy}</p>
              <p role="status" className="mt-2 min-h-6">
                {status !== "ready"
                  ? "Authenticator status: Unknown"
                  : `${stage === "uncertain" ? "Last reported status: " : "Password sign-in authenticator: "}${enabled ? "On" : "Off"}`}
              </p>
            </>
          }
          action={
            status === "ready" && stage !== "uncertain" ? (
              <Button
                disabled={disabled}
                variant="outline"
                aria-label={enabled ? "Turn off" : "Set up"}
                onClick={() => start(enabled ? "disable" : "enable")}
              >
                {enabled ? "Turn off" : "Set up"}
              </Button>
            ) : undefined
          }
        >
          {status === "loading" ? <Skeleton className="h-11 w-full" /> : null}
          {status === "error" && !message ? (
            <InlineFeedback tone="error" announce="assertive">
              Could not verify authenticator status.
            </InlineFeedback>
          ) : null}
          {status === "error" && !exception ? (
            <Button
              variant="outline"
              onClick={() => setRevision((value) => value + 1)}
            >
              Check authenticator status
            </Button>
          ) : null}
          {message ? (
            <InlineFeedback tone="error" announce="assertive">
              {message}
            </InlineFeedback>
          ) : null}
          {exception ? (
            <div className="grid gap-3">
              <p className="m-0 text-sm">
                A reported On status alone does not confirm an interrupted
                setup. Password reset does not remove TOTP.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  Check authenticator status
                </Button>
                <Button
                  disabled={disabled}
                  variant="outline"
                  onClick={() => start("resume")}
                >
                  Finish interrupted setup
                </Button>
                <Button
                  disabled={disabled}
                  variant="outline"
                  onClick={() => start("disable")}
                >
                  Turn off authenticator
                </Button>
              </div>
              <nav
                className="auth-links"
                aria-label="Authenticator recovery options"
              >
                <Link to={authPath("/magic-link", "/account")}>
                  Use Magic Link instead
                </Link>
                <Link to={authPath("/login", "/account")}>
                  Sign in again or use Google
                </Link>
              </nav>
            </div>
          ) : null}
        </SettingRow>
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) cancel();
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = focusTarget.current;
            (target?.querySelector("button") ?? target)?.focus();
          }}
        >
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {stage === "complete"
              ? "Confirmed with your current session."
              : stage === "confirm"
                ? "Scan the QR code with your authenticator app, then confirm a six-digit code."
                : "Confirm your current password to continue."}
          </DialogDescription>
          {stage === "complete" ? (
            <>
              <p role="status">
                {(completion ?? enabled)
                  ? "Authenticator confirmed for password sign-in."
                  : "Authenticator turned off."}
              </p>
              <Button autoFocus onClick={cancel}>
                Done
              </Button>
            </>
          ) : stage === "reconciling" ? (
            <>
              <InlineFeedback>Updating your current session…</InlineFeedback>
              <Button variant="outline" onClick={cancel}>
                Cancel authenticator setup
              </Button>
            </>
          ) : (
            <>
              {stage === "confirm" && setup ? (
                <div className="grid gap-3">
                  <div className="mx-auto flex aspect-square w-full max-w-64 items-center justify-center">
                    {setup.qr ? (
                      <img
                        className="totp-qr"
                        src={setup.qr}
                        width="256"
                        height="256"
                        alt="Authenticator setup QR code"
                      />
                    ) : (
                      <InlineFeedback>
                        QR unavailable. Enter the setup key manually.
                      </InlineFeedback>
                    )}
                  </div>
                  <AuthenticatorKey secret={setup.secret} />
                </div>
              ) : null}
              <AsyncForm
                key={stage}
                hideTitle
                title={stage === "confirm" ? "Confirm authenticator" : title}
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
                    autoFocus
                    label="Authenticator code"
                    name="code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                  />
                ) : (
                  <>
                    <p className="m-0 text-sm">
                      {stage === "disable"
                        ? "This turns off authenticator codes for password sign-in. Other sessions remain signed in."
                        : "If you don't have a password, use the password email link in Password settings first."}
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
              <Button variant="outline" onClick={cancel}>
                Cancel authenticator setup
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
