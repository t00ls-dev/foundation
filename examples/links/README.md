# Links

Links é a aplicação de referência do Foundation: uma biblioteca **privada** de
bookmarks com React SPA, Hono, Better Auth, Drizzle e Cloudflare D1 no mesmo
Worker. O exemplo está em `examples/links`, com package
`@t00ls-dev/example-links`. O preset autônomo `basic-d1` permanece independente.

## Shared visual foundation

`src/client/styles.css` defines the Links visual tokens (colors, spacing,
typography, borders, radii, container widths and touch targets). The existing
pages share these defaults without a UI library or changes to their flows.

- Layout: `.container`, `.container--narrow`, `.stack` and `.cluster`; flex/grid
  children can shrink and long content wraps instead of being clipped.
- Buttons: `.button`, `.button--secondary`, `.button--quiet` and
  `.button--danger`; native buttons default to primary, and `.secondary` remains
  a compatible alias. Use native `disabled` for disabled buttons. Google keeps
  its provider-specific branding and shares the minimum 44px touch target.
- Surfaces: `.card`; forms, articles and empty states use the same surface,
  border and responsive padding.
- Feedback: `.alert`, `.alert--error` and `.alert--success`. Apply the correct
  semantic role in markup: `alert` for errors, `status` for non-urgent updates.
  `AsyncForm` exposes `data-kind` for its existing error/success feedback; field
  errors remain associated with their inputs.
- Controls use 16px text at the default font size, visible invalid borders and a
  shared keyboard focus ring. High-contrast mode preserves control borders and
  focus. No animation is required to communicate a state.

The foundation is mobile-first. Reflow tests cover 320px through desktop,
reduced CSS viewport widths for zoom, 200% CSS scale/text enlargement and long
content. These checks do not emulate a browser's toolbar zoom UI.

## Cross-page form and action spacing

Home/Auth/Account/Reset reuse the existing spacing and action groups. Field
labels, hints and errors stay grouped separately from submit; Verification and
invalid-reset backlinks share the 44px navigation targets. Intro/action gaps are
explicit, Account's stack owns its title gap and Verification success uses the
existing success variant. These opt-in rules leave header/Bookmarks and
functional validation/state handling unchanged.

## Bookmarks and compact navigation

The shared header keeps all navigation/actions visible: compact two-row mobile
layout, one-row desktop layout, 44px targets and active-route semantics. Long
account names use a single-line ellipsis with the full name retained in text and
the title attribute; Account still displays/edits the complete name.

The library consistently uses **Add bookmark**. Search/tag rows keep labels,
Search and Clear filters visible, wrapping controls when text grows. Bookmark
cards preserve full titles, URLs, descriptions and tags with safe wrapping;
Edit/Delete remain explicit actions. The editor uses stacked mobile fields and
wide actions, with two-column Title/URL on larger screens. These changes are
presentation only: CRUD, validation, filters, pagination and navigation are
unchanged.

## Desenvolvimento local

Requer Node.js >=22.22.0 e pnpm do workspace.

1. Na raiz, execute `pnpm install --frozen-lockfile` e `pnpm build` para
   compilar também as dependências Foundation.
2. Neste diretório, copie `.dev.vars.example` para `.dev.vars`; use um secret
   aleatório de pelo menos 32 caracteres e credenciais Resend de
   desenvolvimento.
3. Execute `pnpm db:migrate:local` e `pnpm dev`.
4. Abra a origem informada pelo servidor. `BASE_URL` deve corresponder
   exatamente à origem usada, incluindo host e porta. Não misture `localhost` e
   `127.0.0.1`.
5. Cadastre-se, abra o link de verificação recebido por e-mail e faça login.

O script `dev` compila a aplicação e inicia Wrangler. Para desenvolvimento com
HMR, `pnpm exec vite --host localhost --port 5173` usa o plugin Cloudflare;
configure `BASE_URL=http://localhost:5173` e aplique migrations primeiro.

