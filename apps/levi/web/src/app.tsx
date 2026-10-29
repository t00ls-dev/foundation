import { Skeleton } from "@t00ls-dev/ui/components/skeleton";
import {
  EmptyState,
  Icon,
  NavigationLink,
  useFormFocusVisibility,
} from "./ui.js";
import { Members } from "./members.js";
import { useEffect, useRef, useState } from "react";
import {
  api,
  resetClientIdentity,
  ApiError,
  type NamedItem,
  type ChurchItem,
  type ProvisionInput,
  type SessionContext,
} from "./api.js";
import { AccessForm } from "./forms.js";
import {
  clearProvisionKey,
  provisionKey,
  requestStorage,
  sameSession,
  clearSessionRequests,
} from "./session.js";

import type { MemberFilters } from "../../src/member-types.js";

type Screen =
  | { kind: "loading"; layout: "access" | "management" }
  | {
      kind:
        | "failure"
        | "no-access"
        | "email"
        | "login"
        | "password"
        | "organization";
    }
  | { kind: "organizations"; items: NamedItem[] }
  | {
      kind: "churches" | "dashboard";
      organization: NamedItem;
      items: ChurchItem[];
      membersEnabled: boolean;
    }
  | {
      kind: "members";
      organization: NamedItem;
      churches: NamedItem[];
      path: string;
      churchFilter: string;
      identity: SessionContext;
      filters: MemberFilters;
    };
type Notice = {
  kind: "error" | "success" | "info";
  text: string;
  rateLimited?: boolean;
} | null;

