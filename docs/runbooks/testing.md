# Testes

O gate oficial é:

```bash
pnpm check
```

Ele verifica a formatação e executa lint, typecheck, testes unitários,
integrações, builds e Playwright. O Docker deve estar disponível para PostgreSQL
por Testcontainers. O Playwright requer Chromium instalado.

Inclui `pnpm test:operations`, com testes dos diagnósticos compartilhados de
deploy.

Em Actions, o gate completo é dividido entre `static`, `tests`, contratos de
consumo local. O Levi possui jobs próprios `levi-tests` e `levi-e2e`, sem
secrets ou Environment. O agregador obrigatório `checks` exige sucesso de todos
esses jobs, inclusive de todas as entradas das matrizes; falha, cancelamento ou
skip bloqueiam o gate. Deploy valida a CI aprovada do SHA exato. Não se
substituem testes por cache de resultados. Reexecuções da CI e SHAs distintos
(PR/merge) continuam sendo validados integralmente. Veja
[Pacotes internos](packages.md).

Todos os jobs de `ci.yml` usam `ubuntu-24.04`. No gráfico, aparecem como
**Foundation: verificações estáticas**, **Foundation: testes dos pacotes**,
**Levi: testes e integração** e **Levi: E2E (shard 1/3, 2/3 ou 3/3)**, seguidos
pelo check obrigatório `checks` (identificador preservado, sem `name`
personalizado).

O job `levi-e2e` usa três shards nativos Playwright, `fail-fast: false` e
timeout de 15 minutos por entrada. Cada entrada executa build, instalação do
Chromium e `pnpm --filter levi test:e2e --runtime-acls --shard=<índice>/3` em
runner próprio, com PostgreSQL e caixa de e-mails descartáveis. As portas fixas
ficam isoladas entre runners. `workers: 1`, retries e projetos existentes são
preservados; sem `fullyParallel`, a unidade de divisão é o arquivo dentro de
cada projeto. O `needs` do agregador continua incluindo `levi-e2e`: qualquer
shard com falha reprova o job agregado e bloqueia `checks`. Não há merge nem
publicação de relatórios.

Para conferir a cobertura, execute
`pnpm --filter levi test:e2e --runtime-acls --list --reporter=list` e repita com
`--shard=1/3`, `--shard=2/3` e `--shard=3/3`. Compare as identidades completas
(projeto, arquivo, posição e título), incluindo testes ignorados: a união deve
ser idêntica à lista completa, e cada identidade deve ocorrer uma única vez. Na
implantação desta divisão: 101 testes = 44 + 44 + 13. Compare também as etapas e
durações de cada shard, pois contagens por arquivo não garantem tempos iguais;
considere o custo de build, Chromium e migrations por entrada.

Pendências fora desta mudança: revisar os runners de `deploy-levi-dev`,
`diagnose-levi-cloudflare`; avaliar separadamente a migração para Ubuntu 26.04.
Não use execuções de imagens diferentes como comparação direta de desempenho. O
resumo por shard no `GITHUB_STEP_SUMMARY` também fica pendente: o reporter
seguro atual é preservado, e a escrita do resumo requer tratar o caminho de
saída sem introduzir alerta de segurança ou revelar detalhes sensíveis.

### Resumos no GitHub Actions

Os testes Vitest exibem um resumo compacto por pacote e suíte em
`GITHUB_STEP_SUMMARY`, usando os resultados e diagnósticos da API do framework.
Incluem Passed, Failed, Skipped (também `todo`), Flaky e duração desde a
inicialização do reporter. No Vitest, Flaky é subconjunto de Passed.

As durações dos reporters não incluem setup de Node/dependências nem builds
anteriores. Os checks estáticos mantêm os diagnósticos e estados de steps
nativos do Actions. Os resumos são informativos: nenhuma contagem é extraída de
logs, o estado e o exit code dos frameworks determinam o gate, e falhas de
escrita de resumo não alteram os resultados. Nenhum serviço externo ou runner
adicional é necessário.

