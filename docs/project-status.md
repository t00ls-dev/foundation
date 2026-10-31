# Estado do projeto

Referência documental em 31/10/2026: manifest do Levi com oito dependências
Foundation e Better Auth 1.7.12. Registros abaixo de cadastros, gates, deploy,
recursos externos e ECONNRESET são observações das respectivas entregas, sem
consulta remota nesta revisão. Nenhuma pendência operacional é considerada
resolvida por inferência do código.

Este documento é a fonte de verdade sobre o que existe no
`t00ls-dev/foundation`, o que falta para concluir a v0.1 operacional e o que foi
deliberadamente adiado. Ele descreve o código atual, não uma arquitetura
hipotética.

Última revisão de código: incorporação do Levi e CI conjunta em 25 de outubro de
2026; distribuição npm encerrada em 27 de outubro de 2026. Registros
operacionais históricos permanecem identificados nas respectivas seções e
runbooks.

O repositório é público. `master` possui proteção clássica com pull request
obrigatório e status check `checks` do GitHub Actions, sem aprovação humana
obrigatória e com possibilidade de bypass administrativo. O Levi utiliza o
Environment `levi-dev`; não há operação PROD autorizada.

## Objetivo e escopo

O foundation fornece pacotes, convenções e ferramentas reutilizáveis para apps
da `t00ls-dev` e será a base principal do monorepo. O workspace está preparado
para `apps/*`, incluindo o Levi em `apps/levi`, sob MIT com histórico subtree
sem squash e preservação das atribuições. A transferência DEV do Levi foi
concluída; sua operação está integrada ao Foundation, sem dependência
operacional do repositório original. Aplicações mantêm versões, deploys, bancos
e recursos próprios, compartilhando contratos públicos dos pacotes via
workspace.

A v0.1 valida um caminho completo e pequeno:

- monorepo TypeScript com qualidade automatizada;
- React SPA e API Hono no mesmo Cloudflare Worker;
- D1 como preset inicial e PostgreSQL como adapter suportado;
- Better Auth, e-mail, segurança, tenancy e autorização;
- gerador de projeto e diagnóstico básico;
- desenvolvimento local e CI dos pacotes compartilhados e do Levi.

O projeto é Cloudflare-first e internal-first, sem regras de negócio de um
produto específico. Providers e capabilities sem consumidor real não fazem parte
da primeira entrega.

## Entregue

### Fundação e tooling

- Levi privado em `apps/levi`, com oito dependências workspace, build ordenado,
  validação PG/ACLs/Worker/E2E em CI e domínio/schema/recursos independentes.
  Origem, SHAs e limites operacionais estão no [README](../apps/levi/README.md).
  Publicador manual Levi integrado e transferência DEV concluída, com o original
  contido. A definição usa nomes canônicos LEVI_ no Environment `levi-dev` e o
  gate `LEVI_DEPLOY_READY`; a migração administrativa dos cadastros permanece
  pendente antes de executar essa revisão. A sincronização da autenticação via
  LEVI_AUTH_SECRET está preparada, mas sua primeira aplicação exige publicação
  com troca de segredo expressamente autorizada; não foi executada nesta etapa.
  O painel passa a exigir e-mail verificado correspondente a LEVI_ADMIN_EMAIL,
  sem concessões pelo banco ou gestão de administradores na interface; a nova
  configuração requer publicação autorizada. Versionamento privado segue
  pendente.

- Workspace pnpm com Turborepo e Node.js `>=22.22.0`.
- TypeScript strict compartilhado em `@t00ls-dev/typescript-config`.
- ESLint compartilhado em `@t00ls-dev/eslint-config`.
- Formatação com Prettier.
- Builds ordenados pelos limites de dependência do workspace.
- Todos os consumidores Foundation usam `workspace:*`; os pacotes são privados.
- O lockfile resolve Zod `4.6.7` nas cadeias Better Auth e Core `1.7.12`. Os
  overrides de Zod ainda selecionam somente Better Auth/Core `1.7.10` e não
  impõem essa resolução às versões `1.7.12`. O override de Undici fixa `7.30.1`
  na cadeia Miniflare. Overrides de raiz não corrigem lockfiles de consumidores
  externos; a cópia Levi incorporada usa o lockfile da raiz, preservando o
  lockfile histórico do repositório original.
