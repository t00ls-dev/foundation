# Deploy

Cada produto possui deploy independente. O Foundation valida somente o fluxo DEV
usando `examples/links`.

## DEV automático

Um push em `master` executa a CI completa. O workflow `Deploy DEV` recebe o SHA
validado, aplica migrations D1, publica o Worker e consulta `/health` no Custom
Domain `foundation.t00ls.dev`. O endpoint verifica também o D1. O deploy não
repete os testes.

A origem exige repositório e head repository `t00ls-dev/foundation`, evento
`push` e branch `master`. Antes de instalar dependências do SHA alvo, um
checkout do SHA confiável do workflow fornece o validador; a API confirma
identidade/path do workflow CI, run concluído com `success` e job `checks`
concluído com `success` no mesmo SHA e tentativa. Reruns que alterem a tentativa
durante a consulta bloqueiam o deploy. O segundo checkout usa somente o SHA
aprovado pelo validador. PRs/forks e artifacts de CI não fornecem código para o
deploy privilegiado. Credenciais Git não persistem nos checkouts; secrets
Cloudflare ficam apenas nos steps de migration e deploy, não na instalação ou
validação. O cache pnpm usa o escopo de master do GitHub, sem recuperar caches
das refs de PR.

O workflow aguarda a conclusão da CI, incluindo Version Packages. Falha no
versionamento bloqueia o deploy mesmo se `checks` passou; o SHA permanece
identificável para investigação. Não há deploy manual nesta otimização.

Uma falha de migration, deploy ou health check encerra o workflow com erro.
`DEV_HEALTH_URL` deve conter `https://foundation.t00ls.dev` para habilitar o
smoke test. Aplicações consumidoras implementam seus próprios deploys DEV e
PROD.

## Migrations e rollback

Siga [Migrations](migrations.md). O fluxo normal é forward-fix: uma migration já
aplicada não deve ser editada nem revertida destrutivamente. O rollback de
código só é seguro quando a versão anterior continua compatível com o schema
atual.

Em uma falha:

1. interrompa novas promoções;
2. preserve logs, SHA e resultado da migration;
3. corrija o schema com uma nova migration ou publique código compatível;
4. execute novamente o gate e o smoke;
5. registre a decisão quando houver impacto arquitetural.

## Secrets

Workflows recebem apenas nomes de secrets documentados. Valores nunca devem ser
impressos, gravados em summaries ou passados como inputs comuns de workflow.
