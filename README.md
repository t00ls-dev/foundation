# t00ls-dev/foundation

Fundação técnica reutilizável para aplicações web, com autenticação, segurança,
isolamento de tenants, banco de dados, e-mail e observabilidade. O projeto é
Cloudflare-first e inclui `examples/links` como aplicação de referência, sem
regras de negócio específicas de produtos.

## Estado

O repositório é público. A branch `master` possui proteção com pull request
obrigatório e status check `checks` do GitHub Actions, sem aprovação humana
obrigatória e com possibilidade de bypass administrativo.

A v0.1 possui um caminho local completo, CI e deploy automático do exemplo em
DEV. O Foundation não possui ambiente PROD; aplicações consumidoras são donas
dos seus ambientes. Na verificação de 11/10/2026, `Deploy DEV` está habilitado,
mas a primeira execução automática após a reativação ainda aguarda observação.
Consulte [`docs/project-status.md`](docs/project-status.md) para entregas,
validações, pendências priorizadas e itens deliberadamente adiados.

## Início rápido

Requisitos: Node.js **22.23.3** (patch validado), Corepack, pnpm **10.15.1** e
Docker disponível para os testes PostgreSQL. A suíte E2E requer Chromium e suas
dependências de sistema.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @t00ls-dev/example-links exec playwright install --with-deps chromium
pnpm check
```

Veja [`docs/architecture/overview.md`](docs/architecture/overview.md) para a
arquitetura, [`docs/decisions`](docs/decisions) para as decisões vigentes e
[`docs/runbooks/cache.md`](docs/runbooks/cache.md) para a regra obrigatória de
bypass de cache nos domínios Cloudflare.

O [runbook de pacotes e Release](docs/runbooks/packages.md) descreve Changesets,
Release PRs e instalação via GitHub Packages.

Runbooks operacionais adicionais cobrem
[ambientes](docs/runbooks/environments.md),
[deploy](docs/runbooks/deployment.md), [segurança](docs/runbooks/security.md),
[testes](docs/runbooks/testing.md), [LGPD](docs/runbooks/lgpd.md) e
[criação de aplicações](docs/runbooks/creating-an-app.md).

## Posicionamento

O acesso aos pacotes depende das permissões do GitHub Packages.

O desenvolvimento a partir do código usa dependências workspace e não requer
token privado do registry. Para o exemplo Links, copie
`examples/links/.dev.vars.example` para `examples/links/.dev.vars`, substitua
`AUTH_SECRET` por um segredo local. Prepare o banco local e inicie o exemplo:

```bash
pnpm --filter @t00ls-dev/example-links db:migrate:local
pnpm dev
```

E-mail e login Google requerem configuração própria se usados manualmente; veja
os exemplos de variáveis locais. Não use credenciais de DEV para testes; os
testes automatizados têm harness e bancos descartáveis próprios.

## Licença e contribuição

O código próprio é licenciado sob MIT, com o aviso
`Copyright (c) 2026 t00ls-dev` confirmado pelo mantenedor; veja
[LICENSE](LICENSE) e [licenças e distribuição](docs/runbooks/licensing.md).
Licenças de terceiros permanecem vigentes. Código-fonte público não autoriza
publicação nem torna automaticamente públicos os pacotes no GitHub Packages.
Workspaces com `private: true` não são publicados no registry, embora seu código
esteja público. O acesso aos pacotes depende das permissões e da herança
administrativas do GitHub Packages, separadas da visibilidade do código.

Veja [CONTRIBUTING.md](CONTRIBUTING.md) para contribuir e
[SECURITY.md](SECURITY.md) para divulgação responsável de vulnerabilidades.
