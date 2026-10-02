import { Link, useNavigate, useSearchParams } from "react-router";
import { useEffect, useRef, useState } from "react";
import { authClient } from "./auth-client.js";
import {
  AsyncForm,
  FormField,
  type Feedback,
  type FormValues,
} from "./auth-form.js";
import { GoogleSignIn } from "./google-sign-in.js";
import { authDestination, authPath } from "./auth-destination.js";
import { checkResetToken, type ResetTokenResult } from "./reset-token.js";

export function AuthPage({
  mode,
  onSignedIn,
}: {
  mode: "login" | "signup" | "magic" | "recover";
  onSignedIn: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const destination = authDestination(params.get("next"));
  const title = {
    login: "Sign in",
    signup: "Create account",
    magic: "Magic link",
    recover: "Reset password",
  }[mode];
  const hasPassword = mode === "login" || mode === "signup";
  async function submit(data: FormValues): Promise<Feedback> {
    const email = field(data, "email");
    if (mode === "signup") {
      const result = await authClient.signUp.email({
        email,
        name: field(data, "name"),
        password: field(data, "password"),
        callbackURL: authPath("/verify-email", destination),
      });
      if (!result.error)
        await navigate(authPath("/verify-email?pending=1", destination));
      return feedback(result.error, "Check your email to verify your account");
    }
    if (mode === "login") {
      const result = await authClient.signIn.email({
        email,
        password: field(data, "password"),
      });
      if (!result.error) {
        await onSignedIn();
        await navigate(destination);
      }
      return feedback(result.error, "Signed in");
    }
    if (mode === "magic") {
      const result = await authClient.signIn.magicLink({
        email,
        callbackURL: destination,
      });
      return feedback(result.error, "Magic link sent");
    }
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    return feedback(
      result.error,
      "If the account exists, a reset link was sent",
    );
  }
  return (
    <section className="auth-page" aria-label="Authentication">
      <h1>{title === "Sign in" ? "Your links, in one place." : title}</h1>
      <p>Save useful bookmarks in your own private library.</p>
      <AsyncForm
        key={mode}
        alternativeAction={hasPassword ? <GoogleSignIn /> : undefined}
        title={title}
        submitLabel={
          hasPassword ? title : mode === "magic" ? "Send link" : "Request reset"
        }
        pendingLabel={
          mode === "signup"
            ? "Creating account..."
            : mode === "login"
              ? "Signing in..."
              : "Sending link..."
        }
        action={submit}
        requiredFields={
          mode === "signup"
            ? ["name", "email", "password", "confirmPassword"]
            : hasPassword
              ? ["email", "password"]
              : ["email"]
        }
      >
        {mode === "signup" ? (
          <FormField label="Name" name="name" autoComplete="name" />
        ) : null}
        <FormField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
        />
        {hasPassword ? (
          <FormField
            label="Password"
            name="password"
            type="password"
            minLength={8}
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
          />
        ) : null}
        {mode === "signup" ? (
          <FormField
            label="Confirm password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
          />
        ) : null}
      </AsyncForm>
      <nav className="auth-links" aria-label="Authentication options">
        <Link to={authPath("/login", destination)}>Sign in</Link>
        <Link to={authPath("/signup", destination)}>Create account</Link>
        <Link to={authPath("/magic-link", destination)}>Use a magic link</Link>
        <Link to={authPath("/forgot-password", destination)}>
          Forgot password?
        </Link>
      </nav>
    </section>
  );
}

export function Verification() {
  const [params] = useSearchParams();
  const pending = params.has("pending");
  const failed = params.has("error");
  return (
    <section className="auth-page">
      <h1>
        {pending
          ? "Check your email"
          : failed
            ? "Unable to verify your email"
            : "Email verified"}
      </h1>
      <p role={failed ? "alert" : "status"}>
        {pending
          ? "Open the verification link in your email, then sign in to Links."
          : failed
            ? "The link may be invalid or expired. Try signing in to request another verification email."
            : "Your account is ready. Sign in to start saving links."}
      </p>
      <Link to={authPath("/login", authDestination(params.get("next")))}>
        Back to sign in
      </Link>
    </section>
  );
}

export function ResetPassword({ authenticated }: { authenticated: boolean }) {
  const [params] = useSearchParams();
  const token = params.get("token");
  const callbackInvalid = params.get("error") === "INVALID_TOKEN";
  const [revision, setRevision] = useState(0);
  const [validation, setValidation] = useState<{
    token: string | null;
    status: ResetTokenResult | "checking";
  }>({ token: null, status: "checking" });
  const mutation = useRef<AbortController | null>(null);
  const status =
    !token || callbackInvalid
      ? "invalid"
      : validation.token !== token
        ? "checking"
        : validation.status;
  useEffect(() => {
    if (!token || callbackInvalid) return;
    const controller = new AbortController();
    setValidation({ token, status: "checking" });
    void checkResetToken(token, controller.signal)
      .then((status) => {
        if (!controller.signal.aborted) setValidation({ token, status });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setValidation({ token, status: "error" });
      });
    return () => controller.abort();
  }, [token, callbackInvalid, revision]);
  useEffect(() => () => mutation.current?.abort(), [token, callbackInvalid]);
  async function reset(data: FormValues): Promise<Feedback> {
    if (!token || status !== "ready")
      return {
        kind: "error",
        message: "The reset link is unavailable.",
        clearFields: true,
      };
    const controller = new AbortController();
    mutation.current = controller;
    try {
      const result = await authClient.resetPassword({
        newPassword: field(data, "password"),
        token,
        fetchOptions: { signal: controller.signal, retry: 0 },
      });
      if (
        result.error?.status === 400 &&
        result.error.code === "INVALID_TOKEN"
      ) {
        if (!controller.signal.aborted)
          setValidation({ token, status: "invalid" });
        return {
          kind: "error",
          message: "The reset link is unavailable.",
          clearFields: true,
        };
      }
      if (result.error) throw new Error("Unconfirmed password reset");
      return {
        kind: "success",
        message: authenticated
          ? "Password updated."
          : "Password updated. You can sign in now.",
        clearFields: true,
      };
    } catch {
      return {
        kind: "error",
        message:
          "We couldn't confirm whether your password was updated. Try signing in. If needed, request a new password link.",
        clearFields: true,
      };
    } finally {
      if (mutation.current === controller) mutation.current = null;
    }
  }
  return (
    <section className="auth-page">
      <h1>Choose a new password.</h1>
      {status === "checking" ? (
        <p role="status">Checking password link...</p>
      ) : status === "invalid" ? (
        <>
          <p role="alert">
            This password link is invalid, expired, or already used.
          </p>
          <Link to="/forgot-password">Request a new password link</Link>
        </>
      ) : status === "error" ? (
        <>
          <p role="alert">
            Could not verify this password link. Please try again.
          </p>
          <button onClick={() => setRevision((value) => value + 1)}>
            Retry password link
          </button>
        </>
      ) : (
        <AsyncForm
          title="Reset password"
          submitLabel="Update password"
          pendingLabel="Updating password..."
          action={reset}
          requiredFields={["password", "confirmPassword"]}
        >
          <FormField
            label="New password"
            name="password"
            type="password"
            minLength={8}
            autoComplete="new-password"
          />
          <FormField
            label="Confirm new password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
          />
        </AsyncForm>
      )}
      <nav className="auth-links" aria-label="Password reset options">
        <Link to={authenticated ? "/account" : "/login"}>
          {authenticated ? "Back to Account" : "Back to sign in"}
        </Link>
      </nav>
    </section>
  );
}

function feedback(
  error: { message?: string | undefined } | null | undefined,
  message: string,
): Feedback {
  return error
    ? { kind: "error", message: error.message ?? "The request failed" }
    : { kind: "success", message };
}
function field(data: FormValues, name: keyof FormValues) {
  const value = data[name];
  if (!value) throw new Error(`Missing form field: ${name}`);
  return value;
}
