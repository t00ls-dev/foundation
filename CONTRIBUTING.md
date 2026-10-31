# Contribuindo com o Foundation

Comece pelo [README](README.md) e pelo
[runbook de testes](docs/runbooks/testing.md). Use Node.js 22.23.3, pnpm
10.15.1, Docker e Chromium para a suíte completa. Instale com
`pnpm install --frozen-lockfile`. Testes usam serviços locais descartáveis; não
precisam de credenciais de deploy.

## Mudanças e revisão

- Abra uma issue para discutir mudanças amplas; correções pequenas podem vir
  diretamente em um PR focado, com descrição do problema e da validação.
- Preserve os padrões existentes e escreva documentação em pt-BR.
- Execute primeiro os testes afetados, lint e typecheck. Antes de enviar,
  execute `pnpm check`; registre claramente checks pendentes ou falhas.
- Dependências Foundation usam `workspace:*`. Veja
  [Pacotes internos](docs/runbooks/packages.md).
- Mudanças em workflows, scripts operacionais, manifests e lockfile precisam de
  revisão cuidadosa dos gates e permissões. Não inclua secrets, dados reais ou
  arquivos de ambiente locais.

A CI de PR roda em runners GitHub hospedados. Contribuições externas não recebem
secrets operacionais nem autorizam deploy, migrations ou publicação. O
mantenedor revisa o PR e os checks antes de integrar. Avançar `master` executa
CI; o deploy DEV é manual e migrations persistentes exigem operação independente
autorizada. A distribuição npm foi encerrada.

O código próprio é licenciado sob MIT; consulte
[licenças e distribuição](docs/runbooks/licensing.md) para o aviso de copyright
confirmado pelo mantenedor e os avisos de terceiros. Relate vulnerabilidades
conforme [SECURITY.md](SECURITY.md), sem expor detalhes sensíveis em issues
públicas.
