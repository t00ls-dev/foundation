# Cloudflare Workers

A composição e os recursos descritos pertencem ao Levi. O fluxo operacional DEV está
no Foundation, conforme o [runbook de deploy](deploy-dev.md).
A incorporação não comprova o estado atual de migrations, ACLs ou feature gates
remotos. Consulte o [README](../README.md) para origem e validação no monorepo.

A aplicação tem composição Cloudflare Workers para DEV, separada do executável
Node local, com Neon PostgreSQL via Hyperdrive. Produção não está implementada.
O escopo de produto
continua em [Decisões do MVP](decisoes-mvp.md); os contratos da API e da SPA estão em
[Onboarding](onboarding-provisionamento.md) e [Interface](interface-onboarding.md).

## Composição

`src/worker.ts` cria a API por invocação e usa os mesmos serviços e adapters do
Node. `src/worker-config.ts` compõe a origem HTTPS, secrets e transporte Resend.
`WorkerEnv` tipa `HYPERDRIVE`, `ASSETS` e as configurações exigidas. O Client
PostgreSQL continua sendo criado por request e encerrado depois do commit/rollback;
não há cliente/auth global compartilhando conexão.

Wrangler usa `src/worker.ts`, compatibilidade `2025-09-01` e `nodejs_compat`, conforme
o padrão examinado do Foundation. O grafo usa `pg-cloudflare` e scrypt nativo do
Better Auth. Não inclui servidor HTTP Node, `src/local.ts`, `src/web.ts` ou migrator.
Módulos Node compatíveis, como `node:crypto`, permanecem nos serviços compartilhados.

`ASSETS` serve `dist/web`, com `run_worker_first: true`: HTML e assets passam pelos
headers de segurança do Hono. As rotas SPA conhecidas usam o documento raiz;
rotas desconhecidas, inclusive `/api` e `/api/*`, mantêm 404, sem fallback de API
para HTML. Não é necessário habilitar o fallback SPA automático da Cloudflare.
`spaPaths` mantém a lista comum aos executáveis Node e Worker.

A política final é `Referrer-Policy: no-referrer`, inclusive após a aplicação dos
headers Foundation. Respostas privadas continuam sem cache. O frontend usa a mesma
origem da API, preservando cookies HttpOnly e os controles existentes de origem/CSRF.

## Configuração DEV

`wrangler.jsonc` é exclusivamente preparatório: nome `levi-dev`, origem pretendida
`https://levi.t00ls.dev`, sem rotas, workers.dev ou previews habilitados. O ID
Hyperdrive composto de zeros é um **placeholder**, não um recurso existente. Nenhum
comando de build publica recursos. `worker:build` sempre usa `--dry-run`.
O processo automático após CI, com guardas e mecanismo de suspensão, está em
[Deploy DEV](deploy-dev.md); `deploy:dev` é o único comando npm de publicação.

| Binding/configuração | Uso                                                                           |
| -------------------- | ----------------------------------------------------------------------------- |
| `HYPERDRIVE`         | Conexão DEV PostgreSQL; configuração remota deve ter query cache desabilitado |
| `ASSETS`             | Build estático da SPA                                                         |
| `LEVI_PUBLIC_ORIGIN` | Origem HTTPS canônica, sem path, configurável no ambiente                     |
| `LEVI_AUTH_SECRET`   | Secret exclusivo DEV, estável, com pelo menos 32 caracteres                   |
| `RESEND_API_KEY`     | Secret exclusivo DEV, somente envio e com domínio restrito quando disponível  |
| `LEVI_EMAIL_FROM`    | Remetente de domínio/subdomínio verificado                                    |

