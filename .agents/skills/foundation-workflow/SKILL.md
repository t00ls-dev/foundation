---
name: foundation-workflow
description:
  Use no desenvolvimento, validação e entrega do Foundation para limitar escopo,
  planejar mudanças, executar checks e respeitar autorizações.
---

# Fluxo de trabalho do Foundation

## Idioma da documentação e da comunicação

Esta seção é a referência canônica da política de idioma do Foundation. O
português brasileiro (pt-BR) é o idioma padrão da documentação e da comunicação
humana do projeto, incluindo títulos e descrições de PRs, issues, notas de
versão (release notes) e demais textos administrativos ou explicativos.

Documentação nova deve ser escrita em pt-BR. Não traduza em massa a documentação
legada em inglês ou com idiomas misturados: quando uma alteração exigir
modificar um desses arquivos documentais, traduza integralmente seu conteúdo
humano para pt-BR no mesmo trabalho, preservando o conteúdo pertencente ao
código. Atualize também as referências documentais diretamente relacionadas
quando necessário para manter consistência, incluindo textos de links,
descrições, índices, sumários, referências cruzadas e documentação que apresente
ou descreva o arquivo. Limite essa expansão ao necessário para manter o arquivo
traduzido e suas referências consistentes; ela não autoriza tradução recursiva
ou indiscriminada da documentação, nem tradução de arquivos legados não
alcançados pela alteração.

A política não autoriza alterações por motivo de idioma em código-fonte,
comentários dentro de código, JSDoc/TSDoc/docstrings, identificadores, nomes de
funções, classes, tipos ou variáveis, strings da aplicação, mensagens de erro,
testes ou fixtures, schemas, configurações, workflows, scripts, comandos, paths
ou comportamento da aplicação. Isso também vale para conteúdo pertencente ao
código dentro de documentos. Preserve nomes técnicos, APIs, bibliotecas,
protocolos, comandos, paths e referências ao código em sua forma original quando
apropriado. As convenções técnicas existentes, inclusive o padrão de commits,
permanecem vigentes.

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
