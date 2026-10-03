# Estado do projeto

Este documento é a fonte de verdade sobre o que existe no
`t00ls-dev/foundation`, o que falta para concluir a v0.1 operacional e o que foi
deliberadamente adiado. Ele descreve o código atual, não uma arquitetura
hipotética.

Última revisão: 1 de outubro de 2026.

## Objetivo e escopo

O foundation fornece pacotes, convenções e ferramentas reutilizáveis para apps
da organização `t00ls-dev`. Os produtos finais vivem em repositórios próprios e
podem atualizar os pacotes de forma independente.

A v0.1 valida um caminho completo e pequeno:

- monorepo TypeScript com qualidade automatizada;
- React SPA e API Hono no mesmo Cloudflare Worker;
- D1 como preset inicial e PostgreSQL como adapter suportado;
- Better Auth, e-mail, segurança, tenancy e autorização;
- gerador de projeto e diagnóstico básico;
- desenvolvimento local, CI e deploy automático do exemplo somente em DEV.

O projeto é Cloudflare-first e internal-first, sem regras de negócio de um
produto específico. Providers e capabilities sem consumidor real não fazem parte
da primeira entrega.

## Entregue

### Fundação e tooling

- Workspace pnpm com Turborepo e Node.js `>=22.22.0`.
- TypeScript strict compartilhado em `@t00ls-dev/typescript-config`.
- ESLint compartilhado em `@t00ls-dev/eslint-config`.
- Formatação com Prettier.
- Builds ordenados pelos limites de dependência do workspace.
- Dependabot semanal, segunda-feira às 03:00 UTC, com limite de cinco PRs por
  ecossistema.
- `@types/node` mantido na major 22 enquanto esse for o runtime mínimo
  suportado.

### Pacotes

