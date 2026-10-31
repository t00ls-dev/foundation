# Visão geral da arquitetura

## Objetivo

Aplicações mantêm domínio, schema/migrations, deploy e recursos operacionais
próprios. Compartilham mecanismos pelos exports dos pacotes, com dependências
`workspace:*`, sem imports entre implementações de aplicações. Pacotes não
dependem de aplicações. A estrutura deve permitir extração futura com seu fecho
de dependências, sem exigir banco ou implantação conjunta.

Os pacotes Foundation são privados e consumidos exclusivamente no monorepo por
dependências `workspace:*`, resolvidas como links locais pelo pnpm. A
distribuição npm foi encerrada; não há automação de publicação ou versionamento
por Changesets. Versões e changelogs existentes são históricos. Builds, APIs,
testes e deploys das aplicações permanecem independentes.

O projeto é Cloudflare-first, internal-first, modular e seguro por padrão. Os
pacotes podem ser reutilizados por consumidores autorizados, mas não há
compromisso de suporte externo ou compatibilidade externa; veja o
[consumo interno](../runbooks/packages.md).

## Arquitetura de uma aplicação

Uma aplicação web v0.1 é uma SPA React, com React Router no preset e navegação
history própria no Levi, servida por Workers Assets. O mesmo Cloudflare Worker
executa uma API Hono sob `/api/*` e entrega os assets estáticos e o fallback da
SPA nas demais rotas. Não há SSR.

```text
Internet
   |
Cloudflare Worker
   |-- /api/* --------> Hono API
   `-- demais rotas ---> Workers Assets / SPA React
                              |
                         Router do consumidor
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

## Autenticação e acesso

Better Auth OSS/self-hosted é a implementação padrão. Usuários, contas e sessões
permanecem sob controle da aplicação. O pacote de integração configura os fluxos
aprovados e oferece resolução tipada de sessão e headers no servidor, sem expor
indiscriminadamente a API interna do Better Auth. Cloudflare Access continua
sendo alternativa para apps internos simples.

Autenticação responde quem é o usuário. Autorização responde o que ele pode
fazer no contexto atual. Multi-tenancy é uma capability opcional, mas, quando
habilitada, preserva estas invariantes, com composição própria por aplicação:

- a role pertence ao membership entre usuário e tenant;
- o pacote tenant usa `activeTenantId`; Levi compõe seleção por
  `church_sessions`;
- toda troca de tenant valida o membership antes de atualizar a sessão;
- queries tenant-aware recebem o tenant explicitamente e evitam acesso cruzado;
- cada produto fornece o mapa configurável de role para permissões;
- autorização verifica permissões, não nomes de role espalhados pelo código;
- convites são de uso único, expiram e persistem somente o hash seguro do token.

## Limites dos pacotes

Pacotes devem ter responsabilidade pequena e direção de dependência explícita.
Um diretório só vira pacote compartilhado quando houver reutilização ou
isolamento técnico concreto.

```text
config <--- db <--- auth
              `---- tenant
config <---------- access

config <--- security <--- auth (verificação Turnstile opt-in)
config <--- observability
config <--- email

app ---> auth + tenant + access
tooling/create-app ---> preset autônomo com dependências upstream
tooling/doctor -----> config e adaptadores de diagnóstico
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

O contrato de consumo e seu histórico estão em
[Pacotes internos](../runbooks/packages.md).

## Ambientes e entrega

Aplicações definem seus próprios ambientes com recursos e secrets separados. O
deploy do Levi permanece manual e sujeito aos gates existentes.

## Escopo v0.1

A v0.1 entrega pacotes de configuração, dados D1/PostgreSQL, autenticação,
tenancy, acesso, segurança, auditoria, observabilidade e e-mail. Inclui tooling,
gerador, Doctor e validação automatizada dos consumidores locais.

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
- [ADR-005: Consumo interno pelo workspace](../decisions/005-workspace-first-publication.md)
- [ADR-006: Ambientes e deploy por aplicação](../decisions/006-deployment-environments.md)
- [ADR-007: Escopo da v0.1](../decisions/007-v01-scope.md)
- [ADR-008: Base UI Foundation](../decisions/008-foundation-ui-v1.md)
