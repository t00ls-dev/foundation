# Deploy

Cada produto possui deploy independente. O Foundation valida somente o fluxo DEV
usando `examples/links`.

## DEV automático

Na verificação de 11/10/2026, o workflow `Deploy DEV` está habilitado após sua
reativação. A primeira execução automática pós-reativação ainda aguarda
observação; uma CI ou um deploy anterior não comprova essa validação.

Um push em `master` executa a CI completa. O workflow `Deploy DEV` recebe o SHA
validado e coordena expand/deploy/backfill/contract em jobs independentes. O job
de deploy **não aplica migrations**: verifica schema read-only, publica o Worker
e consulta `/health` no Custom Domain `foundation.t00ls.dev`. O endpoint
verifica D1 e expõe `X-Foundation-SHA` quando configurado; a versão Cloudflare
também recebe tag do SHA. O deploy não repete os testes.

A origem exige repositório e head repository `t00ls-dev/foundation`, evento
`push` e branch `master`. Antes de instalar dependências do SHA alvo, um
checkout do SHA confiável do workflow fornece o validador; a API confirma
identidade/path do workflow CI, run concluído com `success` e job `checks`
concluído com `success` no mesmo SHA e tentativa. Reruns que alterem a tentativa
durante a consulta bloqueiam o deploy. O segundo checkout usa somente o SHA
aprovado pelo validador. PRs/forks e artifacts de CI não fornecem código para o
deploy privilegiado. Exige master atual no SHA autorizado e revalida cada fase.
Credenciais Git não persistem nos checkouts; secrets Cloudflare ficam apenas nos
steps de migration e deploy, não na instalação ou validação. O cache pnpm usa o
escopo de master do GitHub, sem recuperar caches das refs de PR.

O workflow aguarda a conclusão da CI, incluindo Version Packages. Falha no
versionamento bloqueia o deploy mesmo se `checks` passou; o SHA permanece
identificável para investigação. Retry manual do ciclo usa `workflow_dispatch`,
somente master/SHA atual e CI aprovada; não é atalho para código de PR.

Uma falha de migration, deploy ou health check encerra o workflow com erro.
`DEV_HEALTH_URL` deve conter `https://foundation.t00ls.dev`; o smoke SHA/D1 é
obrigatório. Expand necessário com falha bloqueia deploy; contract inelegível é
adiado sem erro. Dirty bloqueia avanço, sem derrubar o Worker implantado. Veja
[Migrations](migrations.md) para metadata, serialização e recuperação.
Aplicações consumidoras implementam seus próprios deploys DEV e PROD.

## Resumos do Actions

Cada job apresenta sua própria operação em tabelas de duas colunas: `VALIDATE`,
`EXPAND`, `DEPLOY / VERIFY`, `BACKFILL` e `CONTRACT`. A visão do deploy inclui
DEV, SHA autorizado, run/tentativa, resultados independentes de publicação e
saúde SHA/D1 e links para os steps e artifacts da execução. O SHA curto é um
link para o commit completo. Não há versão/release nem duração total inventada:
os steps atuais não fornecem esses dados estruturados ao renderer. Migrations
mostram a duração entre `startedAt` e `finishedAt`, sem setup/upload.

Interprete os estados separadamente:

| Estado                 | Significado                                                                    |
| :--------------------- | :----------------------------------------------------------------------------- |
| Succeeded              | Step concluído com sucesso ou operação confirmada no JSON.                     |
| Failed                 | Falha operacional; `dirty` indica efeitos incertos que exigem diagnóstico.     |
| Already applied        | Journal e postcondição confirmados; SQL não executado nesta operação.          |
| No operations required | Fase concluída, sem operações registradas para essa fase.                      |
| Skipped                | Step não executado ou operação inelegível; não comprova execução bem-sucedida. |
| Cancelled              | Cancelamento informado pelo Actions; não comprova ausência de efeitos.         |
| Unknown / interrupted  | Evidência insuficiente, incompleta ou indisponível; não é sucesso.             |

`Job até o resumo` é o estado do job no momento do step informativo. Uma fase
CONTRACT pode encerrar seu job com sucesso e apresentar operações `Skipped`
porque são inelegíveis. A saúde é comprovada somente quando o smoke conclui com
`Succeeded`; iniciar o deploy ou o smoke não comprova sucesso. O resumo de
deploy não é uma conclusão global do ciclo: BACKFILL e CONTRACT ainda podem
falhar. O resultado final nativo do Actions, incluindo pós-steps, permanece
autoritativo.

Os detalhes recolhíveis mostram IDs numéricos das migrations e digest do plano
em duas linhas. Nomes completos, transições, evidências e SHA completo continuam
no JSON. As contagens refletem somente operações **registradas**: falhas de
autorização, probes ou setup podem interromper a fase antes de registrar todas
as migrations consideradas pelo executor. Falhas `dirty` não contam todas as
possíveis causas de falha do job. Recovery não possui contagem de SQL no formato
atual; seu resumo distingue `Reconciled` e `Already reconciled`.

Para investigar, abra os steps/logs pelo link do resumo, confira o JSON completo
emitido por `migrations.mjs` e baixe `migration-<fase>-<run>-<attempt>` na lista
de artifacts (retenção de 30 dias). VERIFY conserva seu JSON nos logs do step de
schema; Recovery mantém seu artifact existente. Compare SHA, tentativa e digest
antes de usar a evidência; consulte também os journals persistentes descritos em
[Migrations](migrations.md). Nenhum JSON, artifact ou histórico é substituído
pelo Markdown.

O resumo é derivado e **não autoriza deploy, SQL ou recovery**. Identidade,
provenance, CI e gates continuam sendo validados pelos scripts operacionais. O
renderer local não consulta APIs nem lê credenciais; seus steps dedicados não
recebem secrets. Exibe apenas campos permitidos e não inclui SQL, mensagens
arbitrárias de erro ou evidência aninhada. Falhas de renderização/escrita emitem
aviso seguro sem alterar exit codes operacionais; a indisponibilidade do próprio
script aparece no step informativo.

Jobs inteiramente skipped não executam steps de resumo. Cancelamento/perda do
runner pode impedir o step `always()` e a gravação do JSON. Nesse caso, use os
resultados nativos e a auditoria persistente; não deduza que uma mutation não
ocorreu. Tabelas estreitas e detalhes recolhíveis favorecem mobile, mas o app do
GitHub pode variar na renderização de `<details>` e links. Não há teste visual
automatizado do app GitHub mobile.

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

Antes do merge/ativação, provisione as credenciais operacionais no **GitHub
Environment `dev`**, conforme [Ambientes](environments.md). Deploy, migration
reutilizável e recovery referenciam esse Environment; validate/CI não. O job do
workflow chamado resolve seus Environment Secrets, com repasse explícito de
nomes canônicos pelo caller. Não há aprovação manual nova para DEV nem
configuração automática dos secrets. Não há fallback para token de deploy em
migration. O inventário do GitHub confirmado em 11/10/2026 contém somente o
Environment `dev`; o Foundation não possui Environment nem operação PROD.
