import { Link, useNavigate, useSearchParams } from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "./auth-client.js";
import {
  AsyncForm,
  FormField,
  type Feedback,
  type FormValues,
} from "./auth-form.js";
import { GoogleSignIn, type GoogleCapability } from "./google-sign-in.js";
import { authDestination, authPath } from "./auth-destination.js";
import { checkResetToken, type ResetTokenResult } from "./reset-token.js";
import {
  currentSessionGeneration,
  registerSessionRequest,
  releaseSessionRequest,
} from "./session-generation.js";
import {
  passwordChallenge,
  totpUnconfirmed,
  type PasswordChallenge,
} from "./totp.js";
import { readTotpSession } from "./totp-session.js";
import { Button } from "@t00ls-dev/ui/components/button";
import { Skeleton } from "@t00ls-dev/ui/components/skeleton";
import { InlineFeedback } from "@t00ls-dev/ui/patterns/inline-feedback";
import { useProgressOperation } from "@t00ls-dev/ui/patterns/page-progress";
import { apiRequest } from "./api.js";
import {
  publicAuthConfigSchema,
  linksTurnstileActions,
  type TurnstileCapability,
} from "../shared/auth-config.js";
import { TurnstileWidget } from "./turnstile-widget.js";
import { AuthLayout, AuthResult } from "./auth-layout.js";

const authPresentation = {
  login: {
    title: "Sign in",
    submitLabel: "Sign in",
    pendingLabel: "Signing in…",
    links: [
      { path: "/signup", label: "Create account" },
      { path: "/magic-link", label: "Use a magic link" },
    ],
  },
  signup: {
    title: "Create account",
    submitLabel: "Create account",
    pendingLabel: "Creating account…",
    links: [{ path: "/login", label: "Sign in" }],
  },
  magic: {
    title: "Magic link",
    submitLabel: "Send sign-in link",
    pendingLabel: "Sending link…",
    links: [{ path: "/login", label: "Sign in" }],
  },
  recover: {
    title: "Forgot password?",
    submitLabel: "Send reset link",
    pendingLabel: "Sending link…",
    links: [{ path: "/login", label: "Sign in" }],
  },
};

