import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "@t00ls-dev/ui/components/button";
import { Skeleton } from "@t00ls-dev/ui/components/skeleton";
import { InlineFeedback } from "@t00ls-dev/ui/patterns/inline-feedback";
import { SettingRow } from "@t00ls-dev/ui/patterns/settings";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@t00ls-dev/ui/components/dialog";
import { X } from "lucide-react";
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
  sessionId,
  onSessionChanged,
  onPasswordConfirmed,
  open,
  onOpenChange,
  disabled,
}: {
  user: { id: string; email: string };
  sessionId: string;
  onSessionChanged: () => Promise<void>;
  onPasswordConfirmed: (identity: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
}) {
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [passwordPresent, setPasswordPresent] = useState(false);
  const [revision, setRevision] = useState(0);
  const authRequest = useRef<AbortController | null>(null);
  const [mutating, setMutating] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
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
    setMutating(true);
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
          return {
            kind: "error",
            message: "Current password is incorrect.",
            field: "currentPassword",
          };
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
        setUncertain(true);
        return { kind: "error", message: unconfirmed, clearFields: true };
      }
      await onSessionChanged();
      const resolved = await authClient.getSession({
        query: { disableCookieCache: true },
      });
      if (resolved.error || resolved.data?.user.id !== user.id) {
        setUncertain(true);
        return { kind: "error", message: unconfirmed, clearFields: true };
      }
      // The shell resets private forms on session rotation. Deliver only this
      // fixed, authoritatively confirmed result to the replacement boundary.
      if (resolved.data.session.id !== sessionId) {
        onPasswordConfirmed(
          `${resolved.data.user.id}:${resolved.data.session.id}`,
        );
      } else {
        onPasswordConfirmed(
          `${resolved.data.user.id}:${resolved.data.session.id}`,
        );
        onOpenChange(false);
      }
      setUncertain(false);
      return {
        kind: "success",
        message: "Password updated. Other sessions have been signed out.",
        clearFields: true,
      };
    } catch {
      setUncertain(true);
      return { kind: "error", message: unconfirmed, clearFields: true };
    } finally {
      setMutating(false);
      releaseSessionRequest(controller);
      if (authRequest.current === controller) authRequest.current = null;
    }
  }

  return (
    <section aria-label="Account security" aria-busy={state === "loading"}>
      <SettingRow
        title="Password"
        description={
          state === "ready" && !passwordPresent ? "Not set" : undefined
        }
        action={
          state === "ready" ? (
            passwordPresent ? (
              <Button
                ref={trigger}
                data-password-trigger
                disabled={disabled || mutating}
                variant="ghost"
                onClick={() => onOpenChange(!open)}
              >
                Change password
              </Button>
            ) : (
              <Button asChild variant="ghost">
                <Link to="/forgot-password">Set password by email</Link>
              </Button>
            )
          ) : undefined
        }
      >
        {state === "loading" ? (
          <Skeleton className="h-11 w-full" />
        ) : state === "error" ? (
          <>
            <InlineFeedback tone="error" announce="assertive">
              Could not load security settings. Please try again.
            </InlineFeedback>
            <Button onClick={() => setRevision((value) => value + 1)}>
              Retry security settings
            </Button>
          </>
        ) : null}
        {uncertain && !open ? (
          <InlineFeedback tone="error" announce="assertive">
            {unconfirmed} <Link to="/forgot-password">Use password reset</Link>
          </InlineFeedback>
        ) : null}
      </SettingRow>
      <Dialog
        open={open && passwordPresent}
        onOpenChange={(value) => {
          if (!mutating) onOpenChange(value);
        }}
      >
        <DialogContent
          aria-busy={mutating}
          onEscapeKeyDown={(event) => {
            if (mutating) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (mutating) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Change password</DialogTitle>
            <Button
              variant="ghost"
              className="px-2"
              disabled={mutating}
              aria-label="Close"
              onClick={() => onOpenChange(false)}
            >
              <X size={20} aria-hidden="true" />
            </Button>
          </div>
          <DialogDescription>
            Changing your password signs out your other sessions.
          </DialogDescription>
          <AsyncForm
            hideTitle
            hideSuccess
            initialFeedback={
              uncertain ? { kind: "error", message: unconfirmed } : undefined
            }
            className="border-0 bg-transparent p-0"
            title="Change password"
            action={change}
            submitLabel="Change password"
            pendingLabel="Changing password..."
            requiredFields={["currentPassword", "password", "confirmPassword"]}
            alternativeAction={
              <Button
                type="button"
                variant="ghost"
                disabled={mutating}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
            }
          >
            <FormField
              autoFocus
              label="Current password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
            />
            {mutating ? (
              <span className="auth-recovery-link" aria-disabled="true">
                Forgot password?
              </span>
            ) : (
              <Link className="auth-recovery-link" to="/forgot-password">
                Forgot password?
              </Link>
            )}
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
        </DialogContent>
      </Dialog>
    </section>
  );
}
