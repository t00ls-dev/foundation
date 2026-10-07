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
import { Spinner } from "@t00ls-dev/ui/components/spinner";
import { useConfirmedFeedback } from "@t00ls-dev/ui/patterns/feedback";
import { X } from "lucide-react";
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
import { enrollmentSecret, totpError, totpUnconfirmed } from "./totp.js";
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
  const confirmed = useConfirmedFeedback();
  const completionAnnounced = useRef(false);
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

  useEffect(() => {
    // A handoff is only presented after this exact replacement session has
    // independently confirmed its state. Unknown/error never completes setup.
    if (
      stage !== "complete" ||
      status === "loading" ||
      completionAnnounced.current
    )
      return;
    if (status === "error" || (completion !== null && enabled !== completion)) {
      setStage("uncertain");
      setMessage(totpUnconfirmed);
      observeException();
      onOpenChange(false);
      onConfirmed(`${user.id}:${sessionId}`, null);
      return;
    }
    completionAnnounced.current = true;
    setStage("idle");
    onOpenChange(false);
    onConfirmed(`${user.id}:${sessionId}`, null);
    confirmed(
      `authenticator:${user.id}:${sessionId}:${enabled}`,
      enabled ? "Authenticator enabled." : "Authenticator turned off.",
    );
    const target = focusTarget.current;
    (target?.querySelector("button") ?? target)?.focus();
  }, [
    stage,
    status,
    completion,
    enabled,
    confirmed,
    onConfirmed,
    onOpenChange,
    user.id,
    sessionId,
  ]);

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
      if (mounted.current) {
        setStatus("loading");
        setRevision((value) => value + 1);
        setStage("complete");
      }
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
    completionAnnounced.current = false;
    setStage(next);
    setMessage("");
    onOpenChange(true);
  }
  return (
    <section
      aria-label="Authenticator settings"
      aria-busy={status === "loading"}
    >
      <div ref={focusTarget} tabIndex={-1}>
        <SettingRow
          title={
            <span className="flex flex-wrap items-center gap-3">
              Authenticator
              <span
                role="status"
                aria-label="Authenticator status"
                className="inline-flex items-center text-sm font-medium text-primary"
              >
                {status !== "ready" ? (
                  status === "loading" ? (
                    <Skeleton className="h-5 w-10" />
                  ) : (
                    "Status unavailable"
                  )
                ) : (
                  `${stage === "uncertain" ? "Last reported: " : ""}${enabled ? "On" : "Off"}`
                )}
              </span>
            </span>
          }
          description="For password sign-in."
          action={
            status === "ready" && stage !== "uncertain" ? (
              <Button
                disabled={disabled}
                variant="ghost"
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
                  Use another sign-in method
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
          aria-busy={stage === "reconciling" || stage === "complete"}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = focusTarget.current;
            (target?.querySelector("button") ?? target)?.focus();
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>
              {stage === "complete" ? "Authenticator" : title}
            </DialogTitle>
            <Button
              variant="ghost"
              className="px-2"
              aria-label="Close"
              onClick={cancel}
            >
              <X size={20} aria-hidden="true" />
            </Button>
          </div>
          <DialogDescription>
            {stage === "complete" ? (
              <span className="sr-only">Checking authenticator status.</span>
            ) : stage === "confirm" ? (
              "Scan the QR code with your authenticator app, then confirm a six-digit code."
            ) : (
              "Confirm your current password to continue."
            )}
          </DialogDescription>
          {stage === "complete" ? (
            <div role="status">
              <Spinner />
              <span className="sr-only">Checking authenticator status.</span>
              {status === "error" ? (
                <>
                  <InlineFeedback tone="error">
                    Could not verify authenticator status.
                  </InlineFeedback>
                  <Button onClick={() => setRevision((value) => value + 1)}>
                    Check authenticator status
                  </Button>
                </>
              ) : null}
            </div>
          ) : stage === "reconciling" ? (
            <div role="status">
              <Spinner />
              <span className="sr-only">Updating your current session…</span>
            </div>
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
                  <AuthenticatorKey
                    secret={setup.secret}
                    initiallyOpen={!setup.qr}
                  />
                </div>
              ) : null}
              <AsyncForm
                key={stage}
                hideTitle
                hideSuccess
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
                    {stage === "disable" ? (
                      <p className="m-0 text-sm">
                        Authenticator codes will no longer be required for
                        password sign-in. Other sessions stay signed in.
                      </p>
                    ) : null}
                    <FormField
                      label="Current password"
                      name="currentPassword"
                      type="password"
                      autoComplete="current-password"
                    />
                  </>
                )}
              </AsyncForm>
              <Button variant="outline" onClick={cancel}>
                Cancel
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
