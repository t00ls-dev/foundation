# Visão geral da arquitetura

## Objetivo

O `foundation` fornece pacotes, convenções e ferramentas compartilhadas para
apps da `t00ls-dev`. Os produtos vivem em repositórios independentes, possuem
deploy e ciclo de atualização próprios e não colocam regras de negócio neste
monorepo.

O projeto é Cloudflare-first, internal-first, modular e seguro por padrão. Os
pacotes podem ser reutilizados por consumidores autorizados, mas não há
compromisso de suporte externo ou compatibilidade além do versionamento
semântico publicado.

## Arquitetura de uma aplicação

Uma aplicação web v0.1 é uma SPA React, com React Router, servida por Workers
Assets. O mesmo Cloudflare Worker executa uma API Hono sob `/api/*` e entrega os
assets estáticos e o fallback da SPA nas demais rotas. Não há SSR.

```text
Internet
   |
Cloudflare Worker
   |-- /api/* --------> Hono API
   `-- demais rotas ---> Workers Assets / SPA React
                              |
                         React Router
```

Essa topologia mantém um único origin e um único artefato de deploy por produto,
sem transformar frontend e API no mesmo módulo. A separação continua existindo
nos contratos e imports. Rotas de API nunca recebem o fallback HTML da SPA.

## Dados

Cada produto decide no ponto zero entre D1 e PostgreSQL:

- D1 é opção de primeira classe para apps simples, pequenos e de baixa
  concorrência.
- PostgreSQL é preferível para SaaS, multi-tenancy, consultas avançadas e
  crescimento previsível.
- Drizzle define schema e migrations.
- Acesso a dados fica em repositories ou adaptadores claros; chamadas D1 não
  devem se espalhar pela aplicação.
- Portabilidade é desejável, mas não há promessa de compatibilidade perfeita
  entre SQLite e PostgreSQL.

O exemplo D1 da v0.1 é deliberadamente sem tenancy (`examples/links`).
PostgreSQL possui testes de integração reais executados contra container. Um
smoke test remoto via Hyperdrive é opcional e separado da suíte determinística
principal.

## Autenticação e acesso

Better Auth OSS/self-hosted é a implementação padrão. Usuários, contas e sessões
permanecem sob controle da aplicação. O pacote de integração configura os fluxos
aprovados e oferece resolução tipada de sessão e headers no servidor, sem expor
indiscriminadamente a API interna do Better Auth. Cloudflare Access continua
sendo alternativa para apps internos simples.

Autenticação responde quem é o usuário. Autorização responde o que ele pode
fazer no contexto atual. Multi-tenancy é uma capability opcional, mas, quando
habilitada, segue um único contrato:

- a role pertence ao membership entre usuário e tenant;
- a sessão contém `activeTenantId`;
- toda troca de tenant valida o membership antes de atualizar a sessão;
- queries tenant-aware recebem o tenant explicitamente e evitam acesso cruzado;
- cada produto fornece o mapa configurável de role para permissões;
- autorização verifica permissões, não nomes de role espalhados pelo código;
- convites são de uso único, expiram e persistem somente o hash seguro do token.

## Limites dos pacotes

Pacotes devem ter responsabilidade pequena e direção de dependência explícita.
Um diretório só vira pacote publicável quando houver reutilização ou isolamento
técnico concreto.

```text
config <--- db <--- auth
              `---- tenant
config <---------- access

config <--- security
config <--- observability
config <--- email

app ---> auth + tenant + access
tooling/create-app ---> pacotes compartilhados
tooling/doctor -----> config e adaptadores de diagnóstico
examples/links -----> pacotes via workspace
```

Responsabilidades:

