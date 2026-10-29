# Onboarding e provisionamento

Esta primeira fatia implementa uma API local, consumida pela
[interface React de onboarding](interface-onboarding.md). O escopo de produto
continua em [Decisões do MVP](decisoes-mvp.md). Cadastro e consulta de membros
possuem [guia próprio](gestao-membros.md), com habilitação separada. Convites,
administração adicional e infraestrutura de produção continuam pendentes.
A composição e os limites de validação do runtime remoto estão em
[Cloudflare Workers](cloudflare-workers.md).

## Execução local

Requisitos: Node `>=22.22.0`, pnpm `10.15.1` com lockfile único na raiz do monorepo e PostgreSQL 17.
Docker só é necessário para a suíte descartável ou para iniciar o banco local.

```sh
pnpm install --frozen-lockfile
pnpm --filter levi typecheck
pnpm --filter levi test
pnpm --filter levi test:integration
pnpm --filter levi build
pnpm --filter levi test:e2e
pnpm --filter levi format:check
```

A integração cria um container exclusivo, com imagem PostgreSQL fixada por digest,
porta aleatória somente em loopback e credenciais sintéticas. Aplica explicitamente
`migrations/` duas vezes para validar o journal, executa os testes e remove o
container em `finally`. Não utiliza `LEVI_DATABASE_URL` externo. Se Docker falhar,
a suíte falha; não há fallback para mocks ou banco persistente. Uma interrupção
forçada do processo pode exigir remover o container de testes identificado pelo
label `levi.integration=true`.

Para exercitar manualmente, crie um banco local separado, exclusivamente sintético:

```sh
docker run --rm --detach --name levi-local \
  --publish 127.0.0.1:54329:5432 \
  --env POSTGRES_DB=levi_local --env POSTGRES_USER=levi_local \
  --env POSTGRES_PASSWORD=synthetic-only postgres:17-alpine

export LEVI_DATABASE_URL='postgresql://levi_local:synthetic-only@127.0.0.1:54329/levi_local'
export LEVI_LOCAL_DATABASE=1
export LEVI_AUTH_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
pnpm db:migrate
pnpm dev
```

`pnpm dev` inicia Vite em `http://localhost:5173` e a API em
`127.0.0.1:3000`. O proxy preserva cookies e a origem de navegador.
`pnpm --filter levi start` executa o build já produzido e serve SPA/API juntos em
`http://localhost:3000`, com o servidor ligado somente a `127.0.0.1`.
`LEVI_PORT` altera a porta da API; `LEVI_PUBLIC_ORIGIN` permite somente origem HTTP
local e é configurada pelo comando de desenvolvimento. Banco remoto é recusado
pelo executável local e pelo comando de migrations. Não há carregamento automático
de `.env`.

O transporte local grava e-mails em `.local/mail/`, com diretório privado e arquivos
`0600`, sem envio real nem endpoint de consulta da caixa. A API recebe um
`FoundationEmail` por composição; os testes capturam em memória. Os links são
credenciais temporárias e não aparecem nos logs. Remova os arquivos locais após
o exercício. Encerre o banco sintético com `docker stop levi-local`.

Migrations não são importadas pelo servidor. `pnpm db:migrate` é uma ação
explícita e exige `LEVI_LOCAL_DATABASE=1`. `db:generate` apenas gera SQL/snapshot a
partir do schema; não altera banco. A aplicação não verifica/aplica automaticamente
migrations ao iniciar, fazer build ou atualizar dependências. GitHub Actions
valida em bancos descartáveis e publica DEV após CI aprovada, conforme
[Deploy DEV](deploy-dev.md); não aplica migrations persistentes.

## Fluxo e endpoints

Todos os corpos de escrita são JSON e rejeitam campos desconhecidos. Envie
`Origin` igual à origem pública configurada (5173 no desenvolvimento, 3000 no
build local) e preserve os cookies nativos, inclusive cada
`Set-Cookie`. Escritas autenticadas sem origem confiável são recusadas. Respostas
são privadas e não armazenáveis em cache; links não são enviados em `Referer`.

