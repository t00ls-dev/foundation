# Onboarding e provisionamento

Esta primeira fatia implementa uma API local, consumida pela
[interface React de onboarding](interface-onboarding.md). O escopo de produto
continua em [Decisões do MVP](decisoes-mvp.md). Cadastro e consulta de membros
possuem [guia próprio](gestao-membros.md), com habilitação separada. Convites e administração possuem contratos próprios; produção continua pendente.
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

Para exercitar manualmente, a partir de `apps/levi`, crie um banco local separado, exclusivamente sintético:

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
valida em bancos descartáveis; a publicação DEV é manual, após CI aprovada, conforme
[Deploy DEV](deploy-dev.md); não aplica migrations persistentes.

## Fluxo e endpoints

Todos os corpos de escrita são JSON e rejeitam campos desconhecidos. Envie
`Origin` igual à origem pública configurada (5173 no desenvolvimento, 3000 no
build local) e preserve os cookies nativos, inclusive cada
`Set-Cookie`. Escritas autenticadas sem origem confiável são recusadas. Respostas
são privadas e não armazenáveis em cache; links não são enviados em `Referer`.

| Método e caminho                    | Contrato atual                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| POST /api/onboarding/email          | Solicita Magic Link com `email`; não exige senha.                                                             |
| GET /api/auth/magic-link/verify     | Verifica e-mail e estabelece sessão pelo Better Auth.                                                         |
| GET /api/session-context            | IDs internos de usuário e sessão; 401 sem sessão.                                                             |
| GET /api/onboarding                 | Retorna `etapa`: `email`, `verificar-email`, `igreja` ou `concluido`.                                         |
| POST /api/onboarding/password-email | Solicita link de recuperação para a própria sessão verificada.                                                |
| GET /api/auth/reset-password/:token | Callback nativo de recuperação.                                                                               |
| POST /api/onboarding/password       | `newPassword` e token opcional para compatibilidade; primeira senha opcional exige sessão verificada recente. |
| POST /api/auth/sign-in/email        | Login por e-mail e senha existente.                                                                           |
| POST /api/auth/sign-out             | Logout nativo.                                                                                                |
| POST /api/churches                  | `name`, contatos opcionais `address`, `phone`, `email` e `Idempotency-Key`; retorna 201.                      |
| GET /api/churches                   | Lista vínculos atuais, paginados com `after` e `next`.                                                        |
| POST /api/context/church            | Seleciona `churchId` após validar o vínculo.                                                                  |
| GET /api/context                    | Resolve igreja ativa, papel e capacidades atuais.                                                             |
| GET/PATCH /api/churches/:id         | Consulta autorizada ou edição institucional com `version`.                                                    |

A conta verificada pode criar várias igrejas independentes. A senha não bloqueia
onboarding ou administração global. Rotas antigas de organizações e tenant
retornam 404. A seleção não concede autoridade: cada operação valida o vínculo.
Operações de membros exigem `X-Levi-Church` coerente com a seleção persistida.

Gestão de acessos, convites, payloads e regras de concorrência estão no
[Núcleo de igrejas](nucleo-igrejas.md), fonte do contrato de domínio atual.

## Persistência e transação

`src/app.ts` compõe os endpoints; `src/auth.ts` compõe identidade e
`src/data/schema.ts` define o schema. Os serviços de igrejas substituem o antigo
provisionamento organizacional. Cada request usa um Client conectado; domínio,
adapters e auditoria compartilham a conexão nas transações.

A criação grava igreja, primeiro administrador, seleção, recibo e auditoria
atomicamente. A chave é da conta e admite novas chaves para outras igrejas;
replay exige payload correspondente e acesso atual, sem restaurar vínculo
revogado. Não existe recibo único limitando a conta ao primeiro onboarding.
Os nomes físicos e a conversão do modelo anterior permanecem documentados no
[núcleo](nucleo-igrejas.md#fases-de-migration-e-corte), como histórico de migração.
Auditoria técnica não contém nomes, contatos, credenciais ou diffs pessoais.

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

Há edição institucional e gestão de acessos e convites. Exclusão de igrejas
continua fora da API; membro da congregação permanece separado da conta.
