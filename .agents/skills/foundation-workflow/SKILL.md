---
name: foundation-workflow
description:
  Use no desenvolvimento, validação e entrega do Foundation para limitar escopo,
  planejar mudanças, executar checks e respeitar autorizações.
---

# Foundation Workflow

## Planejamento e escopo

- Leia `AGENTS.md` e confira o working tree; preserve trabalho existente.
- Confira a master remota; sincronize quando autorizado, preservando alterações.
- Antes de mudanças maiores, apresente objetivo, escopo, arquivos e validação.
- Resolva ambiguidades antes da ação afetada; planeje mudanças pequenas
  brevemente.
- A autorização do pedido cobre todas as ações explícitas naquele escopo. Não
  peça confirmação redundante.
- Pare antes de ações não autorizadas ou que ampliem o escopo; peça autorização.
- Crie branch, commit, push e PR quando pedidos; baseie a branch na master
  atual.
- Mantenha uma finalidade por PR, diff mínimo e revisão dos arquivos incluídos.
- Evite refatorações, upgrades, formatação e lockfile alheios à tarefa.

## Validação

- Consulte `docs/runbooks/testing.md` e os scripts dos pacotes afetados.
- Comece por checks/testes focados; amplie conforme o impacto da mudança.
- Use testes de contrato, integração ou E2E conforme o comportamento e o
  runbook.
- Reserve `pnpm check` ao gate final antes do envio, após checks focados.
  Consulte sua composição em `package.json`, sem duplicá-la em prompts.
- Repita o gate só se mudanças relevantes ou falhas invalidarem o resultado.
- Registre falhas e evidências; correções fora do escopo exigem autorização.
- Não declare checks com falha ou não executados como aprovados.

## Entrega e operações protegidas

- Merge, publicação/release e deploy manual exigem autorização explícita.
- Avançar master pode acionar deploy DEV: leia `docs/runbooks/deployment.md`.
- Não desenvolva em `changeset-release/master` nem faça commits manuais no
  Version Packages.
- Para mudanças publicáveis, siga `docs/runbooks/packages.md` e use Changesets;
  não edite versões manualmente.
- Antes de releases ou de avançar master durante publicação/recuperação,
  consulte as restrições do runbook de pacotes e coordene a operação autorizada.
- Não contorne gates, reescreva branches protegidas pelo fluxo ou improvise
  recuperação de release.

## Contexto e relatório

- Leia só arquivos relevantes; referencie documentação em vez de copiá-la.
- Consulte `docs/project-status.md` para contexto; não copie seu estado aqui.
- Consulte `docs/decisions/` para impacto arquitetural; não contradiga ADRs
  silenciosamente.
- Evite releituras, logs extensos e repetição de planos ou resultados.
- Após checks aprovados, repita/amplie só por mudança, falha ou dúvida concreta.
- Conclua com resultado, validações e bloqueios em poucas linhas; inclua
  branch/PR quando existirem.
- Mantenha só regras estáveis aqui; detalhes operacionais ficam nos runbooks.