| Método e caminho                      | Entrada e comportamento                                                                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/onboarding/email`          | `{ "email": "pessoa@example.test" }`. Solicita Magic Link pelo handler público do Foundation. Não exige nem aceita senha/nome/ID.                                                                                                                        |
| `GET /api/auth/magic-link/verify`     | Link enviado pelo Better Auth; verifica posse do e-mail e cria sessão. Callback fixado pela composição: `/onboarding` na web local, `/api/onboarding` por padrão na API.                                                                                 |
| `GET /api/session-context`            | Sessão autenticada, inclusive antes do provisionamento: somente `{ userId, sessionId }`, IDs internos sem valor de credencial. Sem sessão válida retorna `401`; a resposta usa `private, no-store` e não aceita IDs do cliente para escolher identidade. |
| `GET /api/onboarding`                 | Etapa autoritativa: `email`, `verificar-email`, `senha`, `organizacao`, `concluido` ou `sem-acesso`. Link inválido/expirado/usado informa erro em português.                                                                                             |
| `POST /api/onboarding/password-email` | Compatibilidade legada: `{}` e sessão verificada. Solicita ao Better Auth o link para senha/recuperação, para o e-mail da própria sessão.                                                                                                                |
| `GET /api/auth/reset-password/:token` | Callback público nativo do link; redireciona à etapa com token. Não define senha.                                                                                                                                                                        |
| `POST /api/onboarding/password`       | `{ "newPassword": "..." }` e sessão verificada recente para a primeira senha. `token` opcional preserva reset legado, associado à sessão e consumido pelo Better Auth.                                                                                   |
| `POST /api/auth/sign-in/email`        | `{ "email": "...", "password": "..." }`. Login nativo de conta existente.                                                                                                                                                                                |
| `POST /api/auth/sign-out`             | `{}`. Logout nativo, com confirmação de revogação pelo Foundation.                                                                                                                                                                                       |
| `POST /api/organizations`             | `{ "organizationName": "Organização", "churchName": "Primeira igreja" }`, sessão pronta e header `Idempotency-Key` de 16–128 caracteres alfanuméricos, `_` ou `-`. Retorna `201` com `organizationId` e `churchId`, também em replay idêntico.           |
| `GET /api/organizations`              | Lista somente organizações com vínculo administrativo atual da conta pronta, para retomar em outra sessão.                                                                                                                                               |
| `POST /api/tenant`                    | `{ "organizationId": "UUID" }`. Valida vínculo administrativo antes de associar a organização à sessão.                                                                                                                                                  |
| `GET /api/context`                    | Organização ativa e role `admin`, após resolver sessão pronta e vínculo atual.                                                                                                                                                                           |
| `GET /api/churches`                   | `{ organizationId, churches: [{ id, nome, address, phone, email }] }`, com o contexto autorizado usado na própria consulta. A interface confere esse ID para evitar associação incorreta se outra aba trocar o tenant.                                   |
| `GET /api/churches/:id`               | Igreja consultada por ID **e** organização ativa autorizada. Outra organização retorna `404`.                                                                                                                                                            |

O provisionamento também aceita `churchAddress` (até 500 caracteres),
`churchPhone` (até 40) e `churchEmail` (até 254, com sintaxe válida), todos opcionais.
Ausência, null e string vazia normalizam para null. Nome da igreja continua sendo
o único campo obrigatório da igreja; não há nova etapa obrigatória. Contatos
participam do hash da tentativa quando preenchidos, preservando o hash anterior
para o contrato somente com nomes. Persistem na mesma transação de provisionamento.
Sua persistência depende de 0004, conforme o [guia Workers](cloudflare-workers.md#incremento-de-interface-e-edição-pendente-de-operação).

Rotas convencionais de signup, mudança de senha/e-mail, plugins e chamadas diretas
de emissão/aplicação de reset não são encaminhadas ao Better Auth. A allowlist é
por método/caminho; uma nova rota upstream não ganha exposição automaticamente.

O cadastro usa um único e-mail: o Magic Link nativo verifica o endereço e
estabelece uma sessão. Sem token de reset no corpo, a rota de senha usa
`setInitialPassword` do wrapper, que exige e-mail verificado e chama `setPassword`
server-only do Better Auth. O wrapper exige sessão recente conforme `freshAge`;
a biblioteca recusa senha já existente.
Não expõe `setPassword` diretamente pelo handler HTTP. Links de reset já emitidos
continuam associados à sessão correspondente, com expiração e consumo nativos.
Uma sessão antiga exige nova confirmação de e-mail antes da primeira senha.

Uma interrupção pode ser retomada consultando `/api/onboarding` ou solicitando novo
Magic Link. Conta existente não é duplicada. Em outro dispositivo é necessário
restabelecer sessão verificada antes de aplicar o link de senha. Não há senha
provisória. O primeiro provisionamento não cria ficha eclesiástica.

A etapa `organizacao` indica conta pronta sem vínculo administrativo e sem
recibo de primeiro provisionamento. Havendo vínculo administrativo atual,
`concluido` permite consultar as organizações autorizadas, inclusive múltiplos
vínculos. Sem vínculo e com recibo da própria conta, `sem-acesso` orienta procurar
o responsável e não oferece outro provisionamento. A leitura é restrita ao ID da
identidade autenticada; o recibo não concede autoridade nem restaura memberships.
A etapa é uma orientação de jornada: todas as operações continuam revalidando
sessão e vínculo, inclusive após mudanças concorrentes.

## Persistência e transação

Aplicação TypeScript estrita em `apps/levi` no workspace pnpm do Foundation. `src/app.ts` compõe Hono e os
contratos; `src/auth.ts` compõe identidade; `src/organizations.ts` contém as regras
de provisionamento/autorização; `src/data/schema.ts` define o schema do consumidor.
`tools/` contém ações explícitas fora da inicialização.

Os pacotes Foundation são consumidos por `workspace:*`, com seus contratos
públicos de autenticação, dados, tenant, auditoria, acesso, segurança e e-mail.
O Node captura e-mails localmente; o Worker usa o adapter Resend público,
com configuração e limites descritos no [guia Workers](cloudflare-workers.md).
Better Auth, Drizzle e Hono são imports diretos, com versões no manifest do Levi
e lockfile da raiz.
`@types/pg` é dependência de desenvolvimento para os tipos públicos do executor;
não há cliente/pool paralelo do Levi.

Cada request usa um Client conectado pela factory assíncrona pública. O Drizzle,
os adapters de tenant e a auditoria usam **essa mesma conexão**. Não se compartilha
um Client global entre requests concorrentes. Um erro propagado pelo callback
transacional causa rollback antes de encerrar a conexão/responder.

A transação de provisionamento bloqueia a linha do usuário, revalida prontidão e
grava organização, primeira igreja, membership `admin`, contexto de sessão,
auditoria mínima e recibo de idempotência. Uma falha tardia do recibo também desfaz
a auditoria. Nenhum e-mail ocorre nessa transação. A conta previamente criada pode
continuar existindo após falha do provisionamento, permitindo retomada.

O recibo é único por usuário para **o primeiro onboarding**, contém chave, hash do
payload normalizado e IDs resultantes. Repetição idêntica retorna os mesmos IDs,
sem duplicar auditoria. Outra chave/payload após conclusão retorna `409` e orienta
selecionar a organização existente. Isso não limita múltiplos vínculos ou igrejas
e não implementa um fluxo geral de criação de organizações adicionais. Replay
revalida o administrador e nunca recria vínculo revogado.

Os nomes físicos `tenants`, `tenant_memberships`, `tenant_sessions` e `audit_events`
mantêm os contratos SQL dos adapters. O schema do Levi compõe UUIDs nativos,
defaults de servidor, FKs para usuário/sessão e unicidades. A referência composta
do recibo para `(tenant_id, church_id)` impede associar igreja de outra organização.
`account_id`, providers, tokens e valores de verificação preservam tipos textuais.
O contexto de sessão não concede autoridade sozinho: o vínculo é lido novamente.

`audit_events` contém UUIDs técnicos, ação estática, timestamp, resultado,
`request_id` nulo e metadata `{}`. Não guarda nomes, e-mails, senhas ou diffs.
O ID do ator não tem FK para a conta de auth, para não tornar futura eliminação de
conta uma alteração de auditoria. A migration inclui trigger que rejeita UPDATE e
DELETE; a conta dona do banco ainda pode alterar DDL. Privilégios de produção e
retenção não são implementados por esse trigger.

## Validação e limites

A suíte real usa outra conexão para conferir commits/rollbacks, tokens expirados,
uso único concorrente, idempotência concorrente, UUIDs/FKs, isolamento, múltiplas
igrejas, revogação e roles desconhecidas, falhas de autenticação/banco e cookies.
Também inicia uma API HTTP sobre banco vazio para comprovar ausência de migrations
automáticas. Unitários verificam contratos públicos e entrada inválida.

TypeScript usa `strict`, `exactOptionalPropertyTypes` e `noUncheckedIndexedAccess`.
`skipLibCheck` acompanha a base do Foundation: typecheck não equivale a validar
integralmente declarações transitivas de terceiros. Testes reais cobrem os
contratos críticos consumidos.

O executável Node continua restrito ao desenvolvimento local. O Worker DEV
possui Hyperdrive, transporte Resend e limites duráveis de abuso; procedimentos
e limitações em [Deploy DEV](deploy-dev.md). Rate limiting em memória não é
garantia entre invocações. Homologação local não comprova entrega externa,
consumo remoto de CPU, recuperação ou autorização para dados reais.

Não há API de alterar/excluir igrejas, organizações ou memberships. As futuras
exclusões devem definir o tratamento do recibo que referencia a primeira igreja,
sem enfraquecer a integridade atual. Não há dados/migrations de legado,
permissões por igreja ou gestão de convites. O módulo de membros mantém
ficha e histórico separados da identidade de autenticação.
