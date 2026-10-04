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
  onReconciling: () => void;
  onRecoveryObserved: () => void;
  onAbandon: () => void;
}) {
  const navigate = useNavigate();
  const [blocked, setBlocked] = useState(
    !challenge || !challenge.available || challenge.uncertain,
  );
  const [message, setMessage] = useState(
    !challenge
      ? "Start a new password sign-in to get a challenge. Reloading or leaving this page clears the sign-in context."
      : challenge.uncertain
        ? totpUnconfirmed
        : !challenge.available
          ? "Authenticator setup is incomplete. Use Magic Link or Google, then finish interrupted setup in Account."
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
    // Preserve the read-only recovery state across the legitimate auth-tree
    // remount. A failed final identity read must not reopen code verification.
    setBlocked(true);
    setMessage(totpUnconfirmed);
    onReconciling();
    releaseSessionRequest(controller);
    await onSignedIn();
    // The authenticated route tree legitimately remounts us. Reconfirm identity
    // rather than confusing that remount with a late response for another account.
    if (window.location.pathname !== "/two-factor") return;
    const current = await readTotpSession(new AbortController().signal);
    if (
      current?.user.email.toLowerCase() === challenge.email &&
      window.location.pathname === "/two-factor"
    )
      await navigate(challenge.destination, { replace: true });
  }

  async function verify(values: FormValues): Promise<Feedback> {
    if (!challenge || blocked)
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
          "No matching session could be confirmed. Start a new password sign-in or use Magic Link or Google.",
        );
    } finally {
      releaseSessionRequest(controller);
      if (request.current === controller) request.current = null;
      if (mounted.current) setChecking(false);
    }
  }

  return (
    <section className="auth-page stack" aria-label="Authenticator sign-in">
      <h1>Enter your authenticator code</h1>
      <p>Use the six-digit code from your authenticator app.</p>
      {blocked ? (
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
          title="Authenticator sign-in code"
          submitLabel="Verify code"
          pendingLabel="Verifying code..."
          action={verify}
          requiredFields={["code"]}
        >
          <FormField
            autoFocus
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
    </section>
  );
}
