import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";

// O fragmento nunca é enviado ao servidor de assets nem mantido no histórico.
export function takeInvitation() {
  if (window.location.pathname !== "/convite") return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get(
    "convite",
  );
  window.history.replaceState(null, "", "/convite");
  return token && /^[\w-]{43}$/.test(token) ? token : "";
}
export function Invitation({ token: initial }: { token: string }) {
  const [token, setToken] = useState(initial);
  const [identity, setIdentity] =
    useState<Awaited<ReturnType<typeof api.sessionContext>>>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [accepted, setAccepted] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    api
      .sessionContext()
      .then((value) => {
        if (current === generation.current) setIdentity(value);
      })
      .catch(() => {
        if (current === generation.current)
          setMessage(
            "Não foi possível consultar sua sessão. Atualize a página pelo link do convite.",
          );
      })
      .finally(() => {
        if (current === generation.current) setBusy(false);
      });
    return () => {
      generation.current++;
    };
  }, []);
  async function run(operation: () => Promise<void>) {
    const current = generation.current;
    setBusy(true);
    setMessage("");
    try {
      await operation();
    } catch (cause) {
      if (current === generation.current)
        setMessage(
          cause instanceof Error ? cause.message : "Não foi possível concluir.",
        );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <div className="workspace">
      <main className="panel access-panel" aria-busy={busy}>
        <h1>Convite para o Levi</h1>
        <p>
          O convite concede acesso a uma igreja, sem criar um membro da
          congregação.
        </p>
        <p role="status">{message}</p>
        {!token && !accepted ? (
          <p>
            Link indisponível. Abra novamente o convite recebido por e-mail ou
            solicite um novo ao administrador.
          </p>
        ) : accepted ? (
          <a href="/igrejas/selecionar">Selecionar igreja</a>
        ) : identity ? (
          <>
            <p>
              Confirme o convite com sua conta. O e-mail precisa corresponder ao
              destinatário.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const current = generation.current;
                  const session = await api.sessionContext();
                  if (
                    session?.userId !== identity.userId ||
                    session.sessionId !== identity.sessionId
                  )
                    throw new Error(
                      "Sua sessão mudou. Reabra o convite para continuar.",
                    );
                  await api.acceptInvitation(token);
                  if (current === generation.current) {
                    setToken("");
                    setAccepted(true);
                    setMessage(
                      "Convite aceito. Selecione a igreja para continuar.",
                    );
                  }
                })
              }
            >
              Aceitar convite
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.logout();
                  setIdentity(null);
                  setMessage("Entre com o e-mail convidado.");
                })
              }
            >
              Entrar com outra conta
            </button>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api.invitationAuth(email, token);
                setMessage(
                  "Consulte seu e-mail para entrar e confirmar o convite. O link funciona também para uma conta nova.",
                );
              });
            }}
          >
            <label htmlFor="invitation-email">E-mail convidado</label>
            <input
              id="invitation-email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button disabled={busy} type="submit">
              Continuar por e-mail
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