Não há allowlist de destinatários no DEV público. O módulo de membros está
disponível para todas as organizações, preservando autorização por usuário e
isolamento; ver [Gestão de membros](gestao-membros.md#habilitação-e-limites).
`.dev.vars.example` contém somente nomes vazios; arquivos locais com valores são
ignorados. Configuração incompleta resulta em 503 sanitizado antes de acessar
banco/provider.

O contrato local `@t00ls-dev/email` fornece `createResendEmail`, usando
fetch HTTPS. Não há SDK adicional. Mantêm-se os dois e-mails, callbacks fixos e
validação de tokens no Better Auth. Não há envio na transação de provisionamento.
Um aceite HTTP do Resend não comprova entrega ao destinatário.

O arquivo Wrangler não configura cache de consultas: essa opção pertence ao
recurso Hyperdrive remoto. **É obrigatório desabilitá-lo e conferir a configuração
efetiva antes de publicar**, para que sessões e memberships revogados não sejam
lidos de cache. O runtime não consegue atestar essa opção a partir da connectionString.

O DEV existente usa Neon PostgreSQL 18.6; o harness descartável fixa PostgreSQL
17.11. A runtime usa Hyperdrive com origem direta e role separada da migradora.
O runner administrativo usa conexão direta, fora do Hyperdrive. Não habilitar auth gerenciado do provedor nem reutilizar
banco/secrets do Foundation. A identidade continua no schema do Levi.

## Desenvolvimento e validação local

O fluxo Node/Vite permanece em `pnpm dev` e `pnpm start`, conforme o guia de
onboarding. Não foi alterado para aceitar URLs remotas. Para validar o Worker:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm worker:build
ppnpm test:integration
ppnpm test:worker
ppnpm test:e2e
```

`worker:build` faz bundle e dry-run reais do Wrangler, grava `dist/worker` e
metafile em `.local/`. Não envia o Worker/Static Assets. `test:worker` exige Docker
e Linux para a medição de recursos: cria PostgreSQL descartável com a imagem fixada
do harness, prepara explicitamente o schema **somente sintético**, executa o bundle
Wrangler em Miniflare/workerd e remove o container ao terminar.

Miniflare está fixado na mesma versão transitiva usada pelo Wrangler instalado
(`5.20261006.1-alpha` com Wrangler `4.149.0`). A API pública de conversão de opções
mantém o harness explícito; o router de assets declara a presença do user Worker.
Nenhum código do Foundation é modificado ou copiado como infraestrutura do Levi.

Os testes usam bindings sintéticos e interceptam somente a saída Resend no host:
não existe endpoint de captura no app e nenhuma mensagem sai para a Internet.
O resto do fluxo usa auth/Drizzle/pg reais. São cobertos assets, navegação SPA/API,
headers, cookies Secure/HttpOnly/SameSite, callbacks, dois e-mails, conta sem senha,
login/logout, isolamento, roles, revogação, idempotência e concorrência. Falhas reais
de auditoria e recibo fazem rollback observado por outra conexão. Banco vazio
continua vazio depois de iniciar/consultar o Worker.

`worker:dev` executa somente Wrangler local, sem request logs. Exige configuração
local privada e conexão Hyperdrive local sintética, com origem HTTPS coerente se
exercitar cookies no navegador. O harness automatizado já injeta esses bindings;
não usa arquivos com secrets nem precisa de conta Cloudflare. Não usar modo remoto
como substituto desses testes. O Node/Vite continua sendo a superfície manual
local com captura em `.local/mail/`.

### Medições

`test/worker-resources.ts` consulta o inspector do user Worker apenas para totais
do heap V8, sem snapshots. Lê CPU de processo e RSS do processo filho workerd via
`/proc` no host Linux, e mede latência de requests reais de definição de senha e
login, incluindo duas autenticações concorrentes. Os parâmetros criptográficos
nativos permanecem N=16384, r=16, p=1, dkLen=64.

Os agregados ficam em `.local/worker-metrics.json`, sem tokens, contas ou hashes.
CPU de processo inclui overhead do runtime e tem resolução do relógio de ticks;
não é CPU faturada Cloudflare. RSS/alto-water mark inclui runtime e workers de
assets, e não equivale à memória de um isolate. Heap V8 não cobre toda memória
nativa de scrypt. As medições locais não certificam os limites remotos de CPU/memória.
O plano Free de 10 ms por request não deve ser presumido adequado ao login.

## Migrations DEV explícitas

`db:generate` usa Drizzle para gerar SQL, snapshot e journal versionados; revisar o
diff e criar migration posterior, sem editar 0000–0003 já aplicadas no DEV.
`db:migrate` conserva o guard de banco local. `db:migrate:dev` é administrativo,
independente do Worker, build, CI e deploy. Nenhum push aplica migrations remotas.

O padrão PostgreSQL público do Foundation fornece factory, status e integração
Drizzle; o coordenador expand/backfill/contract do Links é D1 e não é copiado.
`tools/migration-history.ts` acrescenta uma verificação do prefixo aplicado:
ordem, timestamps e SHA-256 dos SQLs devem corresponder ao journal versionado.
Lacunas, duplicações, registros desconhecidos e hashes divergentes interrompem a
operação. Não cria journal auxiliar, não reconcilia nem repara divergências.

Antes de cada operação autorizada, o operador configura privadamente:

- `LEVI_DEV_DATABASE_URL`: endpoint direto Neon, `sslmode=verify-full`;
- `LEVI_DEV_DATABASE_HOST`: hostname exato esperado;
- `LEVI_DEV_DATABASE_NAME`: `levi_dev` ou prefixo `levi_dev_`;
- `LEVI_DEV_MIGRATION_CONFIRMATION`: `CONSULTAR:<host>/<banco>` para
  `pnpm db:status:dev`, ou `APLICAR:<host>/<banco>` para
  `pnpm db:migrate:dev --through TAG`.

Não há carregamento automático de `.env`. Não copiar credenciais privadas para o
projeto ou CI. O runner exige role `levi_dev_migrator`, senha, porta padrão, endpoint
`ep-...neon.tech` sem `-pooler` e sem parâmetros extras. Reconfirma banco,
`current_user` e `session_user` migradores e schema `public`.
O status roda em `BEGIN READ ONLY` e termina com `ROLLBACK`, sem criar objetos,
inclusive em banco vazio. O modo de aplicação usa advisory lock não bloqueante,
confere o histórico, aplica pelo Drizzle e reconsulta hashes/status. O SQL e as
revisão selecionada são transacionais pelo migrator PostgreSQL Drizzle. O runner
exige `--through TAG` e aceita exclusivamente a primeira revisão pendente, usando
um journal temporário com o prefixo autorizado. Não salta nem reaplica revisões.
Sem seleção, falha antes de conectar. Novas revisões exigem classificação na
lista operacional; conversão e contract continuam fora do journal. Consulte o
[corte estrutural](deploy-dev.md#corte-estrutural--etapa-7).

O runner não identifica sozinho projeto/branch Neon nem comprova integridade de
cada objeto. Um preflight continua necessário: identidade completa por metadados
autorizados, dependências/ownership/ACLs/colisões, locks, timeouts proporcionais e
recurso de recuperação realmente disponível. O runner não fixa timeouts por
conta própria; definir limites de sessão compatíveis em procedimento autorizado,
sem alterar persistentemente o servidor. Consultar status não autoriza DDL.

Registrar UTC e LSN antes de uma aplicação não cria backup nem reserva histórico.
A janela Neon observada foi de seis horas, móvel; reconfirmar disponibilidade e
margem no momento de cada operação. Visualização de estado anterior não comprova
restauração testada; não há garantia de RPO/RTO. Restauração integral pode perder
gravações posteriores legítimas e exige decisão e autorização específicas.
Após erro/resultado incerto, consultar journal e catálogos em conexão nova antes
de qualquer decisão. Não repetir automaticamente, editar journal ou desfazer
DDL/dados de forma destrutiva.

## Roles e ACLs mínimas DEV

`levi_dev_migrator` é proprietária do schema composto e aplica DDL explicitamente;
não vai para Hyperdrive ou workflow de publicação. `levi_dev_runtime` é o login de
aplicação, sem ownership, CREATE/TEMP, superuser, BYPASSRLS, grant option ou
membership privilegiada. GRANTs são operações autorizadas separadamente, sem
default ACL ampla para novas tabelas.

O incremento original de cadastro de membros contém cinco comandos, sete grupos e 45 pares
coluna/privilégio. A especificação executável usada apenas pelo harness é
`memberGrants` em [runtime-acl-fixture](../test/runtime-acl-fixture.ts);
não executar o preparo de roles dessa fixture no DEV.

| Tabela                   | Privilégio | Colunas                                                                                                                     |
| ------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| members                  | SELECT     | id, tenant_id, church_id, name, status, birth_date, phone, email, joined_on, address, baptism_date, church_role, created_at |
| members                  | INSERT     | mesmas 13 colunas                                                                                                           |
| member_history           | INSERT     | id, tenant_id, member_id, actor_id, church_name, initial_status, created_at                                                 |
| member_creation_requests | SELECT     | tenant_id, actor_id, request_key, request_hash, member_id                                                                   |
| member_creation_requests | INSERT     | mesmas cinco colunas                                                                                                        |
| churches                 | UPDATE     | created_at                                                                                                                  |
| tenant_memberships       | UPDATE     | created_at                                                                                                                  |

A leitura de `members` cobre listagem, ficha e `INSERT ... RETURNING`. Histórico
não tem RETURNING nem SELECT direto; recibos têm consulta e INSERT sem retorno de
colunas extras. UUIDs usam defaults PostgreSQL, sem sequência nessas três tabelas.
Não acrescentar SELECT em histórico/auditoria ou DELETE, TRUNCATE, REFERENCES,
TRIGGER, MAINTAIN e UPDATE geral ao incremento. As ACLs legadas de auth, tenancy,
auditoria INSERT e contadores permanecem separadas, representadas por
`legacyRuntimeGrants` na mesma fixture.

### Incremento de interface e edição, pendente de operação

A migration [0004](../migrations/0004_interface-e-edicao.sql) acrescenta contatos
opcionais à igreja, versão do membro e histórico pessoal de edição. Aplicar
somente em ação administrativa autorizada, após conferir identidade, backup,
histórico 0000–0003 e hashes. Não integrar sua execução ao deploy ou startup.

Depois de 0004, aplicar separadamente as quatro instruções de
[interface-e-edicao-acls.sql](../ops/interface-e-edicao-acls.sql):

| Tabela                 | Privilégio      | Colunas                                                                                |
| ---------------------- | --------------- | -------------------------------------------------------------------------------------- |
| members                | SELECT e INSERT | version                                                                                |
| members                | UPDATE          | name, birth_date, phone, email, joined_on, address, baptism_date, church_role, version |
| member_profile_history | INSERT          | id, tenant_id, member_id, actor_id, version, previous_profile, created_at              |

São 18 pares adicionais, totalizando 63 com o incremento original. O INSERT de
`version` é necessário porque Drizzle inclui a coluna com DEFAULT na instrução
de cadastro. A API não aceita a versão no cadastro. O UPDATE por coluna é
necessário para a edição e o lock; não concede alteração de IDs, tenant, igreja,
situação ou criação. Não adicionar grant option, SELECT de histórico, UPDATE
amplo, DELETE ou funções privilegiadas. As ACLs legadas SELECT/INSERT de igrejas
já cobrem seus contatos; não há grant adicional nessa tabela.

O harness lê esse mesmo artefato somente após migrar seu banco sintético e testa
os 63 pares, autoria dos grants e negações reais. Isso não prova aplicação no DEV.
Nesta entrega nenhuma migration/ACL persistente, configuração, habilitação ou
publicação foi executada. Antes de uma futura publicação autorizada, conferir
0004 e os grants; membros habilitados com schema antigo falham fechados. O caminho
de onboarding apenas com nome e as consultas de igrejas continuam funcionando
com o schema anterior, retornando contatos nulos. Preencher contatos exige 0004.
Não usar essa compatibilidade como autorização de deploy.

`SELECT FOR SHARE` exige UPDATE em alguma coluna. A migration 0003 protege
`churches`/`tenant_memberships` com função `SECURITY INVOKER`,
`search_path=pg_catalog` e triggers `BEFORE UPDATE FOR EACH STATEMENT`:
`current_user = 'levi_dev_runtime'` recebe `42501` mesmo sem linhas ou num no-op.
SELECT com lock não dispara UPDATE. Não ampliar ownership, TRIGGER, acesso a outras
roles ou `session_replication_role`. Funções SECURITY DEFINER que mudem identidade
efetiva precisam de revisão: não presumir proteção contra um novo caminho
privilegiado. Detalhes e provas descartáveis no [guia de membros](gestao-membros.md#proteção-do-update-necessário-ao-lock-no-dev).

ACLs restringem operações, mas não filtram tenants: não há RLS implementada.
Sessão, prontidão, membership administrativa atual e filtros organizacionais
continuam obrigatórios no Levi, usando os contratos do Foundation. Contato de
membro não é conta; função eclesiástica não concede autoridade. Dados religiosos,
histórico, auditoria e backups exigem finalidade, retenção e governança antes
de qualquer uso real.

## Operação DEV

O ambiente preparado é DEV público: sem Cloudflare Access ou allowlist de
endereços. Consultar [Deploy DEV](deploy-dev.md) para recursos, CI automática,
secrets, habilitação e guardas do SHA/Hyperdrive. O mecanismo de suspensão é
`DEPLOY_READY=false` no Environment `levi-dev`; somente pré-requisitos conferidos
e autorização específica permitem publicação manual pelo Foundation.

Banco/roles exclusivos, TLS, migrations administrativas explícitas, Hyperdrive
sem cache, remetente verificado e tracking desabilitado são pré-requisitos.
O histórico inclui os contadores duráveis de abuso; sua ausência bloqueia a API
pública com falha fechada. A inicialização nunca aplica migrations.

A composição Worker reutiliza o rate limiter Foundation com PostgreSQL e quotas
por cliente/destinatário/globais descritas no guia de deploy. Node local não
confia em headers Cloudflare. Mecanismos contra abuso complementam sessão e
membership; não concedem acesso anônimo aos dados de organizações.

Validar remotamente os dois e-mails, links/callbacks HTTPS, senha e login/logout,
provisionamento, isolamento, revogação e consumo CPU no Workers Free. Não reduzir
scrypt para caber no plano. Logs de invocação e traces continuam desabilitados:
URLs de auth contêm credenciais temporárias. Erros permanecem sanitizados.

Nenhum recurso remoto ou entrega Resend é comprovado por testes Miniflare ou
build/dry-run. Hyperdrive local conecta ao container e não reproduz cache/pooling
distribuído. A publicação depende de acesso administrativo aos provedores.
