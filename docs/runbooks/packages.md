# Pacotes e Release do Foundation

Os nove pacotes reutilizáveis `@t00ls-dev/*` usam versões SemVer independentes,
Changesets e GitHub Packages (`https://npm.pkg.github.com`). O código-fonte do
repositório é público. A raiz e os workspaces de examples, tests e tooling,
incluindo create-app/doctor, usam `private: true` e não são publicados no
registry; isso não restringe a leitura de seu código. O código próprio usa MIT,
com o aviso `Copyright (c) 2026 t00ls-dev` confirmado pelo mantenedor, conforme
[Licenças e distribuição](licensing.md). Os nove pacotes publicados continuam
com visibilidade privada no GitHub Packages. O acesso depende de permissões,
herança e Manage Actions access: código público não torna automaticamente os
pacotes públicos nem garante que o público autorizado permaneça igual. O deploy
do Foundation continua DEV-only.

## Histórico do bootstrap

A primeira publicação privada dos nove pacotes em `0.1.0` foi concluída pelo
bootstrap especial no SHA `33c4963b4c2c7f4cb34d5045eec7cc3162ca6857`, execução
[36615440630](https://github.com/t00ls-dev/foundation/actions/runs/36615440630).
Não foram criadas tags Git ou GitHub Releases. A infraestrutura específica foi
substituída pelo fluxo permanente; sua implementação permanece no histórico Git.
O antigo PR #23 com bumps `0.2.0` foi descartado sem merge. Rejeição de metadata
sensível em audit e redação dos logs em observability (`12f1f8d`, antigo
safe-audit-logs) já integram a base inicial `0.1.0`.

## Desenvolvimento e Version Packages

1. Crie um changeset com `pnpm exec changeset` para cada mudança publicável,
   selecionando os pacotes e patch/minor/major apropriados. Não edite versões
   manualmente; dependências internas podem produzir bumps derivados pelo
   Changesets.
2. Após o merge do PR de desenvolvimento, a CI de `push` na `master` executa
   `pnpm check`. Seu job `version`, dependente de `checks`, instala com lockfile
   congelado e cria/atualiza Version Packages sem repetir o gate. O SHA validado
   deve continuar sendo master. Não há `publish-script`: **pushes nunca publicam
   pacotes**. A branch permanece `changeset-release/master`, com commits
   assinados pela API da Changesets Action e sem commits manuais.
3. O Version Packages inclui `.changeset/release-plan.json`, registro
   determinístico de packages/versões anteriores e novas, bumps, changesets
   consumidos e seus hashes, dependências que justificam bumps derivados, versão
   do CLI e SHA base do planejamento. Revise-o com manifests e changelogs.
4. PRs gerados pelo `GITHUB_TOKEN` não disparam automaticamente a CI de PR.
   Antes de mesclar, provoque uma validação humana do head (por exemplo, reabrir
   o PR com identidade humana) e confira o SHA validado. Não use PAT de
   publicação.
5. Após a revisão e merge do Version Packages, espere a CI verde do merge. A
   publicação requer autorização separada. `release_sha` identifica o merge
   commit imutável desse PR; `execution_sha` identifica o HEAD atual de master
   com o executor autorizado. Correções posteriores do mecanismo só podem mudar
   os arquivos de infraestrutura explicitamente permitidos abaixo.

O checkout do job CI `version` mantém a credencial Git temporária do
`GITHUB_TOKEN`: o CLI Changesets pode aprofundar o clone via `git fetch` para
identificar os commits que adicionaram changesets ao gerar changelogs. O cleanup
da Checkout Action remove a credencial ao finalizar o job. Os checkouts de
Release e Deploy DEV continuam com `persist-credentials: false`. Isso não muda o
push via API da Changesets Action nem autoriza publicação via Git CLI.

## Audit manual (nenhuma publicação)

Execute Release em `master` por `workflow_dispatch` com:

- `mode=audit` (padrão);
- `release_pr`: número do Version Packages **mesclado**;
- `release_sha`: SHA completo do merge do Version Packages;
- `execution_sha`: SHA completo atual de master, com o executor revisado.

O antigo input `expected_sha` foi removido e é rejeitado explicitamente, sem
fallback. Dispatches antigos não devem ser reutilizados.

O job audit tem somente leitura de packages. Aceita repositório público ou
privado e verifica identidade exata retornada pela API (`full_name`, nome e
proprietário `t00ls-dev/foundation`) e base `master`, evento/ref/SHA,
estado/base/head/autor do PR gerado, commit do bot, registro revisado,
changesets consumidos e hashes no SHA base. Confere o checkout, instalação
congelada, CI aprovada do `execution_sha`, ausência de changesets ativos,
allowlist dos nove nomes, demais workspaces privados, MIT e registry. O registry
é consultado autenticadamente; erros não são interpretados como versões
ausentes. Versões inesperadas, downgrade, pacote inacessível ou alvo já
publicado falham.

Release consulta a API de Actions com `actions: read` em cada validação de
contexto, inclusive imediatamente antes e após a publicação. A evidência exige
repositório e origem `t00ls-dev/foundation`, identidade e path do workflow
`.github/workflows/ci.yml`, evento `push`, branch `master`, SHA exato, run
concluído com `success` e exatamente um job `checks` concluído com `success`,
vinculado ao mesmo run, SHA e tentativa. O run mais recente de push/master desse
SHA é usado sem fallback para aprovação antiga; uma reexecução pendente ou com
falha, dados incompletos e erros da API bloqueiam a operação. IDs e tentativa
são registrados nos logs. A evidência permanece válida enquanto esses requisitos
forem verificáveis; uma nova tentativa invalida a aprovação anterior até passar.

Audit compila os packages no próprio runner antes de empacotar. Preflight e
publisher não recompilam nem reempacotam os tarballs autorizados. Não se baixam
artifacts de CI/PR nem se reutilizam caches de PR como código confiável: o cache
pnpm usa o escopo de master do GitHub, sem importação de caches de refs de PR. O
gate completo continua na CI de PR e de master, incluindo integrações, E2E,
distribuição e contratos de release. Reexecuções explícitas da CI ainda repetem
o gate, mas Release não o duplica.

Esta mudança exige nova base revisada: CI e o validador compartilhado são inputs
protegidos. A allowlist de infraestrutura abaixo não foi ampliada para
reaproveitar releases ou autorizações anteriores.

### Conteúdo aprovado e executor autorizado

Exige-se `release_pr.merge_commit_sha == release_sha` e, separadamente,
`execution_sha == github.sha == master remoto == HEAD do checkout`. A API deve
comprovar que release_sha é ancestral de execution_sha. As árvores Git completas
e identificadas por commits/tree OIDs imutáveis são comparadas pela projeção
ordenada de cada entrada final: path, mode, type e object/blob ID. Trees pais
agregadas não entram na projeção, pois mudam quando uma folha de infraestrutura
permitida muda. API incompleta/truncada, identidade de objeto divergente e
entradas ausentes/duplicadas interrompem o fluxo.

TODO o repository é protegido por padrão, com exceção apenas destes arquivos:

- `.github/workflows/release.yml`
- `.github/scripts/release-core.mjs`
- `.github/scripts/release.mjs`
- `.github/scripts/release-planning.mjs`
- `.github/scripts/release.test.mjs`
- `docs/runbooks/packages.md`

Não há exceções por diretório. Manifests, versões, changelogs, release-plan,
fontes, READMEs dos packages, tooling, scripts/configs de build, lockfile e
dependências permanecem idênticos ao conteúdo aprovado. A projeção também é
conferida entre o head do Release PR e seu merge commit. Adição, remoção,
rename, bytes, mode ou tipo divergente em inputs protegidos falham. Symlinks e
gitlinks não são inputs de release suportados, inclusive nos arquivos de
infraestrutura permitidos. A integridade do workspace rastreado e dos arquivos
não ignorados é revalidada após preparar os artifacts e antes da tentativa.

O executor continua parte da base de confiança: os scripts/workflow do
execution_sha precisam de revisão e autorização explícitas. Igualdade dos inputs
não promete reprodução bit a bit nem protege contra executor malicioso aprovado.
O audit gera os artifacts e a autorização vincula seus bytes exatos.

O inventário consulta diretamente os packuments completos dos nove nomes em
`npm.pkg.github.com` com `GITHUB_TOKEN` (`NODE_AUTH_TOKEN`), sem enumerar
packages pela REST API de usuário. Exige HTTP 200, identidade exata, versões,
`latest`, identidade de cada versão, `dist.integrity` SHA-512 e URLs de tarball
do registry com nome/versão coerentes. A versão anterior aprovada deve existir.
A ausência do alvo só é aceita dentro desse documento válido. HTTP 401/403/404,
falha de rede/timeout, 5xx, JSON inválido ou campos obrigatórios ausentes
interrompem o fluxo. Um 404 do package significa ausente ou inacessível e
**nunca** autoriza onboarding implícito. A consulta usa o documento do package,
não um endpoint `/package/versão` nem um `E404` isolado de `npm view`.

A identidade de autor Git sozinha não comprova geração automática. O único
commit precisa ser o `head.sha` do PR, ter exatamente um parent igual ao SHA
base e possuir assinatura verificada (`verified: true`, `reason: valid`), autor
`github-actions[bot]` e committer `web-flow`, compatíveis com o caminho API da
Changesets Action utilizado aqui. Não use commits manuais ou o modo de push via
Git CLI para esse PR de versionamento.

Após instalar as dependências congeladas, os gates recuperam pela API os
manifests, configuração de workspaces/Changesets e changesets do SHA base. Em
diretório temporário isolado, as bibliotecas do CLI instalado recalculam o
release plan sem executar versionamento ou publicação. O record inteiro deve
corresponder ao resultado, incluindo packages, versões, bumps, hashes e bumps
derivados de dependências internas. Falhas de consulta, árvore truncada ou
inputs obrigatórios ausentes interrompem o fluxo.

O plano calculado por Changesets precisa corresponder exatamente ao registro
aprovado ainda ausente no registry. Só esses packages são empacotados pelo CLI;
metadata, exports e arquivos são inspecionados. Cada tarball contém `LICENSE`
idêntico ao texto raiz aprovado, além de manifest MIT. O resultado inclui hashes
SHA-256/SHA-512 e um `plan_digest` SHA-256 do envelope canônico contendo PR,
repository, release PR, release_sha, execution_sha, protectedInputsDigest,
registro, audit_run e artifacts. Anote também o ID `audit_run`.

O envelope `authorization.json` usa `format: 2`; o release-plan continua em
`format: 1`, sem modificar o record aprovado. Envelopes antigos são rejeitados e
exigem novo audit. O protectedInputsDigest é SHA-256 da projeção canônica de
inputs protegidos; não substitui os hashes dos tarballs.

Audit e preflight compartilham a validação do caminho exato do tarball derivado
de nome e versão, como `packages/t00ls-dev-access-0.1.1.tgz`; nomes arbitrários,
traversal, subdiretórios e artifacts fora do plano são rejeitados.

Revise o summary e o artifact `foundation-release-<plan_digest>` da execução
bem-sucedida. O digest cobre os **bytes** dos tarballs, não apenas os números de
versão. Guarde esse resultado: audit não autoriza automaticamente um publish.

## Publish manual explicitamente autorizado

Em uma execução separada, Release em `master` exige:

- `mode=publish`;
- mesmos `release_pr`, `release_sha` e `execution_sha` do audit;
- `confirmation=PUBLISH_PRIVATE_FOUNDATION_PACKAGES`;
- `plan_digest` exato revisado;
- `audit_run`: ID do audit bem-sucedido que possui os artifacts.

Um preflight só-leitura revalida a CI do SHA exato e master/PR/registro,
proveniência da execução audit, digest, tarballs e registry. Não reempacota os
artifacts autorizados. Um job separado com `packages: write` repete os gates
imediatamente antes da tentativa. Autenticação usa exclusivamente
`GITHUB_TOKEN`.

O audit_run deve pertencer ao workflow Release, ter audit bem-sucedido em master
e `head_sha == execution_sha`. PR, ambos os SHAs, fingerprint, record,
audit_run, digest e artifacts devem coincidir integralmente. O publisher
reconsulta master imediatamente antes e após a tentativa, além do registry.

A publicação utiliza os artifacts preservados e o plano restante validado:

```sh
pnpm exec changeset publish --from-pack-dir <diretório-validado> --no-git-tag
```

Não há GitHub Releases nem tags Git automáticas. O plano preserva os grupos de
dependências calculados pelo Changesets. As operações e o job de versionamento
da CI têm concurrency global e não cancelam uma publicação em andamento. Não
existe retry automático.

## Reconciliação e resume

Após qualquer tentativa, inclusive falha parcial, consulte/revise
`private-release-result`, `reconciliation.json` e o summary. Cada alvo é
classificado como publicado, ausente ou divergente. Um alvo publicado só é
aceito se a integridade e `latest` correspondem ao artifact autorizado e sua
identidade corresponde ao nome autorizado. Erro de consulta pós-publicação
produz estado não verificado/divergente, nunca sucesso silencioso.

Não refaça a publicação cegamente e não crie uma versão artificial para
recuperar uma release parcial. Após análise e nova autorização, use
`mode=resume` com os mesmos PR/release_sha/execution_sha/digest/audit_run e a
mesma confirmação. O restante é o plano original menos as versões confirmadas no
registry; nenhuma delas é sobrescrita. Se tudo já chegou, resume apenas
reconcilia. Divergência de SHA, versões, integridade, identidade, provenance ou
`latest` impede qualquer nova tentativa.

Master deve permanecer no execution_sha auditado até concluir publish/resume. Se
avançar após o audit, a autorização falha fechada mesmo que apenas a
infraestrutura tenha mudado: não se reutiliza o digest antigo. Antes de uma
primeira publicação, exige-se novo audit e nova autorização do executor atual.
Após publicação parcial, um avanço de master exige recuperação e reautorização
explícitas dos mesmos artifacts, revisadas separadamente; não reempacote, não
crie versão artificial e não reescreva master. A consulta não é transação
atômica: avanço durante a tentativa pode produzir estado publicado/parcial; o
relatório registra falha de verificação e o workflow não faz retry.

Artifacts expiram em 30 dias. Se expirarem após uma falha parcial, não
reempacote e não relaxe o digest: pare para planejar recuperação explícita.
Novos packages, prereleases/snapshots e upgrade de formato do Changesets
requerem mudanças revisadas: este fluxo normal admite os nove nomes já
existentes e SemVer estável.

## Permissões e limitações

- Versionamento: contents/pull-requests write, sem packages write.
- Audit: contents/pull-requests/packages/actions read.
- Preflight: contents/pull-requests/packages/actions read; recupera o artifact
  do audit.
- Publish/resume: contents/pull-requests/actions read e packages write; sem PAT,
  contents write, aprovação automática de PR, OIDC npmjs ou criação de Releases.

### Invariantes administrativas de onboarding

Para os nove packages existentes, devem permanecer estabelecidos no onboarding:

- **visibility private** no GitHub Packages;
- associação administrativa a **`t00ls-dev/foundation`**;
- **Manage Actions access** ou herança aplicável concedendo ao Foundation acesso
  de leitura e, para o publisher, escrita.

Essas propriedades são verificadas e mantidas pelos administradores do package.
Mudança de visibilidade, associação, acesso, exclusão ou recriação exige nova
revisão administrativa antes de continuar releases. Novos packages continuam
exigindo onboarding separado e revisado.

O runtime não comprova essas propriedades pelo registry: `repository` no
packument é metadata publicada; acesso autenticado e `access: restricted` não
provam visibility private nem associação administrativa. A REST API de metadata
de packages do usuário não suporta o token de instalação usado pelo workflow;
essa dependência causou a falha do primeiro audit
[36693989133](https://github.com/t00ls-dev/foundation/actions/runs/36693989133).
Não se introduz PAT nem se fabricam campos de visibilidade/associação no
inventário. **Risco residual:** deriva administrativa externa não é detectada
necessariamente pelo workflow de release. Os gates de runtime continuam
verificando identidade/namespace, versões, tags e integridade, com reconsulta
antes da publicação e reconciliação posterior.

Na verificação de 11/10/2026, o repositório é público e `master` possui proteção
clássica com pull request obrigatório e status check `checks` do GitHub Actions.
Não há aprovação humana obrigatória; administradores podem contornar as regras.
O Environment `dev` restringe deployments à `master`, sem required reviewers ou
wait timer, mantendo o ciclo DEV automático. Quem pode alterar workflows ainda
pode alterar gates: revisão humana, controle dos acessos e verificação do SHA
continuam essenciais. Consultar SHA e registry não é uma transação atômica;
alterações externas concorrentes podem causar falha parcial, que deve ser
reconciliada.

## Consumo privado

Configure no consumidor `.npmrc`:

```ini
@t00ls-dev:registry=https://npm.pkg.github.com
```

Em desenvolvimento local, use token de ambiente com `read:packages` em um
`.npmrc` pessoal fora do repo. Em Actions, conceda acesso de leitura ao
repositório consumidor em Manage Actions access e use `GITHUB_TOKEN` com
`packages: read`, `actions/setup-node` e `NODE_AUTH_TOKEN` via ambiente. Acesso
depende das permissões GitHub Packages; nunca grave tokens no Git.

Veja [validação da distribuição](package-distribution.md) para os perfis D1,
limitações de declarações externas e testes isolados de artifacts.
