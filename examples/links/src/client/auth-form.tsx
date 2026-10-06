import { zodResolver } from "@hookform/resolvers/zod";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { authFormSchema, type FormValues } from "./auth-validation.js";
import { Input } from "@t00ls-dev/ui/components/input";
import { PendingButton } from "@t00ls-dev/ui/patterns/pending-button";
import { InlineFeedback } from "@t00ls-dev/ui/patterns/inline-feedback";
import { cn } from "@t00ls-dev/ui/lib/utils";
export type { FormValues } from "./auth-validation.js";

export type Feedback = {
  kind: "error" | "success";
  message: string;
  clearFields?: boolean;
  field?: keyof FormValues;
};

export function AsyncForm(props: {
  action: (data: FormValues) => Promise<Feedback>;
  alternativeAction?: ReactNode;
  children: ReactNode;
  pendingLabel: string;
  submitLabel: string;
  title: string;
  requiredFields: Array<keyof FormValues>;
  hideTitle?: boolean;
  compact?: boolean;
  className?: string;
  beforeSubmit?: ReactNode;
  submitDisabled?: boolean;
  initialEmail?: string | undefined;
}) {
  const feedbackId = useId();
  const [feedback, setFeedback] = useState<Feedback>();
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const schema = authFormSchema(props.requiredFields);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    ...(props.initialEmail
      ? { defaultValues: { email: props.initialEmail } }
      : {}),
  });
  const pending = form.formState.isSubmitting;

  async function submit(data: FormValues) {
    try {
      const result = await props.action(data);
      if (!mounted.current) return;
      if (result.clearFields) form.reset();
      if (result.field) {
        form.setError(
          result.field,
          { type: "server", message: result.message },
          { shouldFocus: true },
        );
        return;
      }
      setFeedback(result);
    } catch {
      if (mounted.current)
        setFeedback({
          kind: "error",
          message: "Something went wrong. Please try again.",
        });
    }
  }

  function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setFeedback(undefined);
    void form
      .handleSubmit(submit)(event)
      .finally(() => {
        busy.current = false;
      });
  }

  return (
    <FormProvider {...form}>
      <form
        aria-label={props.title}
        noValidate
        aria-busy={pending}
        aria-describedby={feedback ? feedbackId : undefined}
        onSubmit={validate}
        className={cn(
          "grid",
          props.compact ? "auth-form-compact" : "gap-4",
          props.className,
        )}
      >
        {props.hideTitle ? null : (
          <h2 className="m-0 text-lg font-semibold">{props.title}</h2>
        )}
        {props.children}
        {props.beforeSubmit}
        <PendingButton
          disabled={props.submitDisabled}
          type="submit"
          pending={pending}
          pendingLabel={props.pendingLabel}
        >
          {props.submitLabel}
        </PendingButton>
        {feedback ? (
          <div id={feedbackId}>
            <InlineFeedback
              tone={feedback.kind}
              announce={feedback.kind === "error" ? "assertive" : "polite"}
            >
              {feedback.message}
            </InlineFeedback>
          </div>
        ) : null}
        {props.alternativeAction}
      </form>
    </FormProvider>
  );
}

export function FormField(props: {
  autoComplete: string;
  label: string;
  minLength?: number;
  name: keyof FormValues;
  type?: "email" | "password" | "text";
  inputMode?: "numeric";
  maxLength?: number;
  autoFocus?: boolean;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const error = errors[props.name];

  return (
    <div className="cross-page-field">
      <label htmlFor={inputId}>
        {props.label}
        <Input
          {...register(props.name)}
          id={inputId}
          required
          minLength={props.minLength}
          type={props.type}
          autoComplete={props.autoComplete}
          spellCheck={
            props.type === "email" || props.name === "code" ? false : undefined
          }
          inputMode={props.inputMode}
          maxLength={props.maxLength}
          autoFocus={props.autoFocus}
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
  );
}