## Durante o desenvolvimento

Execute primeiro o pacote alterado:

```bash
pnpm --filter <pacote> lint
pnpm --filter <pacote> typecheck
pnpm --filter <pacote> test
pnpm --filter <pacote> build
```

Antes de enviar uma mudança, execute `pnpm check`, que já inclui
`pnpm format:check`.

## Cobertura esperada

- primitivas públicas: testes unitários de contrato;
- D1/PostgreSQL e isolamento de tenant: testes de integração reais;
- gerador: conteúdo, segurança do destino e build fora do workspace;
- fluxos de usuário e acessibilidade: Playwright desktop e mobile;
- deploy Levi: smoke GET em `/`, `/admin`, `/api/admin/session`,
  `/api/onboarding`, `/api/churches` e `/api/members` no DEV publicado. Esses
  smokes não comprovam todas as operações PostgreSQL ou Hyperdrive; o preset D1
  e o harness PostgreSQL possuem cobertura própria.

Mocks não substituem os testes de banco existentes. Testes E2E não devem
depender de providers externos para permanecer deterministas.

## PostgreSQL (`pg`)

```bash
pnpm --filter @t00ls-dev/integration-tests test:integration
```

`postgres/database.test.ts` usa PostgreSQL 17 em Testcontainers e cobre o Client
conectado compartilhado com Drizzle, tipos de dados, parametrização,
encerramento e falha de conexão, migration/status/seed e reaplicação pelo
histórico existente. Também valida isolamento de tenant, concorrência e falha
standalone de convites, commit/rollback conjunto de domínio/convites/auditoria e
triggers append-only.

Better Auth é exercitado com fixture PostgreSQL de IDs textuais, verificação de
e-mail, login/sessão/logout, reset e magic link. Os e-mails são capturados em
memória, sem envio real ou alteração dos defaults de autenticação.

O Worker sintético é compilado em memória com a condição `workerd` (necessária
para `pg-cloudflare`) e executado em Miniflare com a data de compatibilidade
`2025-09-01` e `nodejs_compat`.. Invocações distintas criam conexões próprias,
executam queries raw/Drizzle e testam commit/rollback de audit. O binding
Hyperdrive local aponta somente ao container descartável: não exercita o
pooling/cache do serviço nem comprova compatibilidade remota com Hyperdrive.

As fixtures de auth e o SQL audit existente são aplicados somente no container;
nenhuma migration de banco persistente é executada por esse harness.

## Contratos de preparação do workspace

`pnpm test:workspace` verifica manifests privados, dependências locais,
lockfile, links reais e build transitivo com `^build`.

## Levi (`apps/levi`)

A [aplicação](../../apps/levi/README.md) preserva `node:test` via tsx,
PostgreSQL sintético, ACLs restritas, Node/web, dry-run Worker e E2E
desktop/mobile/proxy. O build usa os exports públicos e `^build` dos pacotes
workspace; não depende de publicação npm. A CI separa o Levi dos comandos que
encaminham reporters Vitest para não duplicar ou omitir sua cobertura.

`pnpm test:levi:runtime`, incluído no gate local, executa dry-run Worker,
integração/Worker e E2E com `--runtime-acls`. As tasks normais continuam
cobrindo o modo padrão. Os harnesses criam e removem seus containers,
aplicando/reaplicando migrations somente nesses bancos descartáveis, sem
credenciais persistentes. Nenhum teste ou build aciona o deploy do repositório
original.

`pnpm test:workspace` inclui os contratos de incorporação: árvore e histórico
subtree originais, todos os workspaces privados, oito links locais, grafo de
builds, imports públicos e ausência de Environment/deploy nos jobs Levi. Os
contratos estruturais existentes da CI exigem todos os comandos novos e recusam
falha, cancelamento, omissão, skip, jobs desligados ou gates mascarados.
