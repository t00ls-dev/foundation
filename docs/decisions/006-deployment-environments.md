# ADR-006: Foundation DEV-only

- Status: aceito
- Escopo: v0.1

## Contexto

O Foundation fornece packages e valida a integração com `examples/links`. Essa
aplicação de referência não é um produto de produção. Cada aplicação consumidora
é responsável pelos próprios ambientes DEV e PROD.

## Decisão

Após os gates de lint, typecheck, testes e build, merges em `master` fazem
deploy automático do exemplo no ambiente Cloudflare DEV. O Worker usa o Custom
Domain `foundation.t00ls.dev`, sem `*.workers.dev` nem Preview URLs. O
Foundation não provisiona nem implanta um ambiente PROD.

O D1 e os secrets do exemplo são exclusivos de DEV. O deploy aplica migrations
no D1 DEV e termina com smoke em `/health`, que verifica o Worker e o banco.
Falhas de schema preferem forward-fix.

## Consequências

- DEV oferece feedback contínuo remoto sem operar um produto em PROD.
- Consumidores definem e operam seus próprios ambientes e políticas de promoção.
- Rollback de código não deve presumir rollback destrutivo de migration.
- O fluxo local continua separado do D1 e dos secrets remotos.
