import { useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  type ChurchItem,
  type SessionContext,
  type ChurchRole,
} from "./api.js";
import { AccessForm } from "./forms.js";
import { NavigationLink } from "./ui.js";

type AccessPage = Awaited<ReturnType<typeof api.accessList>>;
export function ChurchManagement({
  church,
  identity,
  path,
  navigate,
  onAccessChanged,
}: {
  church: ChurchItem;
  identity: SessionContext | null;
  path: string;
  navigate: (path: string, success?: string) => void;
  onAccessChanged: () => void;
}) {
  const [page, setPage] = useState<AccessPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function validate() {
    const currentIdentity = await api.sessionContext();
    if (
      !identity ||
      currentIdentity?.userId !== identity.userId ||
      currentIdentity.sessionId !== identity.sessionId
    )
      throw new ApiError(401, "SESSAO_ALTERADA", "Sua sessão mudou.");
    const context = await api.context();
    if (context.churchId !== church.id || context.role !== "admin")
      throw new ApiError(403, "ACESSO_NEGADO", "Seu acesso foi alterado.");
  }
  async function run(operation: () => Promise<void>) {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      await validate();
      if (current !== generation.current) return;
      await operation();
    } catch (cause) {
      if (current !== generation.current) return;
      if (
        cause instanceof ApiError &&
        ([401, 403].includes(cause.status) ||
          cause.code === "CONTEXTO_ALTERADO")
      ) {
        setPage(null);
        onAccessChanged();
      } else {
        if (!(cause instanceof ApiError) || cause.status !== 409) setPage(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível concluir a operação.",
        );
      }
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  async function load(after: string | null = null) {
    const current = generation.current;
    const result = await api.accessList(church.id, after);
    await validate();
    if (current === generation.current) setPage(result);
  }
  async function change(
    item: AccessPage["accesses"][number],
    role: ChurchRole | null,
  ) {
    if (
      !window.confirm(
        `${role === null ? "Revogar o acesso" : role === "admin" ? "Promover a administrador" : "Rebaixar a colaborador"} de ${item.name || item.email}?`,
      )
    )
      return;
    await run(async () => {
      const current = generation.current;
      try {
        await api.changeAccess(church.id, item.id, item.version, role);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) await load();
        throw cause;
      }
      if (current !== generation.current) return;
      if (identity?.userId === item.userId) {
        setPage(null);
        onAccessChanged();
        return;
      }
      await load();
    });
  }
  useEffect(() => {
    if (path === "/igrejas/acessos") void run(() => load());
    // A instância é recriada pelo shell ao trocar identidade, igreja ou rota.
  }, []);
  return (
    <section aria-label="Administração da igreja">
      <NavigationLink href="/igrejas/editar" navigate={navigate}>
        Editar igreja
      </NavigationLink>{" "}
      <NavigationLink href="/igrejas/acessos" navigate={navigate}>
        Gerenciar acessos
      </NavigationLink>
      {error && <p role="alert">{error}</p>}
      {path === "/igrejas/editar" && (
        <>
          <h2>Editar igreja</h2>
          <AccessForm
            mode="organization"
            editing
            busy={busy}
            initial={{
              churchName: church.nome,
              churchAddress: church.address,
              churchPhone: church.phone,
              churchEmail: church.email,
            }}
            onSubmit={async (values) => {
              await run(async () => {
                const current = generation.current;
                await api.editChurch(church.id, {
                  name: values.churchName ?? "",
                  address: values.churchAddress ?? "",
                  phone: values.churchPhone ?? "",
                  email: values.churchEmail ?? "",
                  version: church.version,
                });
                await validate();
                if (current === generation.current)
                  navigate("/igrejas", "Igreja atualizada.");
              });
            }}
          />
          <button
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Descartar o rascunho e recarregar os dados atuais?",
                )
              )
                onAccessChanged();
            }}
          >
            Recarregar dados atuais
          </button>
        </>
      )}
      {path === "/igrejas/acessos" && (
        <>
          <h2>Pessoas com acesso ao Levi</h2>
          <p>Gerencie os vínculos existentes desta igreja.</p>
          <button disabled={busy} onClick={() => void run(() => load())}>
            Atualizar acessos
          </button>
          {page && (
            <>
              <ul className="item-list">
                {page.accesses.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>
                        {item.name || item.email}
                        {item.userId === identity?.userId ? " (Você)" : ""}
                      </strong>
                      <p>{item.email}</p>
                      <p>
                        {item.role === "admin"
                          ? "Administrador"
                          : "Colaborador"}{" "}
                        · Desde{" "}
                        {new Date(item.createdAt).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <div>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void change(
                            item,
                            item.role === "admin" ? "collaborator" : "admin",
                          )
                        }
                      >
                        {item.role === "admin"
                          ? "Rebaixar a colaborador"
                          : "Promover a administrador"}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void change(item, null)}
                      >
                        Revogar acesso
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {page.next && (
                <button
                  disabled={busy}
                  onClick={() => void run(() => load(page.next))}
                >
                  Próxima página
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
