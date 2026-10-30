export class RequestError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 429,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function readObject(
  request: Request,
  allowed: readonly string[],
): Promise<Record<string, unknown>> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/json"
  ) {
    throw new RequestError(400, "ENTRADA_INVALIDA", "Envie um objeto JSON.");
  }
  const input: unknown = await request.json().catch(() => null);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  ) {
    throw new RequestError(
      400,
      "ENTRADA_INVALIDA",
      "Os campos enviados são inválidos.",
    );
  }
  return input as Record<string, unknown>;
}

export function readString(
  input: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  trim = true,
): string {
  const value = input[key];
  const result = typeof value === "string" ? (trim ? value.trim() : value) : "";
  if (result.length < min || result.length > max || result.includes("\0")) {
    const labels: Record<string, string> = {
      email: "e-mail",
      password: "senha",
      newPassword: "nova senha",
      organizationName: "nome da organização",
      churchName: "nome da igreja",
      organizationId: "organização",
      token: "link",
      name: "nome",
      churchId: "igreja",
      birthDate: "data de nascimento",
      phone: "telefone",
      joinedOn: "data de ingresso conhecida",
      address: "endereço",
      baptismDate: "data de batismo",
      churchRole: "função na igreja",
    };
    throw new RequestError(
      400,
      "ENTRADA_INVALIDA",
      `O campo ${labels[key] ?? key} é inválido.`,
    );
  }
  return result;
}

export function requireUuid(value: string): string {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  ) {
    throw new RequestError(400, "ID_INVALIDO", "O identificador é inválido.");
  }
  return value;
}
