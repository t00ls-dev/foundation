import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.js";
import {
  adminApi,
  type AdministrativeSession,
  type Feature,
  type Church,
} from "./admin-api.js";
import { useFormFocusVisibility } from "./ui.js";

type Snapshot = {
  session: AdministrativeSession;
  churches: Church[];
  organizationNext: string | null;
  features: Feature[];
};
type Screen =
  | { kind: "loading" | "denied" | "failure" }
  | { kind: "ready"; data: Snapshot };
type Notice = { text: string; error: boolean; reauthenticate?: boolean } | null;

export function Admin() {
  useFormFocusVisibility();
  useEffect(() => {
    document.title = "Administração global · Levi";
  }, []);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const controller = useRef(new AbortController());
  function clear() {
    generation.current++;
    controller.current.abort();
    controller.current = new AbortController();
    setScreen({ kind: "loading" });
    setNotice(null);
    setBusy(false);
  }
  async function refresh(message: Notice = null) {
    clear();
    const sequence = generation.current;
    const signal = controller.current.signal;
    try {
      const session = await adminApi.session(signal);
      const [churches, features] = await Promise.all([
        adminApi.churches(signal),
        adminApi.features(signal),
      ]);
      const current = await adminApi.session(signal);
      if (sequence !== generation.current) return;
      if (
        current.userId !== session.userId ||
        current.sessionId !== session.sessionId
      ) {
        void refresh();
        return;
      }
      setScreen({
        kind: "ready",
        data: {
          session,
          churches: churches.items,
          organizationNext: churches.next,
          features,
        },
      });
      setNotice(message);
    } catch (error) {
      if (sequence !== generation.current) return;
      setScreen({
        kind:
          error instanceof ApiError && error.status === 404
            ? "denied"
            : "failure",
      });
    }
  }
  useEffect(() => {
    void refresh();
    const focus = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") clear();
      else focus();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("blur", clear);
    window.addEventListener("pageshow", focus);
    window.addEventListener("pagehide", clear);
    window.addEventListener("popstate", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      generation.current++;
      controller.current.abort();
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", clear);
      window.removeEventListener("pageshow", focus);
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("popstate", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
    // Apenas o ciclo da página registra listeners; refs invalidam trabalhos anteriores.
  }, []);
  async function run(
    operation: (signal: AbortSignal) => Promise<void | (() => void)>,
    success: string,
    refreshAfter = true,
  ) {
    if (screen.kind !== "ready" || busy) return;
    const sequence = generation.current;
    const expected = screen.data.session;
    const signal = controller.current.signal;
    setBusy(true);
    setNotice(null);
    try {
      const current = await adminApi.session(signal);
      if (sequence !== generation.current) return;
      if (
        current.userId !== expected.userId ||
        current.sessionId !== expected.sessionId
      ) {
        await refresh();
        return;
      }
      const commit = await operation(signal);
      const confirmed = await adminApi.session(signal);
      if (sequence !== generation.current) return;
      if (
        confirmed.userId !== expected.userId ||
        confirmed.sessionId !== expected.sessionId
      ) {
        await refresh();
        return;
      }
      commit?.();
      if (sequence === generation.current) {
        if (refreshAfter) await refresh({ text: success, error: false });
        else setNotice({ text: success, error: false });
      }
    } catch (error) {
      if (sequence !== generation.current) return;
      if (error instanceof ApiError && error.status === 404) {
        clear();
        setScreen({ kind: "denied" });
      } else if (error instanceof ApiError && error.status === 409) {
        await refresh({
          text:
            error.message +
            " Confira os dados atualizados antes de tentar novamente.",
          error: true,
        });
      } else {
        setNotice({
          text:
            error instanceof ApiError
              ? error.message
              : "Não foi possível confirmar a operação. Atualize antes de tentar novamente.",
          error: true,
          reauthenticate:
            error instanceof ApiError &&
            error.code === "REAUTENTICACAO_NECESSARIA",
        });
      }
    } finally {
      if (sequence === generation.current) setBusy(false);
    }
  }
  async function logout() {
    clear();
    setBusy(true);
    try {
      await api.logout();
      window.location.assign("/entrar");
    } catch {
      setScreen({ kind: "failure" });
      setBusy(false);
    }
  }
  return (
    <div className="global-admin">
      <a className="skip-link" href="#conteudo-admin">
        Pular para o conteúdo
      </a>
      <header className="topbar">
        <a className="brand" href="/">
          Levi
        </a>
        <span>Administração global</span>
        <a href="/">Voltar ao Levi</a>
        <button className="quiet" disabled={busy} onClick={() => void logout()}>
          Sair
        </button>
      </header>
      <main id="conteudo-admin" className="global-admin-main" tabIndex={-1}>
        <h1>Painel administrativo</h1>
        {notice && (
          <div
            role={notice.error ? "alert" : "status"}
            className={`notice ${notice.error ? "error" : "success"}`}
          >
            <p>{notice.text}</p>
            {notice.reauthenticate && (
              <button onClick={() => void logout()}>Entrar novamente</button>
            )}
          </div>
        )}
        {screen.kind === "loading" && (
          <p role="status">Confirmando acesso administrativo…</p>
        )}
        {screen.kind === "denied" && (
          <p role="alert">Recurso não encontrado.</p>
        )}
        {screen.kind === "failure" && (
          <p role="alert">
            Não foi possível confirmar o acesso. Tente atualizar novamente.
          </p>
        )}
        <button
          className="quiet"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Atualizar acesso e dados
        </button>
        {screen.kind === "ready" && (
          <AdminContent
            key={`${screen.data.session.userId}:${screen.data.session.sessionId}:${generation.current}`}
            data={screen.data}
            busy={busy}
            run={run}
          />
        )}
      </main>
    </div>
  );
}

function AdminContent({
  data,
  busy,
  run,
}: {
  data: Snapshot;
  busy: boolean;
  run: (
    operation: (signal: AbortSignal) => Promise<void | (() => void)>,
    success: string,
    refreshAfter?: boolean,
  ) => Promise<void>;
}) {
  const [churches, setChurches] = useState(data.churches);
  const [organizationNext, setChurchNext] = useState(data.organizationNext);
  // Resultados locais só são publicados se o componente ainda pertence ao ciclo atual.
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  return (
    <>
      <section
        className="global-admin-section"
        aria-labelledby="features-title"
      >
        <h2 id="features-title">Funcionalidades</h2>
        <p>
          As políticas são preparadas para uso futuro. A disponibilidade atual
          da gestão de membros permanece sob o controle vigente.
        </p>
        {data.features.map((feature) => (
          <FeatureForm
            key={feature.key}
            feature={feature}
            churches={churches}
            busy={busy}
            run={run}
          />
        ))}
        {organizationNext && (
          <button
            disabled={busy}
            onClick={() =>
              void run(
                async (signal) => {
                  const page = await adminApi.churches(
                    signal,
                    organizationNext,
                  );
                  return () => {
                    if (alive.current && !signal.aborted) {
                      setChurches((items) => [...items, ...page.items]);
                      setChurchNext(page.next);
                    }
                  };
                },
                "Igrejas consultadas.",
                false,
              )
            }
          >
            Mais igrejas
          </button>
        )}
      </section>
    </>
  );
}
function FeatureForm({
  feature,
  churches,
  busy,
  run,
}: {
  feature: Feature;
  churches: Church[];
  busy: boolean;
  run: (
    operation: (signal: AbortSignal) => Promise<void | (() => void)>,
    success: string,
    refreshAfter?: boolean,
  ) => Promise<void>;
}) {
  const [policy, setPolicy] = useState(feature.policy);
  const [selected, setSelected] = useState(feature.churchIds);
  const [confirmAll, setConfirmAll] = useState(false);
  const knownIds = new Set(churches.map((org) => org.id));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (policy === "all" && !confirmAll) return;
        if (!window.confirm(`Salvar a política ${policy} para Membros?`))
          return;
        void run(
          (signal) =>
            adminApi.update(
              {
                ...feature,
                policy,
                churchIds: policy === "selected" ? selected : [],
              },
              signal,
            ),
          "Política de Membros atualizada.",
        );
      }}
    >
      <h3>Membros</h3>
      <p>Chave: members · versão {feature.version}</p>
      <div className="field">
        <label htmlFor={`policy-${feature.key}`}>Política de Membros</label>
        <select
          id={`policy-${feature.key}`}
          value={policy}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "all" || value === "selected" || value === "disabled")
              setPolicy(value);
            setConfirmAll(false);
          }}
        >
          <option value="disabled">Desabilitada</option>
          <option value="selected">Igrejas selecionadas</option>
          <option value="all">Todas as igrejas</option>
        </select>
      </div>
      {policy === "selected" && (
        <fieldset>
          <legend>Igrejas selecionadas</legend>
          <div className="organization-options">
            {churches.map((org) => (
              <label key={org.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(org.id)}
                  onChange={(event) =>
                    setSelected((ids) =>
                      event.target.checked
                        ? [...ids, org.id]
                        : ids.filter((id) => id !== org.id),
                    )
                  }
                />
                {org.name}
                <small>{org.id}</small>
              </label>
            ))}
            {selected
              .filter((id) => !knownIds.has(id))
              .map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked
                    onChange={() =>
                      setSelected((ids) => ids.filter((value) => value !== id))
                    }
                  />
                  {id} (ainda não carregada)
                </label>
              ))}
          </div>
        </fieldset>
      )}
      {policy === "all" && (
        <label className="global-confirm">
          <input
            type="checkbox"
            required
            checked={confirmAll}
            onChange={(event) => setConfirmAll(event.target.checked)}
          />
          Confirmo habilitar esta funcionalidade para todas as igrejas.
        </label>
      )}
      <button
        disabled={
          busy ||
          (policy === "selected" && !selected.length) ||
          (policy === "all" && !confirmAll)
        }
      >
        Salvar política de Membros
      </button>
    </form>
  );
}
