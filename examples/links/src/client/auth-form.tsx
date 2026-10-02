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
export type { FormValues } from "./auth-validation.js";

export type Feedback = {
  kind: "error" | "success";
  message: string;
  clearFields?: boolean;
};

export function AsyncForm(props: {
  action: (data: FormValues) => Promise<Feedback>;
  alternativeAction?: ReactNode;
  children: ReactNode;
  pendingLabel: string;
  submitLabel: string;
  title: string;
  requiredFields: Array<keyof FormValues>;
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
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });
  const pending = form.formState.isSubmitting;

  async function submit(data: FormValues) {
    try {
      const result = await props.action(data);
      if (!mounted.current) return;
      if (result.clearFields) form.reset();
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
        noValidate
        aria-busy={pending}
        aria-describedby={feedback ? feedbackId : undefined}
        onSubmit={validate}
      >
        <h2>{props.title}</h2>
        {props.children}
        <button type="submit" disabled={pending}>
          {pending ? props.pendingLabel : props.submitLabel}
        </button>
        <p
          className="form-message"
          id={feedbackId}
          role={feedback?.kind === "error" ? "alert" : "status"}
          aria-live={feedback?.kind === "error" ? "assertive" : "polite"}
        >
          {feedback?.message}
        </p>
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
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const error = errors[props.name];

  return (
    <>
      <label htmlFor={inputId}>
        {props.label}
        <input
          {...register(props.name)}
          id={inputId}
          required
          minLength={props.minLength}
          type={props.type}
          autoComplete={props.autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </label>
      {error ? (
        <span className="field-error" id={errorId} role="alert">
          {error.message}
        </span>
      ) : null}
    </>
  );
}
