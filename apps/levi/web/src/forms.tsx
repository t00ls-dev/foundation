import { formText } from "./form-data.js";
import { useDraftGuard } from "./ui.js";
import {
  useId,
  useRef,
  useLayoutEffect,
  useState,
  type FormEvent,
} from "react";
import type { ProvisionInput } from "./api.js";

type Field = {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
  max?: number;
  value?: string | undefined;
  optional?: boolean;
};
type Values = Record<string, string>;
function Form({
  fields,
  submit,
  busy,
  label,
  onSubmit,
  validate,
}: {
  fields: Field[];
  submit: string;
  busy: boolean;
  label: string;
  onSubmit: (values: Values) => Promise<void>;
  validate: (values: Values) => Values;
}) {
  const id = useId();
  const draft = useDraftGuard();
  const [errors, setErrors] = useState<Values>({});
  const invalidField = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(() => {
    // O grupo opcional já foi expandido pelo render antes de mover o foco.
    const target = invalidField.current;
    // O usuário pode ter recolhido o grupo desde a validação anterior.
    const group = target?.closest("details");
    if (group instanceof HTMLDetailsElement) group.open = true;
    target?.focus();
    invalidField.current = null;
  }, [errors]);
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const values = Object.fromEntries(
      fields.map((field) => [field.name, formText(data, field.name)]),
    );
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const firstInvalid = form.elements.namedItem(Object.keys(nextErrors)[0]!);
      if (firstInvalid instanceof HTMLInputElement)
        invalidField.current = firstInvalid;
      return;
    }
    await onSubmit(values);
    for (const element of Array.from(form.elements)) {
      if (element instanceof HTMLInputElement && element.type === "password")
        element.value = "";
    }
  }
  function renderField(field: Field) {
    return (
      <div className="field" key={field.name}>
        <label htmlFor={`${id}-${field.name}`}>{field.label}</label>
        {field.hint && (
          <p className="hint" id={`${id}-${field.name}-hint`}>
            {field.hint}
          </p>
        )}
        <input
          id={`${id}-${field.name}`}
          name={field.name}
          type={field.type ?? "text"}
          autoComplete={field.autoComplete}
          required={!field.optional}
          maxLength={field.max ?? 160}
          defaultValue={field.value ?? ""}
          aria-invalid={Boolean(errors[field.name])}
          aria-describedby={
            [
              field.hint && `${id}-${field.name}-hint`,
              errors[field.name] && `${id}-${field.name}-error`,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        {errors[field.name] && (
          <p className="field-error" id={`${id}-${field.name}-error`}>
            {errors[field.name]}
          </p>
        )}
      </div>
    );
  }
  return (
    <form
      onSubmit={(event) => void handle(event)}
      noValidate
      data-dirty={draft.dirty}
      onChange={draft.change}
      aria-label={label}
    >
      <fieldset disabled={busy}>
        <legend className="sr-only">{label}</legend>
        {fields.filter((field) => !field.optional).map(renderField)}
        {fields.some((field) => field.optional) && (
          <details
            className="optional-details"
            open={
              Object.keys(errors).some(
                (key) => fields.find((field) => field.name === key)?.optional,
              ) || undefined
            }
          >
            <summary>
              {label === "Editar igreja"
                ? "Contatos da igreja (opcional)"
                : "Adicionar contatos da igreja (opcional)"}
            </summary>
            <p className="hint">
              {label === "Editar igreja"
                ? "Revise os contatos institucionais. Campos em branco removem os dados anteriores."
                : "Você pode começar apenas com o nome da igreja."}
            </p>
            {fields.filter((field) => field.optional).map(renderField)}
          </details>
        )}
        {Object.keys(errors).length > 0 && (
          <p className="sr-only" role="alert">
            Confira os campos indicados antes de continuar.
          </p>
        )}
        <button className="primary" type="submit">
          {busy ? "Aguarde…" : submit}
        </button>
      </fieldset>
    </form>
  );
}

export function AccessForm({
  mode,
  busy,
  onSubmit,
  initial,
  email,
  editing = false,
}: {
  mode: "email" | "login" | "password" | "organization";
  busy: boolean;
  initial?: ProvisionInput | undefined;
  email?: string;
  editing?: boolean;
  onSubmit: (values: Values) => Promise<void>;
}) {
  if (mode === "organization")
    return (
      <Form
        busy={busy}
        label={editing ? "Editar igreja" : "Criar igreja"}
        submit={editing ? "Salvar igreja" : "Criar igreja"}
        fields={[
          {
            name: "churchName",
            label: "Nome da igreja",
            value: initial?.churchName,
            hint: "Só o nome é obrigatório. Deixe os contatos em branco se não souber.",
          },
          {
            name: "churchAddress",
            label: "Endereço da igreja (opcional)",
            optional: true,
            max: 500,
            value: initial?.churchAddress ?? "",
          },
          {
            name: "churchPhone",
            label: "Telefone da igreja (opcional)",
            type: "tel",
            optional: true,
            max: 40,
            value: initial?.churchPhone ?? "",
          },
          {
            name: "churchEmail",
            label: "E-mail da igreja (opcional)",
            type: "email",
            optional: true,
            max: 254,
            value: initial?.churchEmail ?? "",
          },
        ]}
        validate={(values) => ({
          ...Object.fromEntries(
            ["churchName"]
              .filter((key) => !values[key]?.trim())
              .map((key) => [key, "Informe um nome para continuar."]),
          ),
          ...(values.churchEmail?.trim() &&
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.churchEmail.trim())
            ? { churchEmail: "Informe um e-mail válido." }
            : {}),
        })}
        onSubmit={onSubmit}
      />
    );
  if (mode === "password")
    return (
      <Form
        busy={busy}
        label="Definir senha"
        submit="Salvar minha senha"
        fields={[
          {
            name: "newPassword",
            label: "Nova senha",
            type: "password",
            autoComplete: "new-password",
            hint: "Use de 8 a 128 caracteres. Escolha uma senha que você não usa em outros serviços.",
            max: 128,
          },
          {
            name: "confirmation",
            label: "Confirme a nova senha",
            type: "password",
            autoComplete: "new-password",
            max: 128,
          },
        ]}
        validate={(values) => {
          const errors: Values = {};
          if (
            (values.newPassword?.length ?? 0) < 8 ||
            (values.newPassword?.length ?? 0) > 128
          )
            errors.newPassword = "Use de 8 a 128 caracteres.";
          if (
            !values.confirmation ||
            values.confirmation !== values.newPassword
          )
            errors.confirmation = "As senhas precisam ser iguais.";
          return errors;
        }}
        onSubmit={onSubmit}
      />
    );
  const fields: Field[] = [
    {
      name: "email",
      label: "Seu e-mail",
      type: "email",
      autoComplete: "email",
      value: email,
      max: 254,
    },
  ];
  if (mode === "login")
    fields.push({
      name: "password",
      label: "Sua senha",
      type: "password",
      autoComplete: "current-password",
      max: 128,
    });
  return (
    <Form
      busy={busy}
      fields={fields}
      label={mode === "login" ? "Entrar na conta" : "Começar com e-mail"}
      submit={mode === "login" ? "Entrar" : "Receber link de acesso"}
      validate={(values) => {
        const errors: Values = {};
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email?.trim() ?? ""))
          errors.email = "Informe um e-mail válido.";
        if (mode === "login" && !values.password)
          errors.password = "Informe sua senha.";
        return errors;
      }}
      onSubmit={onSubmit}
    />
  );
}
