<h1 align="center">Foundation</h1>

<p align="center">
  Base modular em TypeScript para aplicações web Cloudflare-first da t00ls-dev.<br>
  Autenticação, dados, isolamento por tenant e segurança em pacotes reutilizáveis.
</p>

<p align="center">
  <a href="https://github.com/t00ls-dev/foundation/actions/workflows/ci.yml"><img src="https://github.com/t00ls-dev/foundation/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI da branch master"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D22.22.0-339933" alt="Node.js 22.22.0 ou superior"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licen%C3%A7a-MIT-blue" alt="Licença MIT"></a>
</p>

<p align="center">
  <a href="#pacotes-oficiais">Pacotes</a> ·
  <a href="#início-rápido">Início rápido</a> ·
  <a href="#documentação">Documentação</a> ·
  <a href="CONTRIBUTING.md">Contribuição</a>
</p>

---

O Foundation reúne infraestrutura de aplicação sem regras de negócio de um
produto específico. Combina **React SPA e API Hono no mesmo Cloudflare Worker**,
com D1 como preset inicial e suporte a PostgreSQL via Drizzle.

O preset usa React Router; Levi usa navegação própria com history e estado
React, preservando a mesma topologia SPA/API.

Os **pacotes são internos ao monorepo**, consumidos com `workspace:*`. O
repositório inclui o [Levi](apps/levi/README.md), aplicação privada de gestão de
igrejas com domínio e banco próprios. Consulte o
[estado atual](docs/project-status.md) para entregas e pendências.

Aplicações consomem pacotes com `workspace:*`, mantendo versões, deploys e
recursos próprios. O consumo e a validação seguem o
[runbook de pacotes](docs/runbooks/packages.md).

## Principais funcionalidades

- **Autenticação self-hosted:** Better Auth com senha, verificação de e-mail,
  recuperação, magic link e Google OAuth opcional.
- **Multi-tenancy e autorização:** contexto de tenant, memberships e convites,
  com permissões separadas da autenticação.
- **Dados com limites explícitos:** adapters Drizzle para D1 e PostgreSQL,
  migrations sob responsabilidade de cada aplicação e testes reais de banco.
- **Segurança configurável:** headers, CSP, CORS, CSRF, Turnstile e rate
  limiting.
- **E-mail, logs e auditoria:** integração Resend, logging JSON contextual e
  eventos de auditoria append-only.
- **Qualidade automatizada:** TypeScript strict, Vitest, Miniflare,
  Testcontainers e Playwright, incluindo cenários desktop e mobile.
- **Ferramentas no workspace:** gerador `basic-d1`, diagnóstico read-only com
  Doctor e base UI compartilhada reutilizável.

## Pacotes oficiais

Pacotes locais privados em `packages/*`:

- [**@t00ls-dev/config**](packages/config) — configuração tipada de ambiente,
  bancos e capabilities.
- [**@t00ls-dev/db**](packages/db) — factories Drizzle para D1 e PostgreSQL e
  consulta do journal PostgreSQL.
- [**@t00ls-dev/auth**](packages/auth) — integração Better Auth e resolução
  tipada de sessão no servidor.
- [**@t00ls-dev/tenant**](packages/tenant) — isolamento por tenant, memberships,
  troca de tenant ativo e convites.
- [**@t00ls-dev/access**](packages/access) — autorização por permissões e roles
  configuráveis.
- [**@t00ls-dev/security**](packages/security) — proteções HTTP, Turnstile e
  rate limiting com storage injetável.
- [**@t00ls-dev/email**](packages/email) — contrato substituível de envio de
  e-mail com implementação Resend.
- [**@t00ls-dev/observability**](packages/observability) — logs JSON
  estruturados com contexto de request, usuário e tenant.
- [**@t00ls-dev/audit**](packages/audit) — eventos append-only em D1/PostgreSQL,
  com rejeição de chaves sensíveis na metadata.
- [**@t00ls-dev/ui**](packages/ui) — componentes e padrões React privados,
  consumidos por fontes TSX.

Todos os workspaces são privados. Veja o
[consumo interno](docs/runbooks/packages.md).

## Requisitos

Para desenvolver neste repositório:

- **Node.js 22.23.3**, patch validado pelo projeto; o mínimo declarado é
  `>=22.22.0`.
- **Corepack e pnpm 10.15.1**, fixado no `package.json`.
- **Docker**, para os testes PostgreSQL com Testcontainers.
- **Chromium e dependências de sistema**, para os testes E2E com Playwright.

## Instalação

### Consumir um pacote

Dentro de um consumidor do workspace, adicione a dependência local:

```bash
pnpm --filter <app> add '@t00ls-dev/config@workspace:*'
```

Consulte os READMEs em [`packages/`](packages) para as APIs e requisitos de cada
pacote e o [guia de criação de aplicações](docs/runbooks/creating-an-app.md)
para montar um projeto consumidor.

### Preparar o repositório

```bash
git clone https://github.com/t00ls-dev/foundation.git
cd foundation
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

O desenvolvimento local usa dependências `workspace:*` e não requer token
privado de registry.

## Início rápido

Consulte o [guia do Levi](apps/levi/README.md) para configuração e execução
local. `pnpm dev` inicia o Levi. Para criar aplicações D1, consulte o
[gerador](docs/runbooks/creating-an-app.md).

Para executar o gate completo, com Docker disponível:

```bash
pnpm --filter levi exec playwright install --with-deps chromium
pnpm check
```

Os testes usam bancos descartáveis e e-mails capturados, sem credenciais de
deploy ou envio real. O [runbook de testes](docs/runbooks/testing.md) descreve
as suítes e os checks focados.

## Documentação

- **Visão do projeto:** [arquitetura](docs/architecture/overview.md),
  [decisões técnicas](docs/decisions) e [estado atual](docs/project-status.md).
- **Construir aplicações:** [criação de apps](docs/runbooks/creating-an-app.md),
  [pacotes internos](docs/runbooks/packages.md).
- **Desenvolver e operar:** [testes](docs/runbooks/testing.md),
  [ambientes](docs/runbooks/environments.md),
  [deploy](docs/runbooks/deployment.md) e
  [migrations](docs/runbooks/migrations.md).
- **Proteção de dados:** [segurança](docs/runbooks/security.md),
  [bypass de cache obrigatório](docs/runbooks/cache.md) e
  [LGPD](docs/runbooks/lgpd.md).

## Acessibilidade

Consulte a [declaração de acessibilidade](ACCESSIBILITY.md) para objetivos,
avaliações existentes e como comunicar barreiras.

## Contribuição

Issues e pull requests focados são bem-vindos. Leia
[CONTRIBUTING.md](CONTRIBUTING.md) para os padrões de contribuição, validação e
integração. Mudanças nos pacotes são validadas junto aos consumidores locais.

## Segurança

Para comunicar vulnerabilidades, siga [SECURITY.md](SECURITY.md). Não exponha
detalhes exploráveis, credenciais ou dados pessoais em issues públicas.

## Licença

O código próprio é distribuído sob a [licença MIT](LICENSE), com copyright de
2026 da t00ls-dev. Licenças e avisos de terceiros permanecem vigentes; consulte
[licenças e distribuição](docs/runbooks/licensing.md).