Verificação de e-mail é obrigatória. Magic link e recuperação/redefinição
existentes continuam disponíveis como opções secundárias. Sessões são cookies
Better Auth `HttpOnly`, `SameSite=Lax`, seguros em HTTPS, persistidos em D1;
nenhum token é armazenado em `localStorage`. Os defaults atuais são sete dias de
validade e renovação após um dia. O servidor encaminha todos os `Set-Cookie` de
`@t00ls-dev/auth.resolveSession`, inclusive limpeza de sessão expirada.

Logout só é confirmado após verificar a revogação em D1, sem renovar a sessão.
Falha ou confirmação indisponível retorna `503` e preserva o cookie para retry.
Logs auth contêm apenas eventos estáticos sanitizados. No cliente, cada operação
privada pertence a uma geração de sessão; respostas de gerações anteriores não
podem expirar a nova identidade nem disparar navegação ou atualização de estado.

## Funcionalidades e API

### Home and navigation

`/` is the public Foundation/Links Home for signed-in and signed-out visitors;
it does not load bookmarks and remains available while session resolution is
pending or unavailable. **Open Links** leads to the private `/bookmarks`
library. The header links to Home and Bookmarks, with Sign in/Create account for
visitors or Account/Sign out for the current user.

`/bookmarks`, `/bookmarks/new`, `/bookmarks/:id/edit` and `/account` remain
protected. Sign-in defaults to `/bookmarks`; private deep links retain a
validated `next` destination across password sign-in, signup/verification, Magic
Link and Google callbacks. Only known local private routes are accepted;
external or unsupported targets fall back to `/bookmarks`. Saving/canceling an
editor and returning from Security also lead to `/bookmarks`.

Session expiry removes private content and directs visitors to sign-in with a
generic explanation. Voluntary logout from a private page goes to sign-in;
logout on public pages retains the current page. Unknown routes go to Home for
visitors and Bookmarks for signed-in users. Password-management session
semantics remain unchanged.

- criação, leitura, edição e exclusão de bookmarks;
- título, URL HTTP/HTTPS, descrição opcional e tags;
- busca por título/URL/descrição e filtro exato por tag, combinados por `AND`;
- paginação `limit`/`offset`, ordenação estável por criação e ID descendentes;
- estados de sessão/listagem/envio, vazio, erro e retry;
- UI responsiva com labels, erros associados e foco de campo inválido.

### Google opcional

Sign in e Create account mostram **Continue with Google** somente quando
`GET /api/config` retorna `{ "googleEnabled": true }`. O contrato público contém
somente esse booleano, usa `private, no-store` e não consulta D1. Não existe
flag Vite nem configuração Google no browser.

Um único resolver server-side decide a configuração do Better Auth e a
capability:

- ambas as credenciais ausentes/vazias/whitespace: Google desabilitado, `false`;
- `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` presentes: Google habilitado,
  `true`;
- apenas uma presente: configuração inválida, auth/config retornam `503` com
  `AUTH_CONFIGURATION_INVALID` e mensagem fixa, sem revelar a credencial.

