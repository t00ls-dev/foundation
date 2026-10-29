import { formText } from "./form-data.js";
import {
  EmptyState,
  Icon,
  NavigationLink,
  Status,
  useDraftGuard,
} from "./ui.js";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  ApiError,
  memberApi,
  type NamedItem,
  type SessionContext,
} from "./api.js";
import { requestStorage, sameSession } from "./session.js";
import {
  formatCivilDate,
  memberTextLimits,
  isCivilDate,
  type Member,
  type MemberInput,
  type MemberFilters,
  type MemberPage,
  type MemberStatus,
} from "../../src/member-types.js";

const optionalFields = [
  ["birthDate", "Data de nascimento", "date"],
  ["phone", "Telefone", "tel"],
  ["email", "E-mail de contato", "email"],
  ["joinedOn", "Data de ingresso conhecida", "date"],
  ["address", "Endereço", "text"],
  ["baptismDate", "Data de batismo", "date"],
  ["churchRole", "Função na igreja", "text"],
] as const;
export function Members({
  organization,
  churches,
  path,
  navigate,
  onAccessChanged,
  identity,
  initialFilters,
  onFiltersChange,
}: {
  organization: NamedItem;
  churches: NamedItem[];
  path: string;
  identity: SessionContext;
  initialFilters: MemberFilters;
  onFiltersChange: (filters: MemberFilters) => void;
  navigate: (path: string, success?: string) => void;
  onAccessChanged: () => void;
}) {
  const mode = path.endsWith("/editar")
    ? "edit"
    : path === "/membros/novo"
      ? "create"
      : path === "/membros"
        ? "list"
        : "detail";
  const [filtersOpen, setFiltersOpen] = useState(
    () => window.matchMedia("(min-width: 64.001rem)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(min-width: 64.001rem)");
    const change = () => setFiltersOpen(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const [page, setPage] = useState<MemberPage | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<MemberFilters>(initialFilters);
  const [uncertain, setUncertain] = useState(false);
  const generation = useRef(0);
  const running = useRef(false);
  const pending = useRef<{ key: string; input: MemberInput } | null>(null);
  const storageKey = `levi.member.request.${organization.id}`;
  const memoryKey = useRef<string | null>(null);
  function getKey() {
    try {
      const value = requestStorage()?.getItem(storageKey);
      if (value && /^[a-zA-Z0-9_-]{16,128}$/.test(value)) return value;
    } catch {
      /* Sem dados pessoais no storage. */
    }
    return memoryKey.current;
  }
  function saveKey() {
    const key = getKey() ?? crypto.randomUUID();
    memoryKey.current = key;
    try {
      requestStorage()?.setItem(storageKey, key);
    } catch {
      /* Conserva em memória. */
    }
    return key;
  }
  function clearKey() {
    memoryKey.current = null;
    try {
      requestStorage()?.removeItem(storageKey);
    } catch {
      /* Sem credenciais. */
    }
  }
  function check(organizationId: string) {
    if (organizationId !== organization.id)
      throw new ApiError(
        403,
        "CONTEXTO_ALTERADO",
        "Selecione novamente a organização para continuar.",
      );
  }
  async function validateSession() {
    if (!sameSession(identity, await api.sessionContext()))
      throw new ApiError(
        401,
        "SESSAO_ALTERADA",
        "Sua sessão mudou. Confira seu acesso antes de continuar.",
      );
  }
  async function validateContext() {
    await validateSession();
    const current = await api.context();
    check(current.organizationId);
    if (!current.membersEnabled)
      throw new ApiError(
        403,
        "ACESSO_NEGADO",
        "O cadastro de membros não está habilitado neste ambiente.",
      );
  }
  function fail(cause: unknown) {
    setPage(null);
    setMember(null);
    if (
      cause instanceof ApiError &&
      (cause.status === 401 || cause.status === 403)
    )
      onAccessChanged();
    else
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Não foi possível consultar os membros. Tente novamente.",
      );
  }
  async function load() {
    const sequence = ++generation.current;
    setPage(null);
    setMember(null);
    setError(null);
    setBusy(true);
    try {
      await validateContext();
      if (sequence !== generation.current) return;
      if (mode === "list") {
        const result = await memberApi.list(filters);
        check(result.organizationId);
        await validateSession();
        if (sequence === generation.current) setPage(result);
      } else if (mode === "detail" || mode === "edit") {
        const result = await memberApi.find(path.split("/")[2] ?? "");
        check(result.organizationId);
        await validateSession();
        if (sequence === generation.current) setMember(result.member);
      } else {
        const key = getKey();
        if (key) {
          try {
            const result = await memberApi.recover(key);
            check(result.organizationId);
            await validateSession();
            if (sequence === generation.current) {
              clearKey();
              navigate(
                `/membros/${result.memberId}`,
                "Membro cadastrado com sucesso. Confira os dados na ficha abaixo.",
              );
            }
          } catch (cause) {
            if (!(cause instanceof ApiError && cause.status === 404))
              throw cause;
          }
        }
      }
    } catch (cause) {
      if (sequence === generation.current) fail(cause);
    } finally {
      if (sequence === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (mode === "list") onFiltersChange(filters);
    void load();
    return () => {
      ++generation.current;
    };
    // Contexto e caminho são imutáveis nesta montagem (key no componente pai).
  }, [filters]);

  async function submit(input: MemberInput) {
    if (running.current) return;
    running.current = true;
    const sequence = generation.current;
    setBusy(true);
    setError(null);
    const attempt = pending.current ?? { key: saveKey(), input };
    pending.current = attempt;
    try {
      await validateContext();
      if (sequence !== generation.current) return;
      const result = await memberApi.create(attempt.input, attempt.key);
      check(result.organizationId);
      await validateSession();
      if (sequence === generation.current) {
        clearKey();
        navigate(
          `/membros/${result.memberId}`,
          "Membro cadastrado com sucesso. Confira os dados na ficha abaixo.",
        );
      }
    } catch (cause) {
      if (sequence !== generation.current) return;
      if (
        cause instanceof ApiError &&
        (cause.status === 0 || cause.status >= 500 || cause.status === 409)
      )
        setUncertain(true);
      else pending.current = null;
      fail(cause);
    } finally {
      running.current = false;
      if (sequence === generation.current) setBusy(false);
    }
  }
  async function recover() {
    if (running.current) return;
    const key = getKey();
    if (!key) return;
    running.current = true;
    setBusy(true);
    setError(null);
    const sequence = generation.current;
    try {
      await validateContext();
      const result = await memberApi.recover(key);
      check(result.organizationId);
      await validateSession();
      if (sequence === generation.current) {
        clearKey();
        navigate(
          `/membros/${result.memberId}`,
          "Membro cadastrado com sucesso. Confira os dados na ficha abaixo.",
        );
      }
    } catch (cause) {
      if (sequence !== generation.current) return;
      if (cause instanceof ApiError && cause.status === 404)
        setError(
          "Cadastro ainda não confirmado. Você pode repetir a mesma tentativa com segurança.",
        );
      else fail(cause);
    } finally {
      running.current = false;
      if (sequence === generation.current) setBusy(false);
    }
  }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setFilters({
      page: 1,
      pageSize: 20,
      name: formText(data, "name"),
      churchId: formText(data, "churchId"),
      ...(data.get("status")
        ? { status: data.get("status") as MemberStatus }
        : {}),
    });
  }
  const hasFilters = Boolean(
    filters.name ||
    filters.churchId ||
    filters.status ||
    (filters.page ?? 1) > 1,
  );
  return (
    <section aria-label="Gestão de membros" aria-busy={busy}>
      {mode !== "list" && (
        <NavigationLink
          href="/membros"
          navigate={navigate}
          aria-label="Voltar aos membros"
          className="text-button back-link"
          disabled={busy}
        >
          ← Voltar aos membros
        </NavigationLink>
      )}
      {busy && <p role="status">Consultando membros…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {mode === "list" && (
        <>
          <div className="page-intro">
            <p>Cadastros e contatos da sua organização.</p>
            <button
              className="primary"
              disabled={busy}
              onClick={() => navigate("/membros/novo")}
            >
              <Icon name="plus" />
              Cadastrar membro
            </button>
          </div>
          <form aria-label="Filtrar membros" onSubmit={filter}>
            <fieldset disabled={busy} className="filter-grid">
              <legend className="sr-only">Filtros</legend>
              <div className="field">
                <label htmlFor="member-name-filter">Nome</label>
                <input
                  id="member-name-filter"
                  name="name"
                  maxLength={160}
                  defaultValue={filters.name ?? ""}
                />
              </div>
              <details
                className="member-filter-options"
                open={filtersOpen}
                onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
              >
                <summary>Mais filtros</summary>
                <div className="filter-options-grid">
                  <div className="field">
                    <label htmlFor="member-church-filter">Igreja</label>
                    <select
                      id="member-church-filter"
                      name="churchId"
                      defaultValue={filters.churchId ?? ""}
                    >
                      <option value="">Todas as igrejas</option>
                      {churches.map((church) => (
                        <option key={church.id} value={church.id}>
                          {church.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="member-status-filter">Situação</label>
                    <select
                      id="member-status-filter"
                      name="status"
                      defaultValue={filters.status ?? ""}
                    >
                      <option value="">Todas as situações</option>
                      <option>Ativo</option>
                      <option>Inativo</option>
                    </select>
                  </div>
                </div>
              </details>
              <button
                className="secondary"
                type="submit"
                aria-label="Filtrar membros"
              >
                Filtrar
              </button>
            </fieldset>
          </form>
          {page && (
            <>
              {page.members.length ? (
                <ul className="item-list member-list">
                  {page.members.map((item) => (
                    <li key={item.id}>
                      <span className="avatar" aria-hidden="true">
                        {item.name
                          .trim()
                          .slice(0, 1)
                          .toLocaleUpperCase("pt-BR")}
                      </span>
                      <div className="member-summary">
                        <strong>{item.name}</strong>
                        <span>{item.churchName}</span>
                      </div>
                      <Status value={item.status} />
                      <NavigationLink
                        href={`/membros/${item.id}`}
                        navigate={navigate}
                        className="secondary compact"
                        aria-label={`Consultar ficha de ${item.name}`}
                      >
                        Consultar ficha
                      </NavigationLink>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title={
                    hasFilters
                      ? "Nenhum membro neste recorte."
                      : "Nenhum membro cadastrado."
                  }
                >
                  {hasFilters ? (
                    <>
                      <p>
                        Altere os filtros ou volte à lista completa da
                        organização.
                      </p>
                      <button
                        className="secondary"
                        onClick={() => {
                          onFiltersChange({ page: 1, pageSize: 20 });
                          navigate("/membros");
                        }}
                      >
                        Limpar filtros
                      </button>
                    </>
                  ) : (
                    <p>
                      Use “Cadastrar membro” para registrar a primeira pessoa.
                      Apenas nome, igreja e situação são obrigatórios.
                    </p>
                  )}
                </EmptyState>
              )}
              <nav
                className="actions pagination"
                aria-label="Paginação dos membros"
              >
                <button
                  className="secondary"
                  disabled={busy || page.page === 1}
                  onClick={() =>
                    setFilters({ ...filters, page: page.page - 1 })
                  }
                >
                  Página anterior
                </button>
                <span aria-live="polite">Página {page.page}</span>
                <button
                  className="secondary"
                  disabled={busy || !page.hasNext}
                  onClick={() =>
                    setFilters({ ...filters, page: page.page + 1 })
                  }
                >
                  Próxima página
                </button>
              </nav>
            </>
          )}
        </>
      )}
      {mode === "create" && (
        <>
          {uncertain ? (
            <div className="notice">
              <p>
                O resultado ainda não foi confirmado. Consulte o cadastro ou
                repita a mesma tentativa; os dados enviados serão preservados
                somente nesta página.
              </p>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void recover()}
                >
                  Consultar resultado
                </button>
                <button
                  className="primary"
                  disabled={busy || !pending.current}
                  onClick={() =>
                    pending.current && void submit(pending.current.input)
                  }
                >
                  Repetir mesma tentativa
                </button>
              </div>
            </div>
          ) : (
            <MemberForm busy={busy} churches={churches} onSubmit={submit} />
          )}
        </>
      )}
      {mode === "edit" && member && (
        <MemberForm
          busy={busy}
          churches={churches}
          initial={member}
          onSubmit={async (input) => {
            if (running.current) return;
            running.current = true;
            setBusy(true);
            setError(null);
            const sequence = generation.current;
            try {
              await validateContext();
              if (sequence !== generation.current) return;
              const profile = {
                name: input.name,
                birthDate: input.birthDate ?? null,
                phone: input.phone ?? null,
                email: input.email ?? null,
                joinedOn: input.joinedOn ?? null,
                address: input.address ?? null,
                baptismDate: input.baptismDate ?? null,
                churchRole: input.churchRole ?? null,
              };
              const result = await memberApi.edit(member.id, {
                ...profile,
                version: member.version,
              });
              check(result.organizationId);
              await validateSession();
              if (sequence === generation.current)
                navigate(
                  `/membros/${member.id}`,
                  "Dados do membro atualizados com sucesso.",
                );
            } catch (cause) {
              if (sequence !== generation.current) return;
              if (
                cause instanceof ApiError &&
                (cause.status === 401 || cause.status === 403)
              )
                onAccessChanged();
              else
                setError(
                  cause instanceof ApiError
                    ? cause.message
                    : "Não foi possível confirmar a alteração. Consulte a ficha antes de tentar novamente.",
                );
            } finally {
              running.current = false;
              if (sequence === generation.current) setBusy(false);
            }
          }}
        />
      )}
      {mode === "edit" && error && member && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => navigate(`/membros/${member.id}`)}
        >
          Consultar ficha atual
        </button>
      )}
      {mode === "detail" && member && (
        <>
          <div className="profile-header">
            <span className="avatar large" aria-hidden="true">
              {member.name.trim().slice(0, 1)}
            </span>
            <div>
              <p className="eyebrow">Cadastro individual</p>
              <h2>{member.name}</h2>
              <Status value={member.status} />
            </div>
            <button
              className="secondary"
              onClick={() => navigate(`/membros/${member.id}/editar`)}
            >
              Editar membro
            </button>
          </div>
          <dl className="member-details surface">
            <dt>Igreja</dt>
            <dd>{member.churchName}</dd>
            {optionalFields.map(([key, label, type]) => (
              <Fragment key={key}>
                <dt>{label}</dt>
                <dd>
                  {type === "date"
                    ? formatCivilDate(member[key])
                    : member[key] || "Não informado"}
                </dd>
              </Fragment>
            ))}
            <dt>Cadastrado em</dt>
            <dd>{new Date(member.createdAt).toLocaleString("pt-BR")}</dd>
          </dl>
        </>
      )}
      {error && !uncertain && mode === "list" && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Atualizar membros
        </button>
      )}
    </section>
  );
}
function MemberForm({
  churches,
  busy,
  initial,
  onSubmit,
}: {
  churches: NamedItem[];
  busy: boolean;
  initial?: Member;
  onSubmit: (input: MemberInput) => Promise<void>;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const draft = useDraftGuard();
  const formRef = useRef<HTMLFormElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      busy ||
      (event.nativeEvent as SubmitEvent).submitter !== saveRef.current
    )
      return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const input: MemberInput = {
      churchId: initial?.churchId ?? formText(data, "churchId"),
      name: formText(data, "name").trim(),
      status: initial?.status ?? (data.get("status") as MemberStatus),
    };
    const next: Record<string, string> = {};
    if (!input.name) next.name = "Informe o nome do membro.";
    if (!input.churchId) next.churchId = "Selecione uma igreja.";
    for (const [key, , type] of optionalFields) {
      input[key] = formText(data, key).trim() || null;
      if (
        type === "date" &&
        ((form.elements.namedItem(key) as HTMLInputElement).validity.badInput ||
          (input[key] && !isCivilDate(input[key])))
      )
        next[key] = "Informe uma data válida.";
    }
    if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
      next.email = "Informe um e-mail válido.";
    for (const [key, max] of Object.entries(memberTextLimits)) {
      if (String(input[key as keyof MemberInput] ?? "").length > max)
        next[key] = `Use no máximo ${max} caracteres.`;
    }
    setErrors(next);
    if (Object.keys(next).length) {
      (form.elements.namedItem(Object.keys(next)[0]!) as HTMLElement)?.focus();
      return;
    }
    await onSubmit(input);
  }
  function field(key: (typeof optionalFields)[number][0]) {
    const [, label, type] = optionalFields.find(([value]) => value === key)!;
    return (
      <div
        className={`field ${key === "address" ? "full-width" : ""}`}
        key={key}
      >
        <label htmlFor={`member-${key}`}>{label} (opcional)</label>
        <input
          id={`member-${key}`}
          name={key}
          type={type}
          defaultValue={initial?.[key] ?? ""}
          enterKeyHint="next"
          max={type === "date" ? "9999-12-31" : undefined}
          min={type === "date" ? "0001-01-01" : undefined}
          maxLength={
            key in memberTextLimits
              ? memberTextLimits[key as keyof typeof memberTextLimits]
              : undefined
          }
          aria-invalid={Boolean(errors[key])}
          aria-describedby={
            errors[key]
              ? `error-${key}`
              : key === "churchRole"
                ? "role-hint"
                : undefined
          }
        />
        {errors[key] && (
          <p id={`error-${key}`} className="field-error">
            {errors[key]}
          </p>
        )}
        {key === "churchRole" && (
          <p className="hint" id="role-hint">
            A função não concede acesso administrativo.
          </p>
        )}
      </div>
    );
  }
  return (
    <form
      ref={formRef}
      className="member-form"
      aria-label={initial ? "Editar membro" : "Cadastrar membro"}
      data-dirty={draft.dirty}
      onChange={draft.change}
      noValidate
      onSubmit={(event) => void handle(event)}
      onKeyDown={(event) => {
        // Somente Enter em inputs de uma linha. Botões, selects, Tab e composição IME preservados.
        if (
          event.key !== "Enter" ||
          event.nativeEvent.isComposing ||
          !(event.target instanceof HTMLInputElement)
        )
          return;
        event.preventDefault();
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "input, select, button",
          ),
        );
        controls[controls.indexOf(event.target) + 1]?.focus();
      }}
    >
      {/* O primeiro submit desabilitado impede a submissão implícita nativa,
          inclusive quando o teclado virtual não emite keydown. A confirmação
          real continua sendo um botão submit acessível e identificado. */}
      <button type="submit" hidden disabled tabIndex={-1} aria-hidden="true" />
      <p className="form-description">
        {initial
          ? "Atualize os dados cadastrais. Igreja e situação são mantidas neste fluxo."
          : "Nome, igreja e situação são obrigatórios. Preencha os demais dados apenas quando conhecidos."}
      </p>
      <fieldset disabled={busy} className="surface form-section">
        <legend>Identificação</legend>
        <p className="hint">Os dados essenciais para reconhecer esta pessoa.</p>
        <div className="form-grid">
          <div className="field full-width">
            <label htmlFor="member-name">Nome (obrigatório)</label>
            <input
              id="member-name"
              name="name"
              required
              maxLength={160}
              defaultValue={initial?.name ?? ""}
              autoComplete="name"
              enterKeyHint="next"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "error-name" : undefined}
            />
            {errors.name && (
              <p id="error-name" className="field-error">
                {errors.name}
              </p>
            )}
          </div>
          {!initial && (
            <>
              <div className="field">
                <label htmlFor="member-church">Igreja (obrigatória)</label>
                <select
                  id="member-church"
                  name="churchId"
                  required
                  defaultValue={churches.length === 1 ? churches[0]!.id : ""}
                  aria-invalid={Boolean(errors.churchId)}
                  aria-describedby={
                    errors.churchId ? "error-churchId" : undefined
                  }
                >
                  <option value="">Selecione uma igreja</option>
                  {churches.map((church) => (
                    <option key={church.id} value={church.id}>
                      {church.nome}
                    </option>
                  ))}
                </select>
                {errors.churchId && (
                  <p id="error-churchId" className="field-error">
                    {errors.churchId}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="member-status">Situação (obrigatória)</label>
                <select
                  id="member-status"
                  name="status"
                  required
                  defaultValue="Ativo"
                >
                  <option>Ativo</option>
                  <option>Inativo</option>
                </select>
              </div>
            </>
          )}
          {field("birthDate")}
          {field("churchRole")}
        </div>
      </fieldset>
      <fieldset disabled={busy} className="surface form-section">
        <legend>Contato</legend>
        <p className="hint">
          Contatos são opcionais e não criam uma conta de acesso.
        </p>
        <div className="form-grid">
          {field("phone")}
          {field("email")}
          {field("address")}
        </div>
      </fieldset>
      <fieldset disabled={busy} className="surface form-section">
        <legend>Datas conhecidas</legend>
        <p className="hint">
          Deixe em branco quando a informação não estiver disponível.
        </p>
        <div className="form-grid">
          {field("joinedOn")}
          {field("baptismDate")}
        </div>
      </fieldset>
      {Object.keys(errors).length > 0 && (
        <p className="sr-only" role="alert">
          Confira os campos indicados antes de salvar.
        </p>
      )}
      <div className="form-actions surface">
        <p className="hint">
          Confira os dados e selecione{" "}
          {initial ? "Salvar alterações" : "Salvar membro"} para confirmar.
        </p>
        <button ref={saveRef} className="primary" type="submit" disabled={busy}>
          {busy ? "Salvando…" : initial ? "Salvar alterações" : "Salvar membro"}
        </button>
      </div>
    </form>
  );
}