export function AuthPage({
  mode,
  onSignedIn,
  onChallenge,
  initialEmail,
}: {
  mode: "login" | "signup" | "magic" | "recover";
  onSignedIn: () => Promise<void>;
  onChallenge?: (challenge: PasswordChallenge) => void;
  initialEmail?: string | undefined;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const destination = authDestination(params.get("next"));
  const presentation = authPresentation[mode];
  const { title } = presentation;
  const hasPassword = mode === "login" || mode === "signup";
  const loginRequest = useRef<AbortController | null>(null);
  const publicRequest = useRef<AbortController | null>(null);
  const [capability, setCapability] = useState<TurnstileCapability | null>(
    null,
  );
  const [googleCapability, setGoogleCapability] = useState<GoogleCapability>({
    status: "loading",
  });
  const [configAttempt, setConfigAttempt] = useState(0);
  const [widgetRevision, setWidgetRevision] = useState(0);
  const [tokenReady, setTokenReady] = useState(false);
  const token = useRef("");
  const onToken = useCallback((value: string) => {
    token.current = value;
    setTokenReady(Boolean(value));
  }, []);
  const operation = {
    login: "signIn",
    signup: "signUp",
    magic: "magicLink",
    recover: "passwordReset",
  }[mode] as keyof typeof linksTurnstileActions;
  useEffect(() => {
    const controller = new AbortController();
    setCapability(null);
    setGoogleCapability({ status: "loading" });
    void apiRequest("/api/config", publicAuthConfigSchema, {
      signal: controller.signal,
    })
      .then((config) => {
        if (!controller.signal.aborted) {
          setCapability(config.turnstile);
          setGoogleCapability({
            status: "ready",
            googleEnabled: config.googleEnabled,
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCapability({ status: "unavailable" });
          setGoogleCapability({ status: "error" });
        }
      });
    return () => controller.abort();
  }, [configAttempt]);
  useEffect(() => {
    onToken("");
    return () => {
      token.current = "";
      publicRequest.current?.abort();
    };
  }, [mode, onToken]);
  useEffect(() => () => loginRequest.current?.abort(), [mode]);
  async function submit(data: FormValues): Promise<Feedback> {
    if (!capability || capability.status === "unavailable")
      return {
        kind: "error",
        message: "Verification is temporarily unavailable. Please try again.",
      };
    const captchaToken = token.current;
    if (capability.status === "enabled" && !captchaToken)
      return {
        kind: "error",
        message: "Complete verification before trying again.",
      };
    const headers =
      capability.status === "enabled"
        ? { "x-captcha-response": captchaToken }
        : {};
    if (capability.status === "enabled") {
      onToken("");
      setWidgetRevision((value) => value + 1);
    }
    const email = field(data, "email");
    if (mode === "signup") {
      const controller = registerSessionRequest();
      publicRequest.current = controller;
      const generation = currentSessionGeneration();
      try {
        const result = await authClient.signUp.email({
          email,
          name: field(data, "name"),
          password: field(data, "password"),
          callbackURL: authPath("/verify-email", destination),
          fetchOptions: { headers, signal: controller.signal, retry: 0 },
        });
        if (
          controller.signal.aborted ||
          generation !== currentSessionGeneration()
        )
          return {
            kind: "error",
            message: "Request could not be confirmed.",
            clearFields: true,
          };
        releaseSessionRequest(controller);
        if (!result.error)
          await navigate(authPath("/verify-email?pending=1", destination));
        return feedback(
          result.error,
          "Check your email to verify your account",
        );
      } finally {
        releaseSessionRequest(controller);
        if (publicRequest.current === controller) publicRequest.current = null;
      }
    }
    if (mode === "login") {
      const controller = registerSessionRequest();
      loginRequest.current = controller;
      const generation = currentSessionGeneration();
      const active = () =>
        !controller.signal.aborted &&
        window.location.pathname === "/login" &&
        generation === currentSessionGeneration();
      async function challengePage(available: boolean, uncertain: boolean) {
        onChallenge?.({
          email: email.toLowerCase(),
          destination,
          available,
          uncertain,
        });
        await navigate(authPath("/two-factor", destination));
      }
      try {
        const result = await authClient.signIn.email({
          email,
          password: field(data, "password"),
          fetchOptions: {
            headers,
            signal: controller.signal,
            retry: 0,
            disableSignal: true,
          },
        });
        if (!active())
          return { kind: "error", message: totpUnconfirmed, clearFields: true };
        if (result.error) {
          if (isTurnstileError(result.error))
            return feedback(result.error, "Signed in");
          if (
            result.error.status >= 500 ||
            result.error.code === "AUTH_STATE_INDETERMINATE"
          ) {
            await challengePage(false, true);
            return {
              kind: "error",
              message: totpUnconfirmed,
              clearFields: true,
            };
          }
          return feedback(result.error, "Signed in");
        }
        const challenge = passwordChallenge(result.data);
        if (challenge) {
          await challengePage(challenge.available, false);
          return {
            kind: "success",
            message: "Authenticator code required.",
            clearFields: true,
          };
        }
        const resolved = await readTotpSession(controller.signal);
        if (!active())
          return { kind: "error", message: totpUnconfirmed, clearFields: true };
        if (
          !resolved ||
          resolved.user.email.toLowerCase() !== email.toLowerCase()
        )
          throw new Error("Identity not confirmed");
        releaseSessionRequest(controller);
        await onSignedIn();
        if (!controller.signal.aborted) await navigate(destination);
        return { kind: "success", message: "Signed in", clearFields: true };
      } catch {
        if (active()) await challengePage(false, true);
        return { kind: "error", message: totpUnconfirmed, clearFields: true };
      } finally {
        releaseSessionRequest(controller);
        if (loginRequest.current === controller) loginRequest.current = null;
      }
    }
    const controller = registerSessionRequest();
    publicRequest.current = controller;
    try {
      if (mode === "magic") {
        const result = await authClient.signIn.magicLink({
          email,
          callbackURL: destination,
          fetchOptions: { headers, signal: controller.signal, retry: 0 },
        });
        return feedback(result.error, "Check your email for a sign-in link.");
      }
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
        fetchOptions: { headers, signal: controller.signal, retry: 0 },
      });
      return feedback(
        result.error,
        "If an account exists for this email, check your inbox for a reset link.",
      );
    } finally {
      releaseSessionRequest(controller);
      if (publicRequest.current === controller) publicRequest.current = null;
    }
  }
  return (
    <AuthLayout
      title={title}
      footer={
        <nav className="auth-links" aria-label="Authentication options">
          {presentation.links.map(({ path, label }) => (
            <Link key={path} to={authPath(path, destination)}>
              {label}
            </Link>
          ))}
          {mode === "recover" && initialEmail ? (
            <Link to="/account">Back to Account</Link>
          ) : null}
        </nav>
      }
    >
      <AsyncForm
        hideTitle
        compact
        initialEmail={mode === "recover" ? initialEmail : undefined}
        submitDisabled={
          !capability ||
          capability.status === "unavailable" ||
          (capability.status === "enabled" && !tokenReady)
        }
        beforeSubmit={
          capability?.status === "enabled" ? (
            <TurnstileWidget
              key={mode}
              siteKey={capability.siteKey}
              action={linksTurnstileActions[operation]}
              revision={widgetRevision}
              onToken={onToken}
            />
          ) : !capability ? (
            <Skeleton className="mx-auto h-16 w-40 max-w-full" />
          ) : capability.status === "unavailable" ? (
            <>
              <InlineFeedback tone="error" announce="assertive">
                {googleCapability.status === "error"
                  ? "Could not load authentication settings. Please try again."
                  : "Verification is temporarily unavailable. Please try again."}
              </InlineFeedback>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfigAttempt((value) => value + 1)}
              >
                Retry authentication settings
              </Button>
            </>
          ) : null
        }
        key={mode}
        alternativeAction={
          hasPassword ? (
            <GoogleSignIn
              externalCapability={googleCapability}
              onRetryCapability={() => setConfigAttempt((value) => value + 1)}
            />
          ) : undefined
        }
        title={title}
        submitLabel={presentation.submitLabel}
        pendingLabel={presentation.pendingLabel}
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
        {mode === "login" ? (
          <Link
            className="auth-recovery-link"
            to={authPath("/forgot-password", destination)}
          >
            Forgot password?
          </Link>
        ) : null}
      </AsyncForm>
    </AuthLayout>
  );
}

