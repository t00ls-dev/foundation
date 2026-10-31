# `@t00ls-dev/auth`

Referência atual: dependência Better Auth `^1.7.12`. As validações descritas
abaixo em 1.7.7 são históricas e não representam reteste automático da versão
atual. `setInitialPassword` é uma operação server-only para primeira senha,
sujeita às guardas do consumidor.

## Primeira senha após confirmação

`setInitialPassword(headers, newPassword)` é uma operação somente de servidor.
Ela consulta a sessão persistida sem renovação/cache, exige e-mail verificado e
usa `auth.api.setPassword` do Better Auth. O wrapper exige sessão recente
conforme `freshAge` do Better Auth; a biblioteca valida e armazena a senha e
recusa sobrescrever credencial existente. O consumidor deve proteger seu
endpoint com CSRF e limitar tentativas; nenhum endpoint público `set-password` é
adicionado ao handler. O Levi usa essa operação após Magic Link, sem enviar
outro e-mail. Links de reset antigos continuam no caminho legado.

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
público reutiliza `verifyTurnstile` de `@t00ls-dev/security` como único
transporte Siteverify, mantendo rate limiting Better Auth antes da validação.
Token vai em `x-captcha-response`; não há novos endpoints/APIs de auth expostos.

`MISSING_RESPONSE`/400 e `VERIFICATION_FAILED`/403 mantêm os códigos existentes.
Somente falha conhecida do hook pré-auth retorna `TURNSTILE_UNAVAILABLE`/503;
falha posterior conserva o tratamento auth indeterminado existente. Sem retries
próprios.

A prova só é aceita quando `success === true`, hostname autorizado e action
esperada correspondem exatamente. Strings, números, nulo, campo ausente, arrays
e tipos inválidos dos metadados conhecidos são rejeitados. Campos adicionais
desconhecidos não alteram a decisão. Timeout de 10 segundos cobre transporte e
leitura do corpo; rede, HTTP de erro e resultado nulo permanecem indisponíveis,
sem liberar auth. JSON inválido retorna rejeição de verificação. A integração
não usa o provider CAPTCHA nativo, que aceita `success` truthy, nem valida o
token duas vezes. Better Auth continua responsável por autenticação, sessões e
resolução de IP pelo contrato público `getIP`. Nenhuma API pública Foundation
mudou.

Configuração opinativa do Better Auth para senha, verificação de e-mail,
recuperação, magic link e Google OAuth opcional.

## Quando usar

Use em aplicações Foundation que possam fornecer banco e envio de e-mail
compatíveis. Não use quando precisar controlar diretamente plugins, textos,
callbacks ou outras opções do Better Auth.

## Instalação

Consumo interno no monorepo com `workspace:*`. Compile os pacotes locais com
`pnpm build` antes de usar seus exports.

```sh
pnpm --filter <app> add '@t00ls-dev/auth@workspace:*'
```

## API

- `createFoundationAuth(options)`: cria
  `{ handler(request), resolveSession(headers), setInitialPassword(...) }`.
- `resolveSession(headers)`: retorna `{ data, headers }`. `data` é uma
  `FoundationSession` tipada (`user` e `session`) ou `null`. Falhas de banco não
  são convertidas em sessão anônima. Encaminhe os headers retornados, incluindo
  cada `Set-Cookie`, para preservar renovação e limpeza de cookies.
- `FoundationAuthOptions`: exige `baseURL`, adaptador `database`, `email` e
  `secret`; aceita credenciais `google`, `totp`, `rateLimit`, `turnstile` e
  `generateId: "uuid"` opt-in.
- `FoundationEmail`: contrato mínimo de envio usado pelos fluxos de
  autenticação.

### IDs UUID opt-in

`generateId: "uuid"` encaminha a opção nativa `advanced.database.generateId` do
Better Auth (validada na versão 1.7.7). Sem a opção, o wrapper não configura a
geração de IDs e preserva o comportamento atual. Não há gerador paralelo nem
geração no cliente.

```ts
const auth = createFoundationAuth({
  baseURL,
  database,
  email,
  secret,
  generateId: "uuid",
});
```

A opção é global para os IDs dos registros gerenciados pelo Better Auth:
usuários, sessões, contas, verificações e modelos de plugins que usam o gerador
nativo (incluindo `twoFactor`). Referências como `userId` acompanham o ID do
usuário. Não converte `accountId` de providers OAuth, tokens de sessão,
access/refresh tokens, valores de verificação, segredos TOTP ou IDs de domínio,
tenants e memberships. Esses campos conservam suas próprias semânticas e não
devem ser convertidos indiscriminadamente para colunas UUID.

Com Drizzle/PostgreSQL, o adapter 1.7.7 declara suporte nativo e delega a
geração ao banco. As chaves primárias exigem defaults como
`uuid("id").defaultRandom().primaryKey()` /
`id uuid PRIMARY KEY DEFAULT gen_random_uuid()`; referências ao usuário devem
ter tipo compatível (`uuid`). Tokens, `accountId`, `providerId`, `identifier` e
`value` continuam textuais. Somente mudar a opção sem preparar o schema pode
causar falhas de inserção. Com adapters sem geração UUID nativa, Better Auth usa
`crypto.randomUUID()` no servidor; em D1, UUIDs são strings em colunas `text`.

O schema e as migrations pertencem à aplicação. A opção não converte registros
existentes nem permite migrar automaticamente IDs textuais para UUID. Planeje a
compatibilidade dos dados e das referências antes de habilitá-la em um banco
existente, conforme o
[runbook de migrations](../../docs/runbooks/migrations.md).

### TOTP opt-in

`totp: { issuer: "Minha aplicação", enrollmentEnabled: false }` instala o plugin
público twoFactor, alinha appName/issuer, exige senha e confirmação para
habilitar TOTP de seis dígitos/30 segundos. Sem a opção, consumidores mantêm seu
comportamento anterior. `twoFactorEnabled` é opcional no tipo público de sessão;
estado deve ser obtido por sessão autoritativa, não pelo body de confirmação
(que pode conter o snapshot anterior). Não há exposição da instância, contexto
ou APIs server-side do Better Auth, incluindo geração/visualização de backup
codes.

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
