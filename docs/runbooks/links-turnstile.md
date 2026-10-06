# Turnstile V1 no Links

## Escopo e opt-in

Better Auth **1.7.7**, sem patch/fork/upgrade, é o único responsável por
Siteverify. `@t00ls-dev/auth` recebe uma opção `turnstile`; ausente mantém o
comportamento anterior. Links aplica proteção somente aos POSTs abaixo,
independentemente de cookies:

| Endpoint sem `/api/auth`  | Action                 |
| ------------------------- | ---------------------- |
| `/sign-in/email`          | `links-sign-in`        |
| `/sign-up/email`          | `links-sign-up`        |
| `/sign-in/magic-link`     | `links-magic-link`     |
| `/request-password-reset` | `links-password-reset` |

Um hook público pequeno seleciona a configuração imutável e delega ao plugin
oficial `captcha`. Há somente uma chamada Siteverify por tentativa enviada; sem
verificador customizado, proxy de validação ou segunda chamada. Limiter, storage
D1 e IP confiável `cf-connecting-ip` permanecem os mesmos e são processados
antes do hook. Hostname e action são conferidos pelo plugin nativo.

Google OAuth/callbacks, TOTP, verificação de email, consumo de Magic Link,
aplicação de reset, logout e ações autenticadas não recebem Turnstile. Isso não
altera a política password-only TOTP nem cria MFA local para Google/Magic Link.

## Configuração DEV/local

- `TURNSTILE_SITE_KEY`: público; configurar em vars do Worker/Wrangler.
- `TURNSTILE_SECRET_KEY`: secret somente server-side, separado por ambiente.
- A allowlist server-side usa o hostname de `BASE_URL`; DEV é
  `foundation.t00ls.dev`.
- Ambos ausentes: opt-out. Somente um presente: capability `unavailable` e 503
  nos quatro POSTs protegidos, sem bloquear endpoints excluídos. Não há bypass
  silencioso.
- `/api/config` informa Google e estado Turnstile (`disabled`, `unavailable` ou
  `enabled` + site key). Não consulta auth/D1, não expõe secret e usa no-store.

Nenhuma chave real foi configurada nesta PR. Para ativar DEV, provisionar um
widget com hostname DEV, declarar sua site key nas vars versionadas apropriadas
e instalar o secret por operação autorizada separada. Não reutilizar chaves de
produção/local; usar chaves oficiais de teste no smoke local autorizado. O
Foundation não possui PROD. Merge/deploy automático e smoke remoto exigem
coordenação posterior; não fazer deploy/release/publicação ou manipular Version
Packages para validar este recurso.

`foundationSecurityHeaders({ turnstile: true })` permite somente script/frame em
`https://challenges.cloudflare.com`. Defaults continuam self-only; connect-src,
CSRF, cookies, framing da aplicação e demais headers não são relaxados. O client
usa SDK oficial com render explícito, theme light e tamanho conforme o
formulário; não usa pre-clearance ou serviço externo de validação client-side.

## Falhas e limitação aceita

Ausência de token: 400 `MISSING_RESPONSE`, sem Siteverify. Rejeição, expiração,
reuso ou metadados divergentes: 403 `VERIFICATION_FAILED`. Tokens Cloudflare são
de uso único e expiram em 300 segundos; o plugin pode agrupar causas de
rejeição. Timeout nativo (10s), rede, 5xx remoto ou resultado nulo devolvem erro
nativo 500: somente essa rejeição direta do hook é convertida para 503
`TURNSTILE_UNAVAILABLE`, com mensagem fixa e sem mutation. O client a trata
antes da regra genérica de 5xx. Falhas posteriores de auth continuam
`AUTH_STATE_INDETERMINATE`/`AUTH_FAILURE`, com a reconciliação atual; rede
perdida do browser não prova ausência de efeitos.

**Limitação explicitamente aceita para V1:** o provider nativo usa truthiness de
`success`, não boolean estrito. Com hostname/action corretos, `success: "false"`
ou `success: 1` podem ser aceitos. Não alegamos fail-closed para payload
upstream arbitrariamente malformado. JSON inválido/missing success pode virar
403 e não ser distinguido de token inválido. Os testes registram o comportamento
real, sem modificar o provider ou acrescentar um segundo verificador.

Sem retry automático de mutations/verificação. Depois de cada request enviado,
descartar token e renderizar uma nova instância; tentativa inválida local não o
consome. Expiração, erro, navegação, bfcache, mudança de tamanho ou identidade
descartam a instância/token. Retry é explícito e nunca submete automaticamente.
Token fica em memória transitória e é enviado somente em `x-captcha-response`;
sem campo hidden, storage, URL, logs ou toast. Logs auth emitem eventos fixos,
sem detalhes upstream, secret ou payload. Google continua disponível
separadamente.

## Password settings e UI

Account passwordless encaminha **Set a password by email** para
`/forgot-password`. Não solicita email automaticamente nem cria exceção por
sessão. O formulário público pode pré-preencher o email da sessão já disponível,
sem consulta nova ou significado de autorização. Mesmo endpoint/redirect/prova
por email, política de sessões e preservação de TOTP. Aplicação do reset
continua sem Turnstile adicional.

O widget fica centralizado antes da ação principal. Títulos/labels/hierarquia
substituem copy técnica/redundante; feedback inexistente não reserva espaço.
Sign in → or → Google usa espaçamento compacto; Google ocupa a mesma largura e
alinhamento da ação primária, mantendo branding. A densidade pública é opt-in,
sem alterar os campos de Account/TOTP. Falha da capability compartilhada exibe
uma mensagem/retry contextual, sem presumir que Turnstile está desativado.

## Validação

Tests auth exercitam o handler público e Siteverify mockado, incluindo limitação
truthy, actions, ausência/rejeição, timeout/rede/protocolo, logs, cookies e
limiter. Integração aplica migrations reais em D1 descartável e distingue falha
pré-auth de erro de execução posterior. E2E usa fixture de SDK/Siteverify
somente no harness `e2e/worker.ts`, fora do bundle de produção;
trace/video/screenshot desses casos ficam desligados. Não há flag de
bypass/configuração de teste em produção. Fixtures determinísticas não
substituem smoke real do SDK/provider em DEV.
