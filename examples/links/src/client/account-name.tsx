import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import { accountUpdateSchema } from "../shared/account.js";
import { authClient } from "./auth-client.js";
import type { Feedback } from "./auth-form.js";
import { Input } from "@t00ls-dev/ui/components/input";
import { Button } from "@t00ls-dev/ui/components/button";
import { PendingButton } from "@t00ls-dev/ui/patterns/pending-button";
import { InlineFeedback } from "@t00ls-dev/ui/patterns/inline-feedback";
import { useConfirmedFeedback } from "@t00ls-dev/ui/patterns/feedback";
import {
  currentSessionGeneration,
  registerSessionRequest,
  releaseSessionRequest,
} from "./session-generation.js";

const unconfirmed =
  "We couldn't confirm whether your name was saved. Reload Account to check before trying again.";

export function AccountName({
  user,
  onNameChanged,
}: {
  user: { id: string; name: string; email: string };
  onNameChanged: () => Promise<void>;
}) {
  const inputId = useId();
  const confirmed = useConfirmedFeedback();
  const errorId = `${inputId}-error`;
  const feedbackId = `${inputId}-feedback`;
  const [feedback, setFeedback] = useState<Feedback>();
  const busy = useRef(false);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const form = useForm<{ name: string }>({
    resolver: zodResolver(accountUpdateSchema),
    defaultValues: { name: user.name },
  });
  const { reset, formState } = form;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!formState.isDirty && !busy.current) reset({ name: user.name });
  }, [user.name, formState.isDirty, reset]);

  async function save({ name }: { name: string }) {
    const generation = currentSessionGeneration();
    const controller = registerSessionRequest();
    request.current = controller;
    const active = () =>
      mounted.current &&
      !controller.signal.aborted &&
      generation === currentSessionGeneration();
    try {
      const result = await authClient.updateUser({
        name,
        fetchOptions: { signal: controller.signal, retry: 0 },
      });
      if (!active()) return;
      if (result.error) {
        if (result.error.status === 401) {
          window.dispatchEvent(new Event("links:unauthorized"));
          return;
        }
        if (
          result.error.status === 400 &&
          result.error.code === "INVALID_NAME"
        ) {
          form.setError(
            "name",
            {
              type: "server",
              message:
                "Enter a name of 1–200 characters without control characters.",
            },
            { shouldFocus: true },
          );
          return;
        }
        setFeedback({ kind: "error", message: unconfirmed });
        return;
      }
      const resolved = await authClient.getSession({
        query: { disableCookieCache: true },
        fetchOptions: { signal: controller.signal, retry: 0 },
      });
      if (!active()) return;
      if (
        resolved.error ||
        resolved.data?.user.id !== user.id ||
        resolved.data.user.name !== name ||
        resolved.data.user.email !== user.email
      ) {
        setFeedback({ kind: "error", message: unconfirmed });
        return;
      }
      releaseSessionRequest(controller);
      await onNameChanged();
      if (!active()) return;
      reset({ name });
      confirmed(crypto.randomUUID(), "Name saved.");
    } catch {
      if (active()) setFeedback({ kind: "error", message: unconfirmed });
    } finally {
      releaseSessionRequest(controller);
      if (request.current === controller) request.current = null;
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setFeedback(undefined);
    void form
      .handleSubmit(save)(event)
      .finally(() => {
        busy.current = false;
      });
  }

  const error = formState.errors.name;
  return (
    <form
      aria-label="Account name"
      noValidate
      aria-busy={formState.isSubmitting}
      aria-describedby={feedback ? feedbackId : undefined}
      onSubmit={submit}
    >
      <div className="cross-page-field">
        <label htmlFor={inputId}>
          Name
          <Input
            {...form.register("name")}
            id={inputId}
            autoComplete="name"
            required
            maxLength={200}
            readOnly={formState.isSubmitting}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </label>
        {error ? (
          <span className="field-error" id={errorId} role="alert">
            {error.message}
          </span>
        ) : null}
      </div>
      <div className="cross-page-field">
        <label htmlFor={`${inputId}-email`}>Email</label>
        <Input
          className="bg-accent"
          id={`${inputId}-email`}
          type="email"
          readOnly
          value={user.email}
          autoComplete="email"
        />
      </div>
      <PendingButton
        className="justify-self-start"
        disabled={form.watch("name").trim() === user.name}
        type="submit"
        pending={formState.isSubmitting}
        pendingLabel="Saving name..."
      >
        Save changes
      </PendingButton>
      <div id={feedbackId}>
        {feedback ? (
          <>
            <InlineFeedback tone={feedback.kind} announce="assertive">
              {feedback.message}
            </InlineFeedback>
            <Button
              type="button"
              variant="ghost"
              disabled={formState.isSubmitting}
              onClick={() => void onNameChanged()}
            >
              Reload Account
            </Button>
          </>
        ) : null}
      </div>
    </form>
  );
}
