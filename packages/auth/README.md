# `@t00ls-dev/auth`

## Turnstile opt-in

`createFoundationAuth` aceita
`turnstile: { secretKey, allowedHostnames, actions? }`. `actions` tem as chaves
`signIn`, `signUp`, `magicLink`, `passwordReset`; omitido usa os nomes
`sign-in`, `sign-up`, `magic-link`, `password-reset`. Configuração ausente
mantém consumidores anteriores. `{ unavailable: true }` representa um opt-in com
configuração incompleta e bloqueia somente os quatro POSTs públicos com 503.

São protegidos `/sign-in/email`, `/sign-up/email`, `/sign-in/magic-link` e
`/request-password-reset`, sem exceção por sessão. Google/TOTP/ações
autenticadas, callbacks e aplicação do reset não recebem CAPTCHA. Um hook
público delega uma única vez ao plugin oficial Better Auth, mantendo rate
limiting antes da validação. Token vai em `x-captcha-response`; não há novos
endpoints/APIs de auth expostos.

`MISSING_RESPONSE`/400 e `VERIFICATION_FAILED`/403 mantêm o contrato nativo.
Somente falha conhecida do hook pré-auth vira `TURNSTILE_UNAVAILABLE`/503; falha
posterior conserva o tratamento auth indeterminado existente. Sem retries
próprios.

Limitação aceita do Better Auth 1.7.7: `success` truthy não booleano pode ser
aceito com hostname/action corretos. Não se promete fail-closed para todo
payload upstream malformado. Sem patch/fork/upgrade ou outro verificador
Siteverify. Veja o [runbook Links](../../docs/runbooks/links-turnstile.md) para
configuração/lifecycle.

Configuração opinativa do Better Auth para senha, verificação de e-mail,
recuperação, magic link e Google OAuth opcional.

## Quando usar

Use em aplicações Foundation que possam fornecer banco e envio de e-mail
compatíveis. Não use quando precisar controlar diretamente plugins, textos,
callbacks ou outras opções do Better Auth.

## Instalação

Pacote privado do workspace; não é publicado em registry.

```sh
pnpm --filter <app> add '@t00ls-dev/auth@workspace:*'
```

## API

- `createFoundationAuth(options)`: cria
  `{ handler(request), resolveSession(headers) }`.
- `resolveSession(headers)`: retorna `{ data, headers }`. `data` é uma
  `FoundationSession` tipada (`user` e `session`) ou `null`. Falhas de banco não
  são convertidas em sessão anônima. Encaminhe os headers retornados, incluindo
  cada `Set-Cookie`, para preservar renovação e limpeza de cookies.
- `FoundationAuthOptions`: exige `baseURL`, adaptador `database`, `email` e
  `secret`; aceita credenciais `google`, `totp` e `rateLimit` opt-in.
- `FoundationEmail`: contrato mínimo de envio usado pelos fluxos de
  autenticação.

### TOTP opt-in

`totp: { issuer: "Links", enrollmentEnabled: false }` instala o plugin público
twoFactor, alinha appName/issuer, exige senha e confirmação para habilitar TOTP
de seis dígitos/30 segundos. Sem a opção, consumidores mantêm seu comportamento
anterior. `twoFactorEnabled` é opcional no tipo público de sessão; estado deve
ser obtido por sessão autoritativa, não pelo body de confirmação (que pode
conter o snapshot anterior). Não há exposição da instância, contexto ou APIs
server-side do Better Auth, incluindo geração/visualização de backup codes.

Enrollment HTTP fica bloqueado por padrão e requer `enrollmentEnabled: true`
somente quando o consumidor estiver pronto para enrollment e challenge de login.
O plugin não aplica desafio TOTP a Magic Link/Google: eles continuam
alternativas. Não há recovery codes, OTP ou trusted devices: gerador de backup
retorna lista vazia, endpoints de backup/OTP são bloqueados e
`trustDevice: true` é rejeitado por hook público antes da operação. Issuer
alternativo no request é rejeitado.

O consumidor deve compor o schema `user.twoFactorEnabled` e `twoFactor`, com
verified, failedVerificationCount e lockedUntil, e suas migrations. O pacote não
aplica migrations nem consulta diretamente tabelas para implementar TOTP.

`rateLimit: { storage: "database", ipAddressHeaders: ["cf-connecting-ip"] }`
seleciona storage do adapter e requer modelo `rateLimit` (key único, count e
lastRequest numérico em milissegundos). `enabled` omitido preserva o default de
produção do Better Auth; testes podem habilitá-lo explicitamente. Configure
somente headers garantidos pelo runtime/proxy confiável, nunca headers
arbitrários encaminhados pelo cliente. Falha do storage não degrada para
memória.

Em operações TOTP e login por senha com opt-in, falhas inesperadas retornam
`500/AUTH_STATE_INDETERMINATE`, sanitizado e sem cookies de sucesso: não
presumir rollback ou repetir mutation automaticamente. Consulte sessão
autoritativa e identidade; o flag sozinho não prova setup confirmado após falha.
Magic Link/Google são caminhos explícitos de recuperação. O comportamento
anterior `AUTH_FAILURE` permanece nos demais endpoints e sem TOTP.

O handler só confirma `POST /api/auth/sign-out` após uma leitura autoritativa
sem renovação nem cache de cookie. Se a exclusão falhar ou não puder ser
confirmada, retorna `503` sanitizado, sem encaminhar os cookies de limpeza da
resposta de sucesso; isso preserva a credencial para uma nova tentativa. Logout
confirmado preserva todos os `Set-Cookie` originais do Better Auth.

Logging usa registros JSON com componente, nível e eventos estáticos (por
exemplo, `auth.internal_error` e `auth.session_revocation_failed`). Mensagens,
erros e argumentos recebidos do Better Auth/Drizzle não são serializados; isso
evita incluir SQL, parâmetros, tokens e links nos logs, inclusive no fallback de
erro HTTP.

## Exemplo

```ts
import { createFoundationAuth } from "@t00ls-dev/auth";

const auth = createFoundationAuth({
  baseURL: "https://app.example.com",
  database,
  email,
  secret: process.env.AUTH_SECRET!,
});

export default { fetch: (request: Request) => auth.handler(request) };
```

## Limitações, segurança e migrações

O pacote não expõe a API completa do Better Auth nem cria rotas. A resolução de
sessão no servidor reutiliza a validação do Better Auth; não interprete cookies
manualmente. E-mails são texto simples e têm assuntos fixos em inglês. Guarde
`secret` e credenciais fora do código, use HTTPS, valide `baseURL` e não
registre links ou tokens. O schema e as migrações exigidos pelo Better Auth
devem ser gerados e aplicados pela aplicação conforme a versão instalada.