| Limite          | Responsabilidade                                  | Não deve conter                            |
| --------------- | ------------------------------------------------- | ------------------------------------------ |
| `config`        | configuração tipada e capabilities                | SDKs de produto ou regra de negócio        |
| `db`            | Drizzle, migrations e contratos de acesso a dados | autorização ou UI                          |
| `auth`          | integração Better Auth e fluxos de identidade     | política de permissões do produto          |
| `tenant`        | tenant ativo, memberships, isolamento e convites  | roles universais obrigatórias              |
| `access`        | permissões e mapa configurável de roles           | autenticação ou acesso direto ao banco     |
| `security`      | headers, CORS/CSRF, Turnstile e rate limiting     | regra de negócio                           |
| `observability` | logging estruturado e integrações opt-in          | PII ou secrets em eventos                  |
| `audit`         | eventos append-only e persistência por dialeto    | logging técnico ou mutação de eventos      |
| `email`         | contrato de envio e integração Resend             | templates presos ao provider               |
| `ui`            | primitives React realmente reutilizáveis          | design system completo ou telas de produto |
| `create-app`    | geração de repositórios consumidores              | runtime compartilhado com apps gerados     |
| `doctor`        | diagnóstico de configuração e integrações         | mutações destrutivas ou secrets            |

Regras de dependência:

- módulos de baixo nível não importam módulos de alto nível;
- `auth` não decide autorização;
- `access` não autentica e não consulta banco diretamente;
- providers ficam atrás de adaptadores estreitos, sem abstração especulativa;
- ciclos entre pacotes são proibidos;
- produtos dependem dos pacotes; pacotes nunca dependem de produtos ou exemplos.

## Publicação e consumo

Na v0.1, exemplos e tooling consomem pacotes com o protocolo `workspace:`. Os
nove pacotes em `packages/*` são preparados para distribuição privada via GitHub
Packages, com Changesets e versões independentes. A publicação está bloqueada
até habilitação revisada. Veja o [runbook de pacotes](../runbooks/packages.md).

## Ambientes e entrega

O exemplo do Foundation possui apenas `local` e `dev`. Aplicações consumidoras
definem seus próprios ambientes DEV e PROD com recursos e secrets separados.

- O exemplo recebe deploy DEV automático após integração e gates de qualidade,
  no Custom Domain `foundation.t00ls.dev`.
- O Foundation não possui deploy PROD.
- migrations são executadas apenas no ambiente alvo e quando forem seguras para
  o fluxo.
- smoke em `/health` com D1 encerra o deploy; correções de schema preferem
  forward-fix.
- staging não existe na v0.1.

## Escopo v0.1

A v0.1 entrega uma fundação pequena e executável:

- monorepo pnpm/Turborepo com TypeScript strict e tooling compartilhado;
- SPA React e API Hono no mesmo Worker com Workers Assets;
- configuração tipada;
- Drizzle com suporte a D1 e PostgreSQL;
- exemplo Links (`examples/links`) sem tenancy;
- Better Auth e seus fluxos básicos;
- tenancy opcional com contrato padronizado, access e convites seguros;
- security, logging/observability e e-mail em nível básico necessário aos
  fluxos;
- testes unitários, PostgreSQL em container e smoke Hyperdrive opcional;
- `create-app` e `doctor` básicos, se necessários para validar o caminho do
  consumidor;
- CI, publicação workspace-first e deploy DEV do exemplo conforme os ADRs.

## Não objetivos da v0.1

Não fazem parte da v0.1: SSR, microservices, Kubernetes, GraphQL, OpenAPI
obrigatório, staging, SMS, Web Push, design system completo, autenticação
própria, plataforma própria de feature flags, billing próprio, marketplace
financeiro avançado, event bus complexo, compatibilidade SQL perfeita,
infraestrutura enterprise sem consumidor e integrações/providers sem uso real.

Billing, webhooks genéricos, imagens, storage, backups automatizados e workflows
sofisticados permanecem direções futuras, não entregas implícitas.

## Decisões relacionadas

- [ADR-001: SPA e API no mesmo Worker](../decisions/001-spa-api-same-worker.md)
- [ADR-002: Tenancy, autorização e convites](../decisions/002-tenancy-access-invitations.md)
- [ADR-003: Better Auth](../decisions/003-better-auth.md)
- [ADR-004: Bancos e testes de integração](../decisions/004-databases-and-integration-tests.md)
- [ADR-005: Publicação workspace-first](../decisions/005-workspace-first-publication.md)
- [ADR-006: Foundation DEV-only](../decisions/006-deployment-environments.md)
- [ADR-007: Escopo da v0.1](../decisions/007-v01-scope.md)
