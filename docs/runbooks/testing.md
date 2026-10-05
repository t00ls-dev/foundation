# Testes

O gate oficial é:

```bash
pnpm check
```

Ele verifica a formatação e executa lint, typecheck, testes unitários,
integrações, builds e Playwright. O Docker deve estar disponível para PostgreSQL
por Testcontainers. O Playwright requer Chromium instalado.

Em Actions, o gate completo e a instalação Chromium ficam no job `checks` da CI,
tanto em PR como no push de master. Version Packages depende desse job; Release
manual valida pela API a CI aprovada do `execution_sha` exato, sem repetir a
suíte. Não se substituem testes por cache de resultados. Reexecuções explícitas
da CI e SHAs distintos (PR/merge) continuam sendo validados integralmente. Veja
[Pacotes](packages.md) para os requisitos da evidência reutilizada.

## Durante o desenvolvimento

Execute primeiro o pacote alterado:

```bash
pnpm --filter <pacote> lint
pnpm --filter <pacote> typecheck
pnpm --filter <pacote> test
pnpm --filter <pacote> build
```

Antes de enviar uma mudança, execute `pnpm check` e `pnpm format:check`.

## Cobertura esperada

- primitivas públicas: testes unitários de contrato;
- D1/PostgreSQL e isolamento de tenant: testes de integração reais;
- gerador: conteúdo, segurança do destino e build fora do workspace;
- fluxos de usuário e acessibilidade: Playwright desktop e mobile;
- deploy: smoke test em `/health` no DEV publicado, incluindo conectividade D1.

Mocks não substituem os testes de banco existentes. Testes E2E não devem
depender de providers externos para permanecer deterministas.

## Links (`examples/links`)

```bash
pnpm --filter @t00ls-dev/example-links test
pnpm --filter @t00ls-dev/example-links test:integration
pnpm --filter @t00ls-dev/example-links build
pnpm --filter @t00ls-dev/example-links test:e2e
```

Integração aplica as migrations reais em D1 Miniflare descartável e cobre auth,
CRUD, filtros, isolamento A/B, CSRF, expiração/revogação e múltiplos Set-Cookie.
Também injeta falhas na execução de queries para verificar confirmação de logout
sem renovação, retry após recuperação e ausência de tokens/parâmetros nos logs.
E2E usa um Worker/configuração próprios, captura e-mail em banco temporário e
valida nove cenários em desktop e mobile, incluindo `401` de mutação antiga após
login de outra identidade sem recarregar a página. Nenhum teste envia e-mail
real. A caixa `/__test/mail` pertence apenas a `e2e/worker.ts`, fora do bundle
DEV. O harness não reutiliza servidor ou estado de desenvolvimento e executa
migration duas vezes para conferir reaplicação idempotente pelo journal
Wrangler.

O E2E de security headers usa também o Worker de produção compilado e Workers
Assets reais em Wrangler local (porta 5175, D1 descartável e chaves Turnstile
fictícias). Por isso requer o build antes de `test:e2e`, já ordenado pelo gate
`pnpm check`. Verifica a resposta final de `/`, `/bookmarks`, um JavaScript
estático e `/health`, incluindo CSP, proteção contra framing e Referrer-Policy.
