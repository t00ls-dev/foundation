import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { authClient } from "./auth-client.js";
import {
  AsyncForm,
  FormField,
  type Feedback,
  type FormValues,
} from "./auth-form.js";
import { GoogleSignIn } from "./google-sign-in.js";
import { authPath } from "./auth-destination.js";
import {
  currentSessionGeneration,
  registerSessionRequest,
  releaseSessionRequest,
} from "./session-generation.js";
import {
  totpError,
  totpPolicy,
  totpUnconfirmed,
  type PasswordChallenge,
} from "./totp.js";
import { readTotpSession } from "./totp-session.js";

export function TotpChallenge({
  challenge,
  destination,
  onSignedIn,
  onReconciling,
}: {
  challenge: PasswordChallenge | null;
  destination: string;
  onSignedIn: () => Promise<void>;
  onReconciling: () => void;
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
      <h1>Confirm password sign-in</h1>
      <p>{totpPolicy}</p>
      <p>
        No private access is granted by a password challenge alone. Challenges
        expire after ten minutes.
      </p>
      {blocked ? (
        <>
          <p role="alert">{message}</p>
          {challenge ? (
            <button disabled={checking} onClick={() => void checkSession()}>
              {checking
                ? "Checking current session..."
                : "Check current session"}
            </button>
          ) : null}
        </>
      ) : (
        <AsyncForm
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
      <GoogleSignIn />
      <nav
        className="auth-links"
        aria-label="Authenticator sign-in alternatives"
      >
        <Link to={authPath("/login", destination)}>
          Start a new password sign-in
        </Link>
        <Link to={authPath("/magic-link", destination)}>
          Use Magic Link instead
        </Link>
        <Link to={authPath("/forgot-password", destination)}>
          Password reset (does not remove TOTP)
        </Link>
      </nav>
    </section>
  );
}
