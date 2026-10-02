import { useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { publicAuthConfigSchema } from "../shared/auth-config.js";
import { apiRequest } from "./api.js";
import { authClient } from "./auth-client.js";
import googleLogo from "./google-g.svg";

type Capability =
  { status: "loading" | "error" } | { status: "ready"; googleEnabled: boolean };

const signInError = "Could not sign in with Google. Please try again.";

export function GoogleSignIn() {
  const [capability, setCapability] = useState<Capability>({
    status: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [params, setParams] = useSearchParams();
  const feedbackId = useId();
  const oauthRequest = useRef<AbortController | null>(null);
  const callbackError =
    params.get("oauth") === "failed"
      ? params.get("error") === "access_denied"
        ? "Google sign-in was canceled."
        : signInError
      : "";

  useEffect(() => {
    const controller = new AbortController();
    setCapability({ status: "loading" });
    void apiRequest("/api/config", publicAuthConfigSchema, {
      signal: controller.signal,
    })
      .then(({ googleEnabled }) => {
        if (!controller.signal.aborted)
          setCapability({ status: "ready", googleEnabled });
      })
      .catch(() => {
        if (!controller.signal.aborted) setCapability({ status: "error" });
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    function restored(event: PageTransitionEvent) {
      if (!event.persisted) return;
      oauthRequest.current?.abort();
      oauthRequest.current = null;
      setPending(false);
      // Re-read server capability on Back; never persist the configuration.
      setAttempt((value) => value + 1);
    }
    window.addEventListener("pageshow", restored);
    return () => {
      window.removeEventListener("pageshow", restored);
      oauthRequest.current?.abort();
      oauthRequest.current = null;
    };
  }, []);

  async function signIn() {
    if (
      oauthRequest.current ||
      capability.status !== "ready" ||
      !capability.googleEnabled
    )
      return;
    const controller = new AbortController();
    oauthRequest.current = controller; // Synchronous guard, before React rerenders.
    setPending(true);
    setError("");
    if (params.get("oauth") === "failed") setParams({}, { replace: true });
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
        newUserCallbackURL: "/",
        errorCallbackURL: "/login?oauth=failed",
        fetchOptions: { signal: controller.signal },
      });
      if (result.error || !result.data?.url || !result.data.redirect)
        throw new Error(signInError);
      // Better Auth navigates to Google. Keep the button disabled until navigation.
    } catch {
      if (oauthRequest.current !== controller || controller.signal.aborted)
        return;
      oauthRequest.current = null;
      setPending(false);
      setError(signInError);
    }
  }

  return (
    <div className="google-sign-in">
      {capability.status === "loading" ? (
        <p role="status">Loading sign-in options...</p>
      ) : capability.status === "error" ? (
        <>
          <p role="status">Could not load sign-in options.</p>
          <button
            type="button"
            className="secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry sign-in options
          </button>
        </>
      ) : capability.status === "ready" && capability.googleEnabled ? (
        <>
          <div className="auth-divider" role="separator" aria-label="or">
            <span aria-hidden="true">or</span>
          </div>
          <button
            type="button"
            className="google-button"
            disabled={pending}
            aria-busy={pending}
            aria-describedby={feedbackId}
            onClick={() => void signIn()}
          >
            <img src={googleLogo} width="20" height="20" alt="" />
            Continue with Google
          </button>
        </>
      ) : null}
      <p id={feedbackId} role={error || callbackError ? "alert" : "status"}>
        {error || callbackError || (pending ? "Redirecting to Google..." : "")}
      </p>
    </div>
  );
}