export function Verification() {
  const [params] = useSearchParams();
  const pending = params.has("pending");
  const failed = params.has("error");
  return (
    <AuthResult
      title={
        pending
          ? "Check your email"
          : failed
            ? "Unable to verify your email"
            : "Email verified"
      }
      success={!pending && !failed}
      action={
        <nav aria-label="Verification options">
          <Button
            asChild
            variant={pending || failed ? "outline" : "default"}
            className="w-full"
          >
            <Link to={authPath("/login", authDestination(params.get("next")))}>
              {failed ? "Back to sign in" : "Sign in"}
            </Link>
          </Button>
        </nav>
      }
    >
      {pending ? (
        <p role={failed ? "alert" : "status"}>
          Open the verification link in your email.
        </p>
      ) : failed ? (
        <InlineFeedback tone="error" announce="assertive">
          The link may be invalid or expired. Try signing in to request another
          verification email.
        </InlineFeedback>
      ) : null}
    </AuthResult>
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
  useProgressOperation(status === "checking");
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
    <AuthLayout
      title="New password"
      footer={
        <nav className="auth-links" aria-label="Password reset options">
          <Link to={authenticated ? "/account" : "/login"}>
            {authenticated ? "Back to Account" : "Back to sign in"}
          </Link>
        </nav>
      }
    >
      {status === "checking" ? (
        <div
          aria-label="Checking password link"
          aria-busy="true"
          className="grid gap-4"
        >
          <p role="status">Checking password link…</p>
          <Skeleton className="h-40 w-full" />
        </div>
      ) : status === "invalid" ? (
        <>
          <InlineFeedback tone="error" announce="assertive">
            This password link is invalid, expired, or already used.
          </InlineFeedback>
          <div className="actions">
            <Link to="/forgot-password">Request a new password link</Link>
          </div>
        </>
      ) : status === "error" ? (
        <>
          <InlineFeedback tone="error" announce="assertive">
            Could not verify this password link. Please try again.
          </InlineFeedback>
          <div className="actions">
            <Button onClick={() => setRevision((value) => value + 1)}>
              Retry password link
            </Button>
          </div>
        </>
      ) : (
        <AsyncForm
          hideTitle
          compact
          title="Reset password"
          submitLabel="Update password"
          pendingLabel="Updating password…"
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
    </AuthLayout>
  );
}

function feedback(
  error:
    | { message?: string | undefined; code?: string | undefined }
    | null
    | undefined,
  message: string,
): Feedback {
  if (error && isTurnstileError(error))
    return {
      kind: "error",
      message:
        error.code === "TURNSTILE_UNAVAILABLE"
          ? "Verification is temporarily unavailable. Please try again."
          : "Verification failed or expired. Please try again.",
    };
  return error
    ? { kind: "error", message: error.message ?? "The request failed" }
    : { kind: "success", message };
}
function isTurnstileError(error: { code?: string | undefined }) {
  return [
    "TURNSTILE_UNAVAILABLE",
    "MISSING_RESPONSE",
    "VERIFICATION_FAILED",
  ].includes(error.code ?? "");
}
function field(data: FormValues, name: keyof FormValues) {
  const value = data[name];
  if (!value) throw new Error(`Missing form field: ${name}`);
  return value;
}
