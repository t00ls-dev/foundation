import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
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
import { totpError, totpUnconfirmed, type PasswordChallenge } from "./totp.js";
import { readTotpSession } from "./totp-session.js";
import { InlineFeedback } from "@t00ls-dev/ui/patterns/inline-feedback";
import { PendingButton } from "@t00ls-dev/ui/patterns/pending-button";
import { Spinner } from "@t00ls-dev/ui/components/spinner";
import { AuthLayout } from "./auth-layout.js";

export function TotpChallenge({
  challenge,
  destination,
  onSignedIn,
  onReconciling,
  onRecoveryObserved,
  onAbandon,
}: {
  challenge: PasswordChallenge | null;
  destination: string;
  onSignedIn: () => Promise<void>;
  onReconciling: () => () => void;
  onRecoveryObserved: () => void;
  onAbandon: () => void;
}) {
  const navigate = useNavigate();
  const [blocked, setBlocked] = useState(
    !challenge ||
      !challenge.available ||
      challenge.uncertain ||
      Boolean(challenge.reconciling),
  );
  const [message, setMessage] = useState(
    !challenge
      ? "Start a new password sign-in to get a challenge. Reloading or leaving this page clears the sign-in context."
      : challenge.uncertain || challenge.reconciling
        ? totpUnconfirmed
        : !challenge.available
          ? "Authenticator setup is incomplete. Use another sign-in method, then finish interrupted setup in Account."
          : "",
  );
  const [checking, setChecking] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    function restored(event: PageTransitionEvent) {
      if (event.persisted) {
        request.current?.abort();
        setBlocked(true);
        setMessage("Start a new password sign-in to get a challenge.");
      }
    }
    window.addEventListener("pageshow", restored);
    return () => {
      mounted.current = false;
      request.current?.abort();
      window.removeEventListener("pageshow", restored);
    };
  }, []);

  async function finish(
    controller: AbortController,
    active: () => boolean,
    verifying: boolean,
  ) {
    const resolved = await readTotpSession(controller.signal);
    if (!active()) return;
    if (
      !challenge ||
      !resolved ||
      resolved.user.email.toLowerCase() !== challenge.email ||
      (verifying && resolved.user.twoFactorEnabled !== true)
    )
      throw new Error("Could not confirm expected identity");
    // Keep verification closed across the legitimate auth-tree remount, but
    // pending reconciliation is not an indeterminate outcome yet.
    setBlocked(true);
    setMessage(totpUnconfirmed);
    const reconciliationFailed = onReconciling();
    releaseSessionRequest(controller);
    try {
      await onSignedIn();
      // The authenticated route tree legitimately remounts us. Reconfirm identity
      // rather than confusing that remount with a late response for another account.
      if (window.location.pathname !== "/two-factor") return;
      const current = await readTotpSession(new AbortController().signal);
      if (window.location.pathname !== "/two-factor") return;
      if (current?.user.email.toLowerCase() !== challenge.email)
        throw new Error("Could not confirm expected identity");
      await navigate(challenge.destination, { replace: true });
    } catch (error) {
      // The initiating instance may have unmounted during session rotation;
      // report failure to this exact challenge at the surviving boundary.
      reconciliationFailed();
      throw error;
    }
  }

  async function verify(values: FormValues): Promise<Feedback> {
    if (!challenge || blocked || challenge.reconciling)
      return {
        kind: "error",
        message: "Start a new password sign-in.",
        clearFields: true,
      };
    const controller = registerSessionRequest();
    request.current = controller;
    controller.signal.addEventListener(
      "abort",
      () => {
        if (mounted.current && request.current === controller) {
          setBlocked(true);
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
      window.location.pathname === "/two-factor" &&
      generation === currentSessionGeneration();
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: values.code!,
        trustDevice: false,
        fetchOptions: {
          signal: controller.signal,
          retry: 0,
          disableSignal: true,
        },
      });
      if (!active())
        return { kind: "error", message: totpUnconfirmed, clearFields: true };
      if (result.error) {
        const failure = totpError(result.error);
        if (failure.kind === "setup" || failure.kind === "indeterminate")
          onRecoveryObserved();
        if (failure.kind !== "code" && failure.kind !== "rate") {
          setBlocked(true);
          setMessage(failure.message);
        }
        return { kind: "error", message: failure.message, clearFields: true };
      }
      await finish(controller, active, true);
      return {
        kind: "success",
        message: "Session confirmed.",
        clearFields: true,
      };
    } catch {
      if (active()) {
        setBlocked(true);
        setMessage(totpUnconfirmed);
        onRecoveryObserved();
      }
      return { kind: "error", message: totpUnconfirmed, clearFields: true };
    } finally {
      releaseSessionRequest(controller);
      if (request.current === controller) request.current = null;
    }
  }

  async function checkSession() {
    if (!challenge || request.current) return;
    const controller = registerSessionRequest();
    request.current = controller;
    setChecking(true);
    const generation = currentSessionGeneration();
    const active = () =>
      mounted.current &&
      !controller.signal.aborted &&
      generation === currentSessionGeneration();
    try {
      await finish(controller, active, false);
    } catch {
      if (active())
        setMessage(
          "No matching session could be confirmed. Start a new password sign-in or use another sign-in method.",
        );
    } finally {
      releaseSessionRequest(controller);
      if (request.current === controller) request.current = null;
      if (mounted.current) setChecking(false);
    }
  }

  return (
    <AuthLayout title="Authenticator code">
      <p>Enter the code from your authenticator app.</p>
      {challenge?.reconciling ? (
        <div role="status" aria-busy="true" aria-label="Confirming session">
          <Spinner />
          <span className="sr-only">Confirming your session…</span>
        </div>
      ) : blocked ? (
        <>
          <InlineFeedback tone="error" announce="assertive">
            {message}
          </InlineFeedback>
          {challenge ? (
            <PendingButton
              pending={checking}
              pendingLabel="Checking current session..."
              onClick={() => void checkSession()}
            >
              Check current session
            </PendingButton>
          ) : null}
        </>
      ) : (
        <AsyncForm
          hideTitle
          hideSuccess
          compact
          title="Authenticator sign-in code"
          submitLabel="Verify code"
          pendingLabel="Verifying code..."
          action={verify}
          requiredFields={["code"]}
        >
          <FormField
            label="Authenticator code"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
          />
        </AsyncForm>
      )}
      <nav
        className="auth-links"
        aria-label="Authenticator sign-in alternatives"
      >
        <Link to={authPath("/login", destination)} replace onClick={onAbandon}>
          Use another sign-in method
        </Link>
      </nav>
    </AuthLayout>
  );
}
