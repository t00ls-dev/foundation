# ADR-004: Bancos e testes de integração

- Status: aceito
- Escopo: v0.1

## Contexto

Apps pequenos se beneficiam da simplicidade do D1, enquanto SaaS e cargas
complexas frequentemente exigem PostgreSQL. A fundação deve validar os dois
caminhos sem fingir equivalência entre dialetos.

## Decisão

D1 e PostgreSQL são suportados por Drizzle, com schemas, migrations e
adaptadores explícitos por banco quando necessário. O exemplo Links
(`examples/links`) demonstra o caminho mínimo sem tenancy.

O histórico é propriedade do app que compõe os schemas. Drizzle Kit gera os dois
dialetos e aplica PostgreSQL; Wrangler aplica e consulta migrations D1. Os
históricos permanecem separados porque os dialetos não são equivalentes. Seeds
não fazem parte das migrations de schema.

Integrações PostgreSQL são testadas contra um container PostgreSQL real na suíte
local/CI. Hyperdrive não substitui esses testes. Um smoke test contra Hyperdrive
remoto pode existir como job opcional, acionado explicitamente e condicionado à
presença de credenciais próprias do ambiente.

## Consequências

- D1 permanece simples e não é obrigado a demonstrar tenancy.
- Diferenças reais de SQLite e PostgreSQL podem ser tratadas nos adaptadores.
- A suíte principal é reprodutível e não depende de rede ou credenciais
  Cloudflare.
- Migrations aplicadas são imutáveis e correções usam novas migrations
  forward-only.
- O smoke remoto valida conectividade/configuração, mas não bloqueia todo
  desenvolvimento por padrão.