- CI integral e gates existentes preservados; testes de contrato exercitam
  aplicativos sintéticos, componentes privados e dependências transitivas com
  `^build`, sem seleção agressiva ou publicação npm.

### Automação de manutenção existente

- Dependabot semanal, segunda-feira às 03:00 UTC, com limite de 15 PRs de versão
  para npm e dez para GitHub Actions. Atualizações minor/patch agrupadas por
  frontend, tooling/testes e GitHub Actions; majors permanecem individuais.
- Dependabot alerts e atualizações automáticas de segurança habilitados no
  GitHub (verificado em 13/10/2026). Os grupos se aplicam somente a atualizações
  de versão, cujo limite não restringe PRs de segurança.
- `@types/node` mantido na major 22 enquanto esse for o runtime mínimo
  suportado.

### Pacotes

| Pacote                     | Estado atual                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@t00ls-dev/config`        | Configuração tipada para ambiente, D1/PostgreSQL, Better Auth, tenancy e flags de telemetria.                                                                       |
| `@t00ls-dev/db`            | Factories Drizzle para D1 e PostgreSQL via `pg.Client` conectado e status read-only do journal PostgreSQL, sem esconder recursos específicos dos bancos.            |
| `@t00ls-dev/auth`          | Configuração Better Auth para senha, verificação de e-mail, recuperação, magic link e Google OAuth opcional. Emite JavaScript e declarações TypeScript consumíveis. |
| `@t00ls-dev/tenant`        | Contexto de tenant, memberships, troca de tenant ativo, convites e repositories D1/PostgreSQL.                                                                      |
| `@t00ls-dev/access`        | Roles configuráveis como conjuntos de permissões, separadas da autenticação.                                                                                        |
| `@t00ls-dev/security`      | Headers, CSP, CORS, CSRF, Turnstile e rate limiting com storage injetável.                                                                                          |
| `@t00ls-dev/email`         | Contrato substituível de e-mail e implementação Resend sem espalhar chamadas do provider.                                                                           |
| `@t00ls-dev/observability` | Logging JSON estruturado com contexto de request, usuário e tenant.                                                                                                 |
| `@t00ls-dev/audit`         | Eventos append-only para D1/PostgreSQL, com validação recursiva que rejeita chaves sensíveis na metadata.                                                           |

Os pacotes Foundation são privados e consumidos exclusivamente no monorepo por
dependências `workspace:*`, resolvidas como links locais pelo pnpm. A
distribuição npm foi encerrada; não há automação de publicação ou versionamento
por Changesets. Versões e changelogs existentes são históricos. Builds, APIs,
testes e deploys das aplicações permanecem independentes.

### Create App

`@t00ls-dev/create-app` gera o preset não interativo `basic-d1` em um diretório
novo ou vazio. O projeto gerado:

- é autônomo e não contém dependências `workspace:*`;
- usa React, React Router, Hono, D1, Drizzle e Better Auth;
- inclui Resend, Google OAuth opcional e recuperação de senha;
- inclui React Hook Form, validação Zod e estados acessíveis de formulário;
- inclui configurações Wrangler/Drizzle, migration, seed local e documentação
  inicial;
- instala, passa no typecheck e compila fora do monorepo.

O gerador recusa sobrescrever diretórios não vazios e preserva a causa de erros
de filesystem.

### Doctor

`@t00ls-dev/doctor` realiza diagnóstico read-only de projetos Node e Cloudflare
D1. Atualmente verifica:

- versão do Node contra `package.json#engines`;
- manifesto e configuração Wrangler;
- nomes obrigatórios em `.dev.vars.example`;
- bindings D1, presença de migrations SQL e scripts de banco padronizados;
- arquivos de secrets ou chaves indevidamente rastreados pelo Git;
- saída humana ou JSON e códigos de saída previsíveis.

Valores de secrets nunca são incluídos no relatório.

### Qualidade

O comando `pnpm check` executa, nesta ordem:

1. verificação de formatação;
2. lint;
3. typecheck;
4. testes unitários;
5. testes de integração;
6. builds;
7. testes E2E;
8. contratos de consumo local do workspace;
9. contratos de diagnósticos operacionais e runtime do Levi.