| Pacote                     | Estado atual                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@t00ls-dev/config`        | Configuração tipada para ambiente, D1/PostgreSQL, Better Auth, tenancy e flags de telemetria.                                                                       |
| `@t00ls-dev/db`            | Factories Drizzle para D1 e PostgreSQL e status read-only do journal PostgreSQL, sem esconder recursos específicos dos bancos.                                      |
| `@t00ls-dev/auth`          | Configuração Better Auth para senha, verificação de e-mail, recuperação, magic link e Google OAuth opcional. Emite JavaScript e declarações TypeScript consumíveis. |
| `@t00ls-dev/tenant`        | Contexto de tenant, memberships, troca de tenant ativo, convites e repositories D1/PostgreSQL.                                                                      |
| `@t00ls-dev/access`        | Roles configuráveis como conjuntos de permissões, separadas da autenticação.                                                                                        |
| `@t00ls-dev/security`      | Headers, CSP, CORS, CSRF, Turnstile e rate limiting com storage injetável.                                                                                          |
| `@t00ls-dev/email`         | Contrato substituível de e-mail e implementação Resend sem espalhar chamadas do provider.                                                                           |
| `@t00ls-dev/observability` | Logging JSON estruturado com contexto de request, usuário e tenant.                                                                                                 |
| `@t00ls-dev/audit`         | Eventos append-only para D1/PostgreSQL, com validação recursiva que rejeita chaves sensíveis na metadata.                                                           |

Os nove pacotes estão preparados para publicação privada no GitHub Packages;
internamente são consumidos com `workspace:*`. A publicação automatizada está
bloqueada.

### Aplicação de referência

`examples/links` apresenta **Links**, uma biblioteca privada de bookmarks. O
package é `@t00ls-dev/example-links`. Demonstra:

- React, React Router, React Hook Form, Zod e Tailwind CSS;
- Hono no mesmo Worker que serve os assets da SPA;
- D1 e Drizzle;
- Better Auth por meio dos pacotes do foundation;
- senha, verificação, recuperação, magic link e Google opcional;
- envio de e-mail via Resend;
- `/health` para saúde do Worker e do D1 e fallback de rotas da SPA;
- configuração local e DEV, com Custom Domain `foundation.t00ls.dev`, sem
  `*.workers.dev` nem Preview URLs e com Workers Logs habilitados;
- migration inicial e journal Drizzle do schema de autenticação;
- comandos padronizados de geração, migration, seed e status;
- formulários com labels, erros associados, foco inválido e estados de envio;
- CRUD de bookmarks, tags JSON, busca simples, filtro exato e paginação
  limit/offset;
- isolamento por usuário em todas as queries e mutações, sem tenancy/RBAC;
- sessão tipada no servidor pela API mínima `resolveSession` de
  `@t00ls-dev/auth`, com propagação de cookies e verificação de e-mail
  obrigatória;
- headers privados e CSRF nas mutações autenticadas por cookie;
- 15 testes unitários e 11 testes D1 reais do exemplo, incluindo falhas de
  revogação/confirmação, logs sanitizados e gerações de sessão;
- nove cenários Playwright em desktop e mobile (18 execuções), incluindo
  cadastro/verificação/login/logout, persistência, isolamento e respostas
  atrasadas;
- harness E2E com banco temporário e e-mails capturados, sem providers externos.

O ambiente local usa `.dev.vars.example` como contrato de nomes de secrets, sem
versionar valores reais.

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
8. testes de distribuição dos packages;
9. testes de release.

A cobertura atual inclui:

- testes unitários de config, db, auth, tenant, access, security, email,
  observability, audit, create-app e Doctor;
- testes de tenancy, permissões, memberships, isolamento, troca de tenant e
  convites;
- D1 real local por Miniflare;
- PostgreSQL 17 real por Testcontainers;
- 14 testes de integração Foundation mais 11 de Links, incluindo migration e
  seed PostgreSQL pelo histórico Drizzle e isolamento por usuário em D1;
- nove cenários Playwright em desktop e mobile, totalizando 18 execuções;
- geração, instalação, typecheck e build do starter fora do workspace.

Pacotes sem testes próprios não executam Vitest vazio. A CI usa o reporter
normal do Vitest para evitar dezenas de summaries fragmentados no GitHub.

### Automação

- `CI`: executa o gate completo em PRs e pushes para `master`; execuções antigas
  da mesma ref são canceladas.
- Version Packages é um job isolado da CI de push/master, dependente de
  `checks`, sem repetir o gate. Compartilha a serialização global com Release
  manual.
- `Release`: somente manual; audit/preflight/publisher verificam pela API a CI
  aprovada do SHA exato, preservando autorização, provenance e checks de
  registry.
- `Deploy DEV`: inicia após uma CI verde em `master`, faz checkout do SHA
  validado, aplica migrations D1, implanta e consulta `/health` quando uma URL
  foi configurada. Verifica evento push/master, repositório de origem,
  identidade do workflow e job aprovado na mesma tentativa. Não repete a suíte
  de testes.
- O Foundation não possui ambiente ou workflow PROD. Aplicações consumidoras
  definem seus próprios ambientes e processos de deploy.
- `Smoke Hyperdrive`: execução manual contra um endpoint configurado. É apenas
  um smoke remoto; não implementa um binding Hyperdrive dentro deste
  repositório.
- Migrations são app-owned: Drizzle Kit gera os históricos por dialeto, Wrangler
  aplica e consulta D1, e Drizzle Kit aplica PostgreSQL. Seeds são separados e
  migrations aplicadas recebem somente correções forward-only. O procedimento
  está em [Migrations](runbooks/migrations.md).
- Respostas operacionais e auth usam headers conservadores, e os domínios devem
  aplicar o bypass descrito em [Cache](runbooks/cache.md).

## Pendências para a v0.1 operacional

### Infraestrutura externa

DEV possui banco, secrets, envio de e-mail e deploy automático validados. O
Custom Domain `foundation.t00ls.dev` responde ao smoke em `/health` com o Worker
e o D1 operacionais. `DEV_HEALTH_URL` está configurado no GitHub; `BASE_URL` e
`EMAIL_FROM` estão declarados em `env.dev.vars`. O bypass de cache no domínio
foi configurado e as respostas verificadas não apresentaram
`CF-Cache-Status: HIT`. O envio do e-mail de Magic Link foi validado manualmente
em DEV; o acesso pelo link ainda não foi testado.

Ainda faltam para a operação completa:

- configurar `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` apenas se OAuth Google
  for usado;
- concluir a validação manual de cadastro com um endereço não cadastrado,
  verificação de e-mail, login, logout e acesso pelo Magic Link em DEV.

### Fechamento operacional

Links possui cobertura determinística local de autenticação e bookmarks. Após
publicação, registrar a validação manual dos fluxos restantes em DEV e do CRUD
com duas contas, conforme `examples/links/README.md`. A validação local não
substitui entrega de e-mail e inspeção de cache/cookies no domínio real. O PROD
de aplicações consumidoras não pertence ao Foundation.

Os runbooks vigentes cobrem [ambientes](runbooks/environments.md),
[deploy](runbooks/deployment.md), [segurança](runbooks/security.md),
[testes](runbooks/testing.md), [cache](runbooks/cache.md),
[migrations](runbooks/migrations.md), [LGPD](runbooks/lgpd.md) e
[criação de apps](runbooks/creating-an-app.md).

### Evolução após a v0.1

Estes itens dependem de necessidade concreta ou de um segundo preset/consumidor:

- opções interativas no create-app para PostgreSQL, auth, tenancy e telemetria;
- ampliação de `t00ls.config.ts` para email, audit, storage, images e billing;
- diagnóstico Doctor para PostgreSQL/Hyperdrive, R2, Images, providers, backups
  e endpoints remotos;
- adapter e teste real de Hyperdrive;
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

## Publicação e releases

Changesets prepara releases independentes dos nove pacotes reutilizáveis em
`packages/*` para GitHub Packages privado. O workflow abre Release PRs, mas a
publicação permanece explicitamente bloqueada até uma ativação revisada. Veja o
[runbook de pacotes](runbooks/packages.md). Nesse período:

- APIs podem amadurecer sem releases artificiais;
- cada pacote mantém versão própria;
- consumidores de teste usam exports públicos;
- breaking changes futuras exigirão major version.

## Decisões vigentes

As decisões arquiteturais permanecem registradas em `docs/decisions`:

- [SPA e API no mesmo Worker](decisions/001-spa-api-same-worker.md);
- [tenancy, access e convites](decisions/002-tenancy-access-invitations.md);
- [Better Auth](decisions/003-better-auth.md);
- [bancos e testes de integração](decisions/004-databases-and-integration-tests.md);
- [publicação workspace-first](decisions/005-workspace-first-publication.md);
- [Foundation DEV-only](decisions/006-deployment-environments.md);
- [escopo da v0.1](decisions/007-v01-scope.md).

Mudanças que contradigam essas decisões devem atualizar ou substituir o ADR
correspondente, sem alterações arquiteturais silenciosas.

## Comandos úteis

```bash
pnpm install
pnpm check
pnpm format:check
pnpm dev
pnpm --filter @t00ls-dev/create-app build
pnpm --filter @t00ls-dev/doctor exec doctor ./examples/links
```

Requisitos locais: Node.js 22, Corepack/pnpm e Docker para os testes PostgreSQL.