export function App({
  link,
}: {
  link: { token: string | null; invalid: boolean };
}) {
  useFormFocusVisibility();
  const [screen, setScreen] = useState<Screen>({
    kind: "loading",
    layout: "access",
  });
  const [notice, setNotice] = useState<Notice>(
    link.invalid
      ? {
          kind: "error",
          text: "Este link não é válido, expirou ou já foi utilizado. Solicite uma nova mensagem para continuar.",
        }
      : null,
  );
  const [token, setToken] = useState(link.token);
  const [busy, setBusy] = useState(false);
  const [emailJourney, setEmailJourney] = useState<{
    kind: "entry" | "waiting";
    email: string;
  }>({ kind: "entry", email: "" });
  const emailSent = emailJourney.kind === "waiting";
  const [emailRetryAt, setEmailRetryAt] = useState(0);
  const [clock, setClock] = useState(Date.now);
  const emailWait = Math.max(0, Math.ceil((emailRetryAt - clock) / 1000));
  useEffect(() => {
    if (!emailWait) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [emailRetryAt, emailWait]);
  const [uncertain, setUncertain] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const denied = useRef(false);
  const attempt = useRef<
    | ({ key: string; input: ProvisionInput } & (
        { kind: "pending" } | { kind: "confirmed"; organizationId: string }
      ))
    | null
  >(null);
  const identity = useRef<SessionContext | null | undefined>(undefined);
  const memberList = useRef<{
    identity: SessionContext;
    organizationId: string;
    filters: MemberFilters;
  } | null>(null);
  function rememberIdentity(current: SessionContext | null): boolean {
    const changed =
      identity.current !== undefined && !sameSession(identity.current, current);
    if (changed) {
      resetClientIdentity();
      memberList.current = null;
      attempt.current = null;
      clearSessionRequests(requestStorage());
      setEmailJourney({ kind: "entry", email: "" });
      setEmailRetryAt(0);
      setUncertain(false);
      setToken(null);
      tokenRef.current = null;
      denied.current = false;
      setNotice(null);
    }
    identity.current = current;
    return changed;
  }
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const screenRef = useRef(screen);
  screenRef.current = screen;
  const currentPath = useRef(window.location.pathname);
  function navigate(path: string) {
    currentPath.current = path;
    window.history.pushState(null, "", path);
  }
  async function confirmSession(
    expected: SessionContext | null,
    sequence: number,
  ): Promise<boolean> {
    const current = await api.sessionContext();
    if (sequence !== generation.current) return false;
    if (!sameSession(expected, current)) {
      rememberIdentity(current);
      await refresh(false);
      return false;
    }
    return true;
  }
  async function refresh(
    resumeChurches = true,
    provisioned?: { organizationId: string } | "recover",
  ): Promise<void> {
    const sequence = ++generation.current;
    const previous = screenRef.current;
    // Conserva somente a geometria pública. Nenhum dado de usuário/tenant é retido.
    const layout =
      previous.kind === "loading"
        ? previous.layout
        : ["dashboard", "churches", "members"].includes(previous.kind)
          ? "management"
          : "access";
    setScreen({ kind: "loading", layout });
    if (sequence !== 1 || !link.invalid) setNotice(null);
    try {
      const [currentIdentity, stage] = await Promise.all([
        api.sessionContext(),
        api.stage(),
      ]);
      if (sequence !== generation.current) return;
      const sessionChanged = rememberIdentity(currentIdentity);
      const provisionResult = sessionChanged ? undefined : provisioned;
      if (
        stage !== "concluido" &&
        !(await confirmSession(currentIdentity, sequence))
      )
        return;
      setHasSession(stage !== "email");
      if (stage === "email" || stage === "verificar-email") {
        attempt.current = null;
        setUncertain(false);
        setScreen({
          kind:
            window.location.pathname === "/entrar" && stage === "email"
              ? "login"
              : "email",
        });
        if (tokenRef.current)
          setNotice({
            kind: "info",
            text: "Verifique seu e-mail neste navegador para definir a senha.",
          });
        setToken(null);
        return;
      }
      setEmailJourney({ kind: "entry", email: "" });
      if (stage === "senha" || tokenRef.current) {
        setScreen({ kind: "password" });
        return;
      }
      if (stage === "sem-acesso") {
        memberList.current = null;
        attempt.current = null;
        clearProvisionKey(requestStorage());
        setUncertain(false);
        setScreen({ kind: "no-access" });
        return;
      }
      if (stage === "organizacao") {
        memberList.current = null;
        setScreen({ kind: denied.current ? "no-access" : "organization" });
        setUncertain(false);
        return;
      }
      const finishProvision =
        Boolean(provisionResult) ||
        (!denied.current && attempt.current !== null);
      const management =
        finishProvision ||
        (resumeChurches &&
          !sessionChanged &&
          (["/igrejas", "/painel"].includes(window.location.pathname) ||
            window.location.pathname.startsWith("/membros")));
      const expectedOrganizationId =
        provisionResult && provisionResult !== "recover"
          ? provisionResult.organizationId
          : attempt.current?.kind === "confirmed"
            ? attempt.current.organizationId
            : null;
      denied.current = false;
      setUncertain(false);
      if (management) {
        const [context, churches] = await Promise.all([
          api.context(),
          api.churches(),
        ]);
        if (sequence !== generation.current) return;
        if (
          memberList.current &&
          memberList.current.organizationId !== context.organizationId
        )
          memberList.current = null;
        if (
          expectedOrganizationId &&
          context.organizationId !== expectedOrganizationId
        )
          throw new ApiError(
            403,
            "CONTEXTO_ALTERADO",
            "Selecione novamente a organização para continuar.",
          );
        if (churches.organizationId !== context.organizationId)
          throw new ApiError(
            403,
            "CONTEXTO_ALTERADO",
            "Selecione novamente a organização para continuar.",
          );
        const organization = {
          id: context.organizationId,
          nome: context.organizationName,
        };
        if (!(await confirmSession(currentIdentity, sequence))) return;
        if (finishProvision) navigate("/painel");
        if (
          sequence === generation.current &&
          window.location.pathname.startsWith("/membros")
        ) {
          if (!context.membersEnabled)
            throw new ApiError(
              403,
              "ACESSO_NEGADO",
              "O cadastro de membros não está habilitado neste ambiente.",
            );
          if (!currentIdentity)
            throw new ApiError(
              401,
              "SESSAO_NECESSARIA",
              "Entre na sua conta para continuar.",
            );
          const churchFilter =
            new URLSearchParams(window.location.search).get("igreja") ?? "";
          const saved = memberList.current;
          const filters: MemberFilters = churchFilter
            ? { page: 1, pageSize: 20, churchId: churchFilter }
            : saved &&
                saved.organizationId === organization.id &&
                sameSession(saved.identity, currentIdentity)
              ? saved.filters
              : { page: 1, pageSize: 20 };
          setScreen({
            kind: "members",
            organization,
            churches: churches.churches,
            path: window.location.pathname,
            churchFilter,
            identity: currentIdentity,
            filters,
          });
        } else if (sequence === generation.current)
          setScreen({
            kind:
              window.location.pathname === "/painel" ? "dashboard" : "churches",
            organization,
            items: churches.churches,
            membersEnabled: context.membersEnabled,
          });
      } else {
        const organizations = await api.organizations();
        if (sequence !== generation.current) return;
        if (
          memberList.current &&
          !organizations.some(
            (item) => item.id === memberList.current?.organizationId,
          )
        )
          memberList.current = null;
        if (!(await confirmSession(currentIdentity, sequence))) return;
        setScreen({ kind: "organizations", items: organizations });
      }
      const confirmedProvision = attempt.current?.kind === "confirmed";
      clearProvisionKey(requestStorage());
      attempt.current = null;
      if (finishProvision && sequence === generation.current)
        setNotice({
          kind: "success",
          text: confirmedProvision
            ? "Organização e primeira igreja criadas. Seu espaço está pronto. Se desejar, cadastre o primeiro membro."
            : "Acesso confirmado. Confira sua organização. Se desejar, cadastre o primeiro membro.",
        });
    } catch (error) {
      if (sequence !== generation.current) return;
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403) &&
        (resumeChurches || provisioned !== undefined)
      ) {
        denied.current = true;
        memberList.current = null;
        attempt.current = null;
        await refresh(false);
        setNotice({
          kind: "error",
          text: "Sua sessão ou seu acesso mudou. Confira as opções disponíveis para continuar.",
        });
      } else {
        setScreen({ kind: "failure" });
        setNotice({
          kind: "error",
          rateLimited: error instanceof ApiError && error.status === 429,
          text:
            error instanceof ApiError && error.status === 429
              ? error.message
              : "Não foi possível consultar seu acesso. Nenhuma operação será repetida automaticamente. Tente atualizar novamente.",
        });
      }
    }
  }

  useEffect(() => {
    void refresh();
    const onBack = () => {
      if (
        document.querySelector('form[data-dirty="true"]') &&
        !window.confirm(
          "Sair deste formulário? Os dados ainda não salvos serão descartados.",
        )
      ) {
        window.history.pushState(null, "", currentPath.current);
        return;
      }
      currentPath.current = window.location.pathname;
      if (!active.current) void refresh();
    };
    const onFocus = () => {
      if (document.querySelector('form[data-dirty="true"]')) {
        // Revalida sem desmontar o rascunho ao voltar do teclado ou de outro app.
        const currentScreen = screenRef.current;
        const sequence = generation.current;
        void (async () => {
          try {
            const currentIdentity = await api.sessionContext();
            if (sequence !== generation.current) return;
            if (!sameSession(identity.current, currentIdentity)) {
              rememberIdentity(currentIdentity);
              await refresh(false);
              return;
            }
            const stage = await api.stage();
            if (sequence !== generation.current) return;
            if (
              stage === "email" &&
              currentScreen.kind !== "email" &&
              currentScreen.kind !== "login"
            ) {
              await refresh(false);
              return;
            }
            if (currentScreen.kind === "members") {
              const context = await api.context();
              if (sequence !== generation.current) return;
              if (
                context.organizationId !== currentScreen.organization.id ||
                !context.membersEnabled
              )
                await refresh(false);
            }
          } catch (error) {
            if (sequence !== generation.current) return;
            if (error instanceof ApiError) {
              if ([401, 403].includes(error.status)) await refresh(false);
              else if (error.status === 429)
                setNotice({
                  kind: "error",
                  text: error.message,
                  rateLimited: true,
                });
            }
          }
        })();
        return;
      }
      if (
        !active.current &&
        (["/igrejas", "/painel", "/organizacoes"].includes(
          window.location.pathname,
        ) ||
          window.location.pathname.startsWith("/membros"))
      )
        void refresh();
    };
    window.addEventListener("popstate", onBack);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    return () => {
      ++generation.current;
      window.removeEventListener("popstate", onBack);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
    };
  }, []);
  useEffect(() => {
    if (screen.kind !== "loading") heading.current?.focus();
  }, [
    screen.kind,
    screen.kind === "members" ? screen.path : "",
    emailSent,
    Boolean(token),
  ]);

  async function perform(
    task: (isCurrent: () => boolean) => Promise<void>,
    provisioning = false,
    checkSession = true,
  ) {
    if (active.current) return;
    active.current = true;
    const operationSequence = generation.current;
    const operationIdentity = identity.current;
    const isCurrent = () =>
      operationSequence === generation.current &&
      sameSession(operationIdentity, identity.current);
    setBusy(true);
    setNotice(null);
    try {
      if (checkSession && identity.current) {
        const currentIdentity = await api.sessionContext();
        if (!isCurrent()) return;
        if (!sameSession(identity.current, currentIdentity)) {
          rememberIdentity(currentIdentity);
          await refresh(false);
          return;
        }
      }
      await task(isCurrent);
    } catch (error) {
      if (!sameSession(operationIdentity, identity.current)) return;
      if (error instanceof ApiError) {
        setNotice({
          kind: "error",
          text: error.message,
          rateLimited: error.status === 429,
        });
        if (error.status === 401 || error.status === 403) {
          denied.current = error.status === 403;
          await refresh(false);
        } else if (error.status === 409) {
          denied.current = true;
          await refresh(false);
          if (!sameSession(operationIdentity, identity.current)) return;
          setNotice({
            kind: "info",
            text: "Seu cadastro inicial já foi concluído. Atualize suas organizações para continuar. Se não houver acesso, procure o responsável pela organização.",
          });
        } else if (error.status === 0 || error.status >= 500) {
          if (provisioning) setUncertain(true);
        }
      } else {
        setScreen({ kind: "failure" });
        setNotice({
          kind: "error",
          text: "Não foi possível confirmar a operação. Atualize seu acesso antes de continuar.",
        });
      }
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  async function sendEmail(email: string) {
    if (emailRetryAt > Date.now())
      throw new ApiError(
        429,
        "ENVIO_EM_ESPERA",
        `Aguarde ${Math.ceil((emailRetryAt - Date.now()) / 1000)} segundos antes de solicitar outro link.`,
        emailRetryAt,
      );
    setEmailJourney((current) => ({ ...current, email }));
    const sequence = generation.current;
    const senderIdentity = identity.current;
    try {
      await api.email(email);
      if (
        sequence !== generation.current ||
        !sameSession(senderIdentity, identity.current)
      )
        return;
      setEmailJourney({ kind: "waiting", email });
      setEmailRetryAt(Date.now() + 60_000);
      setClock(Date.now());
      setNotice({
        kind: "info",
        text: "Link solicitado. Confira sua caixa de entrada e o spam.",
      });
    } catch (error) {
      if (
        sequence !== generation.current ||
        !sameSession(senderIdentity, identity.current)
      )
        return;
      if (error instanceof ApiError && error.status === 429 && error.retryAt) {
        setEmailRetryAt(error.retryAt);
        setClock(Date.now());
      }
      throw error;
    }
  }
  const update = () =>
    void perform(
      async () => {
        await refresh();
      },
      false,
      false,
    );

  const titles: Record<Screen["kind"], string> = {
    loading: "Consultando seu acesso",
    failure: "Vamos tentar novamente",
    "no-access": "Seu acesso precisa de atenção",
    email: emailSent
      ? "Confira sua caixa de entrada"
      : "Comece pelo seu e-mail",
    login: "Bem-vindo de volta",
    password: token
      ? "Escolha sua senha"
      : "E-mail verificado. Agora, sua senha.",
    organization: "Um lugar para sua comunidade",
    organizations: "Suas organizações",
    dashboard: "Visão geral",
    churches: "Igrejas da organização",
    members:
      screen.kind === "members" && screen.path.endsWith("/editar")
        ? "Editar membro"
        : screen.kind === "members" && screen.path === "/membros/novo"
          ? "Cadastrar membro"
          : screen.kind === "members" && screen.path !== "/membros"
            ? "Ficha do membro"
            : "Membros",
  };
  const documentTitle = titles[screen.kind];
  useEffect(() => {
    document.title = `${documentTitle} · Levi`;
  }, [documentTitle]);
  const step =
    screen.kind === "email" || screen.kind === "login"
      ? 0
      : screen.kind === "password"
        ? 1
        : 2;
  const showSteps = ["email", "password", "organization"].includes(screen.kind);
  const managementLoading =
    screen.kind === "loading" && screen.layout === "management";
  const administrative =
    managementLoading ||
    ["dashboard", "churches", "members", "organizations"].includes(screen.kind);
  const currentOrganization =
    screen.kind === "churches" ||
    screen.kind === "dashboard" ||
    screen.kind === "members"
      ? screen.organization
      : null;
  const membersEnabled =
    screen.kind === "members" ||
    ((screen.kind === "churches" || screen.kind === "dashboard") &&
      screen.membersEnabled);
  function go(path: string, success?: string) {
    if (
      !success &&
      document.querySelector('form[data-dirty="true"]') &&
      !window.confirm(
        "Sair deste formulário? Os dados ainda não salvos serão descartados.",
      )
    )
      return;
    navigate(path);
    const sourceIdentity = identity.current;
    void perform(
      async () => {
        await refresh();
        if (success && sameSession(sourceIdentity, identity.current))
          setNotice({ kind: "success", text: success });
      },
      false,
      false,
    );
  }
  const logoutButton = (
    <button
      className="text-button"
      disabled={busy}
      onClick={() =>
        void perform(
          async (isCurrent) => {
            if (
              document.querySelector('form[data-dirty="true"]') &&
              !window.confirm(
                "Sair da conta? Os dados ainda não salvos serão descartados.",
              )
            )
              return;
            setScreen({ kind: "loading", layout: "access" });
            await api.logout();
            if (!isCurrent()) return;
            setToken(null);
            clearProvisionKey(requestStorage());
            attempt.current = null;
            denied.current = false;
            setEmailJourney({ kind: "entry", email: "" });
            navigate("/");
            await refresh(false);
          },
          false,
          false,
        )
      }
    >
      Sair
    </button>
  );
  const navigation = currentOrganization && (
    <nav aria-label="Navegação da organização" className="admin-nav">
      {(
        [
          { path: "/painel", label: "Início", icon: "home" },
          { path: "/igrejas", label: "Igrejas", icon: "church" },
          ...(membersEnabled
            ? [{ path: "/membros", label: "Membros", icon: "people" }]
            : []),
        ] as const
      ).map((item) => (
        <NavigationLink
          key={item.path}
          href={item.path}
          navigate={go}
          disabled={busy}
          aria-current={
            (screen.kind === "dashboard" && item.path === "/painel") ||
            (screen.kind === "churches" && item.path === "/igrejas") ||
            (screen.kind === "members" && item.path === "/membros")
              ? "page"
              : undefined
          }
        >
          <Icon name={item.icon as "home" | "church" | "people"} />
          {item.label}
        </NavigationLink>
      ))}
      <details key={screen.kind} className="navigation-more">
        <summary>
          <span aria-hidden="true">•••</span>Mais
        </summary>
        <div className="navigation-actions">
          <NavigationLink
            href="/organizacoes"
            navigate={go}
            className="organization-switch"
            disabled={busy}
          >
            <span aria-hidden="true">⇄</span>Trocar organização
          </NavigationLink>
          {logoutButton}
        </div>
      </details>
    </nav>
  );
  return (
    <div className={`app ${administrative ? "admin-app" : "access-app"}`}>
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="topbar">
        <a
          className="brand"
          href={currentOrganization ? "/painel" : "/"}
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            go(currentOrganization ? "/painel" : "/");
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <span>
            Levi <small>Gestão de igrejas</small>
          </span>
        </a>
        {managementLoading && (
          <Skeleton className="loading-context placeholder" />
        )}
        {currentOrganization && (
          <div className="context-label">
            <span className="eyebrow">Organização ativa</span>
            <strong>{currentOrganization.nome}</strong>
            <span className="context-role">Administração</span>
          </div>
        )}
        {hasSession && !currentOrganization && logoutButton}
      </header>
      {managementLoading && (
        <aside className="sidebar loading-sidebar" aria-hidden="true">
          <Skeleton className="placeholder" />
          <Skeleton className="placeholder" />
          <Skeleton className="placeholder" />
          <Skeleton className="placeholder" />
        </aside>
      )}
      {administrative && currentOrganization && (
        <aside className="sidebar">
          <p className="nav-caption">ESPAÇO DE GESTÃO</p>
          {navigation}
          <div className="sidebar-note">
            <span className="context-role">Acesso administrativo</span>
            <p>
              Um espaço para organizar
              <br />e cuidar das pessoas.
            </p>
          </div>
        </aside>
      )}
      <div className={`workspace ${showSteps ? "with-steps" : ""}`}>
        {showSteps && (
          <aside className="journey" aria-label="Etapas para começar">
            <p className="eyebrow">Seu primeiro acesso</p>
            <h2>
              Cuidado com as pessoas.
              <br />
              Clareza na gestão.
            </h2>
            <p>
              Vamos preparar seu acesso e o espaço da sua organização, uma etapa
              de cada vez.
            </p>
            <ol>
              {[
                "Verifique seu e-mail",
                "Defina sua senha",
                "Organize sua primeira igreja",
              ].map((label, index) => (
                <li
                  key={label}
                  aria-current={index === step ? "step" : undefined}
                >
                  <span aria-hidden="true">{index + 1}</span>
                  {label}
                </li>
              ))}
            </ol>
            <p className="journey-note">
              Você recebe um e-mail para confirmar seu acesso e depois define
              sua senha aqui.
            </p>
          </aside>
        )}
        <main
          id="conteudo"
          className={`panel ${administrative ? "admin-panel" : "access-panel"}`}
          aria-busy={busy || screen.kind === "loading"}
        >
          <p className="eyebrow">
            {screen.kind === "churches"
              ? "Sua organização"
              : showSteps
                ? "Vamos começar"
                : "Seu espaço no Levi"}
          </p>
          {showSteps && <p className="step-caption">Etapa {step + 1} de 3</p>}
          <h1 ref={heading} tabIndex={-1}>
            {titles[screen.kind]}
          </h1>
          <div aria-live="polite" aria-atomic="true">
            {busy || screen.kind === "loading" ? (
              <p className="loading" role="status">
                Aguarde, estamos consultando o Levi…
              </p>
            ) : null}
          </div>
          {notice && (
            <div
              className={`notice ${notice.kind}`}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.text}
            </div>
          )}

          {screen.kind === "email" && (
            <>
              {emailSent ? (
                <>
                  <p className="email-confirmation">
                    Endereço informado: <strong>{emailJourney.email}</strong>
                  </p>
                  <p>
                    Use o link recebido para verificar seu e-mail e continuar.
                    Se não encontrar a mensagem, confira também o spam.
                    Solicitações repetidas podem ser limitadas; aguarde antes de
                    pedir outro link.
                  </p>
                  <p>
                    Abra o link neste navegador para continuar aqui. Se abrir em
                    outro dispositivo, o acesso continuará naquele dispositivo.
                  </p>
                  <button className="primary" disabled={busy} onClick={update}>
                    Já abri o link. Continuar
                  </button>
                  <button
                    className="text-button"
                    disabled={busy || emailWait > 0}
                    onClick={() =>
                      void perform(() => sendEmail(emailJourney.email))
                    }
                    aria-describedby="email-wait"
                  >
                    Reenviar link
                  </button>
                  <p id="email-wait" className="hint">
                    {emailWait > 0
                      ? `Você pode reenviar em ${emailWait} segundos.`
                      : "Se precisar, solicite outro link para o mesmo endereço."}
                  </p>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setEmailJourney((current) => ({
                        kind: "entry",
                        email: current.email,
                      }));
                      setNotice(null);
                    }}
                  >
                    Alterar e-mail
                  </button>
                </>
              ) : (
                <>
                  <p>
                    Informe seu e-mail para receber um link de acesso. Você
                    ainda não precisa de senha.
                  </p>
                  <AccessForm
                    mode="email"
                    email={emailJourney.email}
                    busy={busy}
                    onSubmit={(values) =>
                      perform(() => sendEmail(values.email!.trim()))
                    }
                  />
                </>
              )}
              <p className="secondary-action">
                Já definiu sua senha?{" "}
                <a
                  href="/entrar"
                  onClick={(event) => {
                    event.preventDefault();
                    navigate("/entrar");
                    update();
                  }}
                >
                  Entrar na minha conta
                </a>
              </p>
            </>
          )}
          {screen.kind === "login" && (
            <>
              <p>Entre com o e-mail e a senha que você já definiu.</p>
              <AccessForm
                mode="login"
                busy={busy}
                onSubmit={(values) =>
                  perform(async (isCurrent) => {
                    await api.login(values.email!.trim(), values.password!);
                    if (!isCurrent()) return;
                    denied.current = false;
                    navigate("/organizacoes");
                    await refresh(false);
                  })
                }
              />
              <p className="secondary-action">
                Prefere entrar sem digitar a senha?{" "}
                <a
                  href="/"
                  onClick={(event) => {
                    event.preventDefault();
                    setEmailJourney({ kind: "entry", email: "" });
                    navigate("/");
                    update();
                  }}
                >
                  Entrar por link de e-mail
                </a>
              </p>
            </>
          )}
          {screen.kind === "password" && (
            <>
              <p>
                Defina e confirme sua senha para concluir a preparação da sua
                conta.
              </p>
              <AccessForm
                mode="password"
                busy={busy}
                onSubmit={(values) =>
                  perform(async (isCurrent) => {
                    try {
                      await api.password(token, values.newPassword!);
                    } catch (error) {
                      if (!isCurrent()) return;
                      setToken(null);
                      tokenRef.current = null;
                      await refresh(false);
                      throw error;
                    }
                    if (!isCurrent()) return;
                    setToken(null);
                    tokenRef.current = null;
                    const sourceIdentity = identity.current;
                    await refresh(false);
                    if (!sameSession(sourceIdentity, identity.current)) return;
                    setNotice({
                      kind: "success",
                      text: "Senha definida. Sua conta está pronta para continuar.",
                    });
                  })
                }
              />
              <button
                disabled={busy}
                onClick={() => {
                  setEmailJourney({ kind: "entry", email: "" });
                  setToken(null);
                  tokenRef.current = null;
                  setScreen({ kind: "email" });
                }}
              >
                Confirmar meu e-mail novamente
              </button>
            </>
          )}
          {screen.kind === "organization" && (
            <>
              <p>
                A organização reúne as igrejas que você administra e mantém seus
                cadastros separados de outras organizações. Crie esse espaço com
                sua primeira igreja; apenas os nomes são obrigatórios.
              </p>
              <p className="hint">
                Se você já participa de uma organização, procure seu responsável
                para conferir seu acesso administrativo. Este formulário cria
                uma nova organização.
              </p>
              {uncertain ? (
                <>
                  <p>
                    Não sabemos se a solicitação foi concluída. Confira o
                    resultado antes de reenviar; manteremos a mesma tentativa.
                  </p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await refresh(false, "recover");
                      })
                    }
                  >
                    Verificar resultado
                  </button>
                </>
              ) : (
                <AccessForm
                  key={identity.current?.sessionId ?? "organization"}
                  mode="organization"
                  busy={busy}
                  initial={attempt.current?.input}
                  onSubmit={(values) =>
                    perform(async (isCurrent) => {
                      const input = {
                        organizationName: values.organizationName!.trim(),
                        churchName: values.churchName!.trim(),
                        churchAddress: values.churchAddress?.trim() || null,
                        churchPhone: values.churchPhone?.trim() || null,
                        churchEmail: values.churchEmail?.trim() || null,
                      };
                      const key =
                        attempt.current?.key ?? provisionKey(requestStorage());
                      attempt.current = { kind: "pending", key, input };
                      const result = await api.provision(input, key);
                      if (!isCurrent()) return;
                      attempt.current = {
                        kind: "confirmed",
                        key,
                        input,
                        organizationId: result.organizationId,
                      };
                      await refresh(false, result);
                    }, true)
                  }
                />
              )}
            </>
          )}
          {screen.kind === "organizations" && (
            <>
              <p>
                Escolha a organização que deseja acessar. Seu vínculo é
                conferido a cada acesso.
              </p>
              {screen.items.length ? (
                <ul className="item-list">
                  {screen.items.map((item) => (
                    <li key={item.id}>
                      <div>
                        <span className="item-symbol" aria-hidden="true">
                          O
                        </span>
                        <strong>{item.nome}</strong>
                      </div>
                      <button
                        className="primary compact"
                        disabled={busy}
                        onClick={() =>
                          void perform(async (isCurrent) => {
                            memberList.current = null;
                            setScreen({ kind: "loading", layout: "access" });
                            await api.select(item.id);
                            if (!isCurrent()) return;
                            navigate("/igrejas");
                            await refresh();
                          })
                        }
                        aria-label={`Acessar organização ${item.nome}`}
                      >
                        Acessar organização <span aria-hidden="true">→</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  Nenhuma organização está disponível com vínculo administrativo
                  atual. Procure o responsável pela organização.
                </p>
              )}
              <button className="text-button" disabled={busy} onClick={update}>
                Atualizar organizações
              </button>
            </>
          )}
          {screen.kind === "members" && (
            <Members
              key={`${screen.identity.sessionId}:${screen.organization.id}:${screen.path}:${screen.churchFilter}`}
              organization={screen.organization}
              churches={screen.churches}
              path={screen.path}
              identity={screen.identity}
              initialFilters={screen.filters}
              onFiltersChange={(filters) => {
                if (sameSession(identity.current, screen.identity))
                  memberList.current = {
                    identity: screen.identity,
                    organizationId: screen.organization.id,
                    filters,
                  };
              }}
              navigate={go}
              onAccessChanged={() => {
                denied.current = true;
                memberList.current = null;
                void refresh(false);
              }}
            />
          )}
          {screen.kind === "dashboard" && (
            <>
              <div className="welcome surface">
                <div>
                  <p className="eyebrow">Sua comunidade, mais próxima</p>
                  <h2>Seu espaço de gestão está pronto.</h2>
                  <p>
                    Comece pelo cadastro de uma pessoa ou consulte os membros já
                    registrados. Os campos pessoais opcionais podem ficar em
                    branco.
                  </p>
                  <button
                    className="primary"
                    onClick={() =>
                      go(membersEnabled ? "/membros/novo" : "/igrejas")
                    }
                  >
                    <Icon name="plus" />
                    {membersEnabled ? "Cadastrar membro" : "Consultar igrejas"}
                  </button>
                </div>
                <div className="welcome-mark" aria-hidden="true">
                  <Icon name="people" />
                </div>
              </div>
              <div className="overview-grid">
                <div className="surface overview-card">
                  <span className="tile-icon">
                    <Icon name="church" />
                  </span>
                  <p>Igrejas na organização</p>
                  <strong className="metric">{screen.items.length}</strong>
                  <button
                    className="text-button"
                    onClick={() => go("/igrejas")}
                  >
                    Consultar igrejas →
                  </button>
                </div>
                <div className="surface overview-card">
                  <span className="tile-icon">
                    <Icon name="people" />
                  </span>
                  <h2>Gestão de membros</h2>
                  <p>
                    {membersEnabled
                      ? "Cadastros organizados, contatos e informações sempre à mão."
                      : "Este recurso ainda não está disponível para esta organização."}
                  </p>
                  {membersEnabled && (
                    <button
                      className="text-button"
                      onClick={() => go("/membros")}
                    >
                      Consultar membros →
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
          {screen.kind === "churches" && (
            <>
              <div className="page-intro">
                <p>As igrejas que fazem parte da sua organização.</p>
                <span className="count-label">
                  {screen.items.length}{" "}
                  {screen.items.length === 1 ? "igreja" : "igrejas"}
                </span>
              </div>
              {screen.items.length ? (
                <ul className="church-grid">
                  {screen.items.map((item) => (
                    <li className="surface church-card" key={item.id}>
                      <span className="tile-icon">
                        <Icon name="church" />
                      </span>
                      <div>
                        <span className="eyebrow">Igreja</span>
                        <h2>{item.nome}</h2>
                      </div>
                      {item.address || item.phone || item.email ? (
                        <dl>
                          <dt>Endereço</dt>
                          <dd>{item.address || "Não informado"}</dd>
                          <dt>Telefone</dt>
                          <dd>{item.phone || "Não informado"}</dd>
                          <dt>E-mail</dt>
                          <dd>{item.email || "Não informado"}</dd>
                        </dl>
                      ) : (
                        <p className="hint">Contatos não informados.</p>
                      )}
                      {membersEnabled && (
                        <NavigationLink
                          className="secondary"
                          href={`/membros?igreja=${item.id}`}
                          navigate={go}
                          aria-label={`Consultar membros de ${item.nome}`}
                        >
                          Consultar membros <Icon name="arrow" />
                        </NavigationLink>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon="church"
                  title="Nenhuma igreja disponível nesta organização."
                >
                  <p>
                    Atualize a consulta ou confira seu acesso com o responsável
                    pela organização.
                  </p>
                </EmptyState>
              )}
              <button className="text-button" disabled={busy} onClick={update}>
                Atualizar igrejas
              </button>
            </>
          )}
          {(screen.kind === "failure" || screen.kind === "no-access") && (
            <>
              <p>
                {screen.kind === "no-access"
                  ? "Não há acesso administrativo disponível neste momento. Atualize para verificar novamente ou procure o responsável pela organização."
                  : notice?.rateLimited
                    ? "Aguarde o prazo indicado antes de atualizar o acesso."
                    : "Confira sua conexão e tente consultar seu acesso novamente."}
              </p>
              <button className="primary" disabled={busy} onClick={update}>
                Atualizar acesso
              </button>
            </>
          )}
        </main>
      </div>
      <footer className={administrative ? "admin-footer" : ""}>
        Levi <span aria-hidden="true">·</span> Um espaço para organizar e
        cuidar.
      </footer>
    </div>
  );
}