`/health` continua diagnosticando Worker/D1 independentemente de Google. O botão
usa `authClient.signIn.social`, redirects e state do Better Auth 1.7.7, sem GIS
SDK. O logo local e o estilo claro vêm do
[configurador oficial Google](https://developers.google.com/identity/branding-guidelines);
usa fallback Arial/Roboto local, sem download de fonte. O Client Secret
permanece no servidor; o Client ID aparece apenas na URL pública de autorização
Google.

Registre no Google Console o callback exato
`${BASE_URL}/api/auth/callback/google`; em DEV:
`https://foundation.t00ls.dev/api/auth/callback/google`. Sucesso retorna para
`/bookmarks` (ou o deep link privado validado) e a sessão normal do Links.
Cancelamento com state válido retorna para `/login?oauth=failed`; a UI mostra
mensagens fixas e ignora `error_description`. State ausente/inválido preserva a
página de erro padrão do Better Auth em `/api/auth/error`, sem interceptação
própria. Clique duplo é bloqueado; erro permite retry e Back/bfcache libera
pending e recarrega a capability.

The shared `OAuthButton` receives provider presentation (label, icon and
branding class) separately from initiation/capability logic. Google is the only
provider. While initiating sign-in, the button is disabled, replaces its
decorative icon with a same-size spinner and keeps **Continue with Google**
unchanged. There is no redirect success/status message below the button. A
pre-navigation failure restores the icon and enabled state and shows the
existing sanitized error. The button exposes `aria-busy`; reduced-motion
preferences disable rotation.

Os testes locais verificam configuração, D1, início/cancelamento e UI simulada;
não equivalem a OAuth Google real. Após eventual merge/deploy automático,
validar em DEV: botão em login/signup, consentimento Google e callback real,
identidade e biblioteca, reload, cookies HTTPS e logout/revogação; repetir com
conta Google existente e nova, cancelar e tentar novamente. Revalidar os fluxos
email/password, verificação, Magic Link e reset já existentes. Nenhum smoke
remoto é disparado pelos testes da UI.

### Account Settings

Account also provides the password-only authenticator flow: password → local
QR/setup key → six-digit confirmation, with password-based disable. Password
sign-in with `twoFactorRedirect` moves to `/two-factor` before any
completed-login navigation. Magic Link and Google remain alternatives without a
Links TOTP challenge; this is not account-wide MFA. See
[TOTP flows and recovery](../../docs/runbooks/links-totp.md).

`/account` is the canonical authenticated page. The legacy `/account/security`
URL redirects to it, preserving query/fragment and authentication return paths.
The Account section always provides an editable Name with explicit **Save
name**; Email is informational text, never a disabled input. Names are trimmed,
required, limited to 200 characters and cannot contain control characters.
International names and punctuation are allowed. Shared validation also guards
the example's official `/api/auth/update-user` request before delegating to
Better Auth.

Name updates use public `authClient.updateUser({ name })` in Better Auth 1.7.7,
which updates the current user/cookie without rotating or revoking sessions and
notifies session listeners. The UI confirms the user/name/email through public
`getSession` with cookie cache disabled, then refetches the displayed session.
Unexpected failure is indeterminate, with no automatic retry. Requests are
aborted on logout/unmount and obsolete feedback cannot affect another account.

### Password reset UX

Before showing password fields, ResetPassword checks the public Better Auth GET
`/api/auth/reset-password/:token` with a fixed `/reset-password` callback. Fetch
follows redirects in same-origin/no-store mode with an AbortSignal; the final
response must be a redirected 200 on this origin and exact callback path, with
only the matching token or `error=INVALID_TOKEN`. Unexpected responses or
network failures offer verification retry, never imply token invalidity.

The real Worker/Assets harness verifies that this fetch neither navigates nor
executes the SPA and does not consume the token. The official `resetPassword`
POST remains authoritative. Late INVALID_TOKEN removes password fields and
offers a new link. Indeterminate mutation errors clear fields without automatic
retry or raw upstream messages. Tokens are not logged or stored outside the
existing URL/in-memory flow. Requests are aborted on unmount/token changes.

Reset navigation uses the central App session: authenticated visitors get **Back
to Account**, confirmed visitors **Back to sign in**; unresolved/error sessions
remain in the existing session loading/retry UI. Reset retains the existing
session policy. Account's accepted email-link request says **Password link
requested. Check your account email.**; public Forgot stays anti-enumeration.

### Security — senha da conta

O link **Account** do header autenticado abre `/account`, com a seção Security
preservada abaixo de Account. `GET /api/account/security` exige sessão e retorna
somente `{ "hasPassword": boolean }`, com `private, no-store`. Não aceita
parâmetros de query ou identidade do cliente. A consulta usa o usuário da sessão
e a chave credential (`userId`, `providerId=credential`, `accountId=user.id`);
verifica senha não vazia no banco sem carregar/retornar hash ou metadata de
accounts. Erro de consulta é erro/retry, nunca `false`.

Com senha, a tela pede senha atual, nova e confirmação e usa exclusivamente
`authClient.changePassword` com `revokeOtherSessions: true`. Better Auth revoga
as sessões antigas, inclusive a atual, e entrega uma substituta por cookie. O
Links invalida a geração de requests privados, resolve a nova sessão e permanece
autenticado. Campos sensíveis são limpos em sucesso. Senha atual incorreta tem
mensagem fixa recuperável.

Falha inesperada pode ocorrer depois de a senha já mudar e antes/depois da
revogação. A UI não faz retry automático nem afirma que nada mudou: informa que
a conclusão não pôde ser confirmada e orienta novo login/reset. Campos sensíveis
são limpos nesse estado indeterminado.

Sem senha (por exemplo, identidade Magic Link/Google), a tela solicita o reset
oficial para o email da sessão; o link recebido estabelece a primeira senha. Não
há `setPassword` ou endpoint customizado de escrita. A resposta de envio
continua genérica. **Reset/primeira senha não revoga sessões existentes na
política atual**; este incremento não altera essa configuração global.

Signup, reset e troca exigem confirmação apenas no frontend: senha nova entre 8
e 128 caracteres, confirmação exatamente igual, sem trim/normalização. Senha
atual é somente obrigatória na validação local. `confirmPassword` nunca integra
payload Better Auth; login/Magic Link/forgot não exigem confirmação. Name
continua obrigatório no signup. Nenhuma senha/token é armazenado em browser
storage ou log.

### Bookmarks

| Método | Rota                                       | Resultado                    |
| ------ | ------------------------------------------ | ---------------------------- |
| GET    | `/api/bookmarks?q=&tag=&limit=20&offset=0` | `{ items, hasMore }`         |
| POST   | `/api/bookmarks`                           | Bookmark criado, `201`       |
| GET    | `/api/bookmarks/:id`                       | Bookmark ou `404`            |
| PATCH  | `/api/bookmarks/:id`                       | Bookmark atualizado ou `404` |
| DELETE | `/api/bookmarks/:id`                       | `204` ou `404`               |

Payload de criação:

```json
{
  "title": "Foundation",
  "url": "https://example.com",
  "description": null,
  "tags": ["docs", "work"]
}
```

Descrição e tags podem ser omitidas na criação, com defaults `null` e `[]`.
PATCH aceita qualquer subconjunto não vazio e preserva os campos omitidos.
Limites: título 200, URL 2.048, descrição 2.000 caracteres; até 10 tags de 40
caracteres. Tags são normalizadas com trim/minúsculas e deduplicadas. Vírgulas
em cada tag são rejeitadas porque a UI usa vírgula como separador. Não há
catálogo global de tags: são um array JSON do bookmark. URLs duplicadas são
permitidas.

Busca trata `%`, `_` e barra invertida como texto literal. É busca simples do
SQLite, sem FTS nem promessa de normalização linguística de acentos/case
Unicode. `limit` varia de 1 a 100; `offset` de 0 a 1.000.000. A UI usa páginas
de 20. Edições concorrentes seguem a política de última escrita vence.

### Isolamento e limites dos packages

Toda query, filtro e mutação usa o `user.id` da sessão validada no servidor. Não
há propriedade editável no payload. Acesso a bookmark de outro usuário retorna o
mesmo `404` de um ID inexistente; ausência de sessão retorna `401`. Mutações por
cookie exigem `Origin` compatível com `BASE_URL` pelo helper CSRF do Foundation.
As rotas auth preservam as proteções próprias do Better Auth.

`src/server` compõe auth, sessão, handlers e repository;
`src/shared/bookmarks.ts` contém contratos Zod seguros para consumo no
navegador. A aplicação consome `@t00ls-dev/auth`, `@t00ls-dev/db/d1`,
`@t00ls-dev/email` e `@t00ls-dev/security`; somente o domínio de bookmarks
pertence ao exemplo.

Não inclui tenancy/RBAC, TOTP/2FA, recovery codes, preferências/unsubscribe,
novos templates ou analytics. Identidade/e-mail permanecem separados dos
bookmarks para futuras evoluções. O template autônomo `create-app basic-d1`
permanece um starter técnico mínimo, sem copiar o domínio Links.

## Migrations

`src/schema.ts` é a fonte de `pnpm db:generate`. Revise SQL, snapshot e journal
antes de aplicar. O histórico inclui `0001_better_auth.sql` e a migration
aditiva `0002_links.sql`, que cria somente `bookmark`, FK em cascata, índice por
usuário e constraint de array JSON. O histórico auth e o snapshot anterior são
preservados. Os índices de snapshots/journal são independentes do prefixo
histórico dos SQL; Drizzle pode gerar um próximo prefixo que precise ser
ajustado antes da primeira aplicação, sem renomear migrations já aplicadas.

`db:migrate` e `db:status` usam D1 local; variantes `:dev` operam remotamente.
`db:seed` executa apenas `seeds/local.sql`, atualmente sem dados de contas, e
nunca faz parte do deploy. Migrations aplicadas são imutáveis e recebem
correções forward-only. A adição permite rollback do código anterior sem remover
tabelas.

## Testes determinísticos

Depois de compilar os packages Foundation:

```bash
pnpm test
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

- Unitários: validação, protocolos de URL, normalização, limites e respostas de
  gerações de sessão obsoletas.
- Integração: Miniflare/D1 real local, migrations reais, auth, CRUD, dois
  usuários, filtros/paginação, CSRF, expiração/revogação, cookies e headers
  privados, falhas de revogação/confirmação e sanitização de logs de execução.
- E2E: nove cenários em Chromium desktop e mobile, totalizando 18 execuções;
  cadastro/verificação/login/logout, CRUD, reload, isolamento, erros/loading,
  sessão expirada e respostas privadas atrasadas após troca de usuário,
  incluindo um `401` de mutação de A liberado somente depois do login de B pela
  SPA.

Nenhum teste envia e-mails reais. Integração injeta um provider capturador. E2E
usa `e2e/worker.ts` com caixa de e-mail no D1 **temporário**, configuração
própria e porta 5174. O harness aplica o histórico duas vezes para validar o
journal Wrangler, inicia Vite e remove o estado ao encerrar. Não reutiliza o
banco local, não usa segredos DEV e não habilita remote bindings. O endpoint
`/__test/mail` existe somente no entrypoint de teste, nunca no Worker de
`src/worker.ts`.

Na raiz, o gate completo é `pnpm check`, incluindo distribuição e release.

## DEV e validação operacional

O DEV remoto mantém `foundation.t00ls.dev` e o D1 `basic-d1-dev`. Segredos são
configurados com `wrangler secret put --env dev`; `BASE_URL`/`EMAIL_FROM` estão
em `env.dev.vars`. A CI validada em `master` precede migration, deploy e smoke
health.

`GET /health` verifica Worker/D1, retorna `503` sanitizado em falha e
`no-store`. Auth e APIs privadas enviam `private, no-store` e
`Vary: Cookie, Authorization`. Configure o bypass de cache para `/api` e demais
caminhos documentados em `docs/runbooks/cache.md`; nenhuma resposta privada deve
apresentar cache `HIT`.

Após publicar, validar manualmente com duas contas:

1. cadastro, entrega/verificação de e-mail e login;
2. CRUD, busca/tag e persistência após reload;
3. segunda conta sem acesso à biblioteca/IDs da primeira;
4. logout e acesso privado bloqueado;
5. health e headers/cache no domínio real.

Esse smoke funcional remoto depende de publicação após merge; `/health` sozinho
não comprova os fluxos de usuário. Google OAuth continua opcional mediante os
dois secrets existentes.