A cobertura atual inclui:

- testes unitários de config, db, auth, tenant, access, security, email,
  observability, audit, create-app e Doctor;
- testes de tenancy, permissões, memberships, isolamento, troca de tenant e
  convites;
- D1 real local por Miniflare;
- PostgreSQL 17 real por Testcontainers;
- integração PostgreSQL com `pg`, migrations/seed pelo histórico Drizzle,
  isolamento, concorrência de convites e rollback conjunto com audit;
- Better Auth PostgreSQL com IDs textuais e e-mails capturados, mais execução
  `pg`/Drizzle/audit em Workers local; Hyperdrive remoto não comprovado;
- cenários Playwright em desktop e mobile;
- geração, instalação, typecheck e build do starter fora do workspace.

Pacotes sem testes próprios não executam Vitest vazio. A CI combina o reporter
`default` do Vitest com `.github/scripts/vitest-summary.mjs`; Playwright usa
reporters GitHub e `.github/scripts/playwright-summary.mjs` em CI. As suítes e
os resumos de cada execução são a referência para cobertura e contagens.

### Automação

CI valida pacotes compartilhados e Levi. Deploy do Levi permanece manual. As
automações exclusivas do exemplo D1 foram removidas, sem excluir recursos
remotos. Migrations persistentes exigem operação independente e autorizada.

## Pendências para a v0.1 operacional

### Operação

O ECONNRESET intermitente do Worker permanece em investigação separada. A
remoção do exemplo não altera os gates operacionais do Levi. Recursos remotos
antigos exigem inventário e autorização de desativação próprios.

### Evolução após a v0.1

Estes itens dependem de necessidade concreta ou de um segundo preset/consumidor:

- opções interativas no create-app para PostgreSQL, auth, tenancy e telemetria;
- ampliação de `t00ls.config.ts` para email, audit, storage, images e billing;
- diagnóstico Doctor para PostgreSQL/Hyperdrive, R2, Images, providers, backups
  e endpoints remotos;
- validação remota real de Hyperdrive (o harness local usa conexão direta, sem
  testar pooling/cache do serviço);
- alternativa de autenticação por Cloudflare Access;
- contratos compartilhados de request/response preparados para futura adoção de
  OpenAPI;
- taxonomia de eventos, consentimento, PII scrubbing e integrações Sentry,
  PostHog, GA4 e Hitmetrica;
- padrões de exportação, exclusão, retenção e consentimento para LGPD.

## Deliberadamente adiado

Não serão implementados sem consumidor real:

- billing e roteamento entre gateways;
- webhooks genéricos e infraestrutura ampla de idempotência;
- Cloudflare Images e R2;
- backups automatizados e testes de restore;
- Queues, Workflows e Cron além de casos concretos;
- feature flags próprias;
- design system completo;
- staging, GraphQL, microservices, Kubernetes, SMS e Web Push.

## Pacotes internos

O contrato de consumo e seu histórico estão em
[Pacotes internos](runbooks/packages.md).

## Decisões vigentes

As decisões arquiteturais permanecem registradas em `docs/decisions`:

- [SPA e API no mesmo Worker](decisions/001-spa-api-same-worker.md);
- [tenancy, access e convites](decisions/002-tenancy-access-invitations.md);
- [Better Auth](decisions/003-better-auth.md);
- [bancos e testes de integração](decisions/004-databases-and-integration-tests.md);
- [consumo interno pelo workspace](decisions/005-workspace-first-publication.md);
- [Ambientes e deploy por aplicação](decisions/006-deployment-environments.md);
- [escopo da v0.1](decisions/007-v01-scope.md).
- [ADR-008: Base UI Foundation](decisions/008-foundation-ui-v1.md)

Mudanças que contradigam essas decisões devem atualizar ou substituir o ADR
correspondente, sem alterações arquiteturais silenciosas.

## Comandos úteis

```bash
pnpm install
pnpm check
pnpm format:check
pnpm dev
pnpm --filter @t00ls-dev/create-app build
pnpm --filter @t00ls-dev/doctor build
pnpm --filter @t00ls-dev/doctor exec node dist/bin.js /caminho/absoluto/para/app
```

Requisitos locais: Node.js 22, Corepack/pnpm e Docker para os testes PostgreSQL.
