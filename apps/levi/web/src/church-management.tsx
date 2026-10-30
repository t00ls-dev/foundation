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
  const [invitations, setInvitations] = useState<Awaited<
    ReturnType<typeof api.invitations>
  > | null>(null);
  const [sent, setSent] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ChurchRole>("collaborator");
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
        setInvitations(null);
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
    const invites = await api.invitations(church.id);
    await validate();
    if (current === generation.current) {
      setPage(result);
      setInvitations(invites);
    }
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
        setInvitations(null);
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
  const roleLabel = (value: string) =>
    value === "admin" ? "Administrador" : "Colaborador";
  return (
    <section className="church-admin" aria-label="Administração da igreja">
      <nav className="segmented" aria-label="Seções da administração">
        <NavigationLink
          href="/igrejas/editar"
          navigate={navigate}
          aria-current={path === "/igrejas/editar" ? "page" : undefined}
        >
          Editar igreja
        </NavigationLink>
        <NavigationLink
          href="/igrejas/acessos"
          navigate={navigate}
          aria-current={path === "/igrejas/acessos" ? "page" : undefined}
        >
          Gerenciar acessos
        </NavigationLink>
      </nav>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {path === "/igrejas/editar" && (
        <div className="surface church-admin-section">
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
            className="text-button"
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
        </div>
      )}
      {path === "/igrejas/acessos" && (
        <>
          <div className="surface church-admin-section">
            <h2>Pessoas com acesso ao Levi</h2>
            <h3>Convidar por e-mail</h3>
            <p>
              Convites válidos por 7 dias. O envio não cria conta nem membro da
              congregação.
            </p>
            {sent && (
              <p className="notice success" role="status">
                {sent}
              </p>
            )}
            <form
              className="invite-form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const current = generation.current;
                  setSent("");
                  await api.sendInvitation(church.id, email, role);
                  await validate();
                  if (current !== generation.current) return;
                  setEmail("");
                  setSent("Convite enviado por e-mail.");
                  await load();
                });
              }}
            >
              <div className="field">
                <label htmlFor="invite-email">E-mail do destinatário</label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="send"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="invite-role">Papel concedido</label>
                <select
                  id="invite-role"
                  value={role}
                  onChange={(event) =>
                    setRole(
                      event.target.value === "admin" ? "admin" : "collaborator",
                    )
                  }
                >
                  <option value="collaborator">Colaborador</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              <button className="primary" disabled={busy} type="submit">
                Enviar convite
              </button>
            </form>
          </div>
          <div className="surface church-admin-section">
            <h3>Convites</h3>
            {invitations && (
              <>
                <ul className="item-list access-list">
                  {invitations.invitations.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.email}</strong>
                        <p>
                          {roleLabel(item.role)} ·{" "}
                          {item.acceptedAt
                            ? "Aceito"
                            : item.cancelledAt
                              ? "Cancelado ou substituído"
                              : Date.parse(item.expiresAt) <= Date.now()
                                ? "Expirado"
                                : "Pendente"}
                        </p>
                        <p>
                          Validade:{" "}
                          {new Intl.DateTimeFormat("pt-BR", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(item.expiresAt))}
                        </p>
                      </div>
                      {!item.acceptedAt && !item.cancelledAt && (
                        <div className="row-actions">
                          {["Reenviar", "Cancelar"].map((action) => (
                            <button
                              key={action}
                              className={
                                action === "Cancelar"
                                  ? "destructive"
                                  : "secondary"
                              }
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  const current = generation.current;
                                  await (action === "Reenviar"
                                    ? api.resendInvitation(church.id, item.id)
                                    : api.cancelInvitation(church.id, item.id));
                                  await validate();
                                  if (current !== generation.current) return;
                                  setSent(
                                    action === "Reenviar"
                                      ? "Novo convite enviado. O link anterior foi invalidado."
                                      : "Convite cancelado.",
                                  );
                                  await load();
                                })
                              }
                            >
                              {action}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {invitations.next && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const current = generation.current;
                        const result = await api.invitations(
                          church.id,
                          invitations.next,
                        );
                        await validate();
                        if (current === generation.current)
                          setInvitations(result);
                      })
                    }
                  >
                    Mais convites
                  </button>
                )}
              </>
            )}
          </div>
          <div className="surface church-admin-section">
            <h3>Acessos atuais</h3>
            <p>Gerencie os vínculos existentes desta igreja.</p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run(() => load())}
            >
              Atualizar acessos
            </button>
            {page && (
              <>
                <ul className="item-list access-list">
                  {page.accesses.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>
                          {item.name || item.email}
                          {item.userId === identity?.userId ? " (Você)" : ""}
                        </strong>
                        <p>{item.email}</p>
                        <p>
                          {roleLabel(item.role)} · Desde{" "}
                          {new Intl.DateTimeFormat("pt-BR", {
                            dateStyle: "medium",
                          }).format(new Date(item.createdAt))}
                        </p>
                      </div>
                      <div className="row-actions">
                        <button
                          className="secondary"
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
                          className="destructive"
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
                    className="secondary"
                    disabled={busy}
                    onClick={() => void run(() => load(page.next))}
                  >
                    Próxima página
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
