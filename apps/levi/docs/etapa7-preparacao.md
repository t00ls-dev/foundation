# Preparação técnica da etapa 7 DEV

Esta preparação não executa nem autoriza o corte. Base operacional: investigação
`levi-etapa7-investigacao-preparacao-dev-2026-10-30.md` e procedimento
`levi-etapa7-procedimento-controlado-dev-2026-10-30.md`, sob custódia em
`/home/admin/ai_reports/foundation/`. O [fluxo de deploy](deploy-dev.md#corte-estrutural--etapa-7)
e os gates existentes permanecem obrigatórios. Não há SQL no publicador.

## Capacidade temporária dos smokes

O input booleano `maintenance_smoke` do workflow tem default `false`. Nesse modo
normal, nenhuma capacidade acompanha requests, mesmo se houver valor residual
no ambiente do executor. Com `true`, o step de publicação recebe exclusivamente
do Environment `levi-dev` o secret temporário `LEVI_SMOKE_CAPABILITY`. O executor
exige 64 caracteres hexadecimais minúsculos antes de consultar APIs ou fazer
upload. O custodiante deve gerar 32 bytes aleatórios, sem reutilizar credenciais.
O formato valida transporte, não comprova a aleatoriedade do valor.

O header `X-Levi-Smoke-Capability` acompanha somente os seis GETs finais, depois
da confirmação da versão nova com 100% do tráfego:

| Caminho exato                    | Aceite preservado                    |
| -------------------------------- | ------------------------------------ |
| `/`                              | 200, HTML                            |
| `/admin` e `/api/admin/session`  | 404, no-store                        |
| `/api/onboarding`                | 200, JSON exato `{ etapa: "email" }` |
| `/api/churches` e `/api/members` | 401                                  |

CSP e Referrer-Policy continuam exigidos; redirects não são seguidos. A
capacidade não vai a APIs GitHub/Cloudflare, subprocesso Wrangler, bundle,
arquivo de secrets do Worker ou summary. É removida do ambiente do processo
após leitura; os headers permanecem apenas em memória até os smokes. Falha após
upload não autoriza repetir publicação. Não há bypass na aplicação.

Antes do futuro dispatch, o custodiante precisa criar secret/regra sob
autorização específica e comprovar M0/M1. A exceção à regra de manutenção deve
exigir simultaneamente host `levi.t00ls.dev`, HTTPS, capacidade exata, GET, path
exato da tabela, ausência de query, Cookie e Authorization. Não liberar acesso
por prefixo, cookie válido, User-Agent, Origin ou ranges genéricos de runners.
Não usar Skip para retirar outras proteções. Desabilitar cache para esse acesso
e demonstrar chegada ao candidato; resposta antiga em cache não é smoke.
Confirmar bloqueio de paths codificados/normalizados e das entradas alternativas.
Não registrar o header em WAF events, traces ou logs de requisição; validar a
política de redação com o custodiante antes de provisionar a capacidade.

M0 bloqueia todas as entradas antes do Worker. M1 permite apenas a exceção
acima; não libera DML funcional, login/callbacks ou validadores. M2, após
contract, exige autorização própria para identidades, IPs e envios sintéticos.
Criar/remover regras e secret, dispatch e os efeitos técnicos dos smokes
(contadores SQL) continuam pendentes de autorização. Ao encerrar, revogar a
capacidade e retirar a exceção sob o procedimento aprovado.

Na modalidade DEV de indisponibilidade aceita, M0/M1 e a capacidade são
dispensados. O workflow oficial é executado com `NOLOGIN`; a falha dos smokes
nessa condição não é tratada como sucesso, e os mesmos seis GETs são repetidos
após `db:cutover:resume`, antes de considerar a validação concluída.

## Cliente de leitura e preservação

Em checkout revisado, já compilado e com as dependências existentes, o operador
pode usar `pnpm --filter levi exec tsx tools/etapa7-readiness.ts`. Não integra
CI, startup ou deploy. Não aceita SQL/URL por argv. Credenciais somente no
ambiente privado, sem tracing, arquivo no checkout, histórico de shell ou logs.
Usa as variáveis e a confirmação `CONSULTAR:<host>/<banco>` do
[cliente DEV existente](cloudflare-workers.md), inclusive TLS `verify-full` e
role migradora. O alvo adicional é fixo:

- projeto `divine-violet-20368018`, branch `br-dawn-base-b68erh5e`;
- endpoint `ep-morning-wildflower-b6hjki5i`;
- host `ep-morning-wildflower-b6hjki5i.c-2.sa-east-1.aws.neon.tech`;
- banco `levi_dev`, session_user/current_user `levi_dev_migrator`.

O cliente configura somente sua sessão com `default_transaction_read_only=on`,
timeouts de statement (15s), lock (2s) e idle transaction (30s).
Cada checkpoint abre conexão nova, inicia REPEATABLE READ READ ONLY, confere
identidade pelas GUCs Neon e fecha com ROLLBACK, inclusive após erro. Divergência,
GUC ausente, revisão desconhecida, hash/timestamp divergente ou fase inesperada
bloqueia. Não há override de identidade nem ferramenta mutadora.

A primeira leitura exige journal 0000–0006 e guarda baseline apenas na memória.
Antes de avançar, aguarda no stdin os checkpoints `expand7`, `expand8`,
`converted`, `contracted`, ou `sair`. As conexões ficam fechadas durante a espera.
O operador executa as operações autorizadas em outro cliente, separadamente.
O verificador não as inicia. `converted` pressupõe conversão **e** ACLs completas.
Não usar depois de iniciar testes funcionais: estes alteram legitimamente a base.

[etapa7-verification.ts](../tools/etapa7-verification.ts) compara registros
canônicos completos de auth, igrejas, membros, históricos, recibos, flags,
auditoria, administração e legado. Normaliza apenas as colunas transformadas,
verificando separadamente os escopos antigos e novos. Compara admin/papel/data,
seleções inequívocas e flags com EXCEPT ALL nos dois sentidos. Antes do contract,
zero DML funcional novo; após ele, arquivo e mapa igreja/organização exatos.
Contadores de abuso são excluídos da preservação, pois os smokes os alteram.

A saída de preservação contém tabela e indicador `differences` (0 igual, 1
conjunto divergente), sem registros, hashes de credenciais ou digests pessoais.
Resultados das diferenças SQL são contagens. O processo precisa de custódia:
contém dados sensíveis em memória; não capturar heap/core dump nem depurá-lo em
ambiente compartilhado. Encerrar perde o baseline. Não persistir esses dados
como solução improvisada, nem recomeçar de uma base modificada para apagar uma
divergência. Perda do processo exige nova estratégia de comparação aprovada.

[acl-checks.sql](../ops/etapa7/acl-checks.sql) verifica permissões efetivas,
inclusive grants de tabela que sobrepõem restrições por coluna: ausência de DDL,
TRUNCATE, ownership, membership runtime e DELETE indevido; legado sem acesso;
colunas críticas e grants novos obrigatórios. O verificador também exige owners,
constraints e índices válidos, PK do recibo e triggers/funções de contract.
[catalog.sql](../ops/etapa7/catalog.sql) produz a matriz sanitizada de tabelas,
colunas, schemas, sequências, funções/SECURITY INVOKER/search_path, PUBLIC, grant
options, memberships, default ACLs, índices, constraints e triggers. Sem query
text, IP de cliente ou dados de domínio.

**Aceite do catálogo exige revisão operacional:** conferir os grants de auth e
administração e cada definição contra os SQLs do SHA escolhido; ausência de
objetos extras, grants por coluna de PUBLIC, grant options de funções/sequências
e default ACLs amplas. Os checks automáticos cobrem as negações e colunas
explicitadas no SQL; não são um provador universal de ACLs/schema. Tabelas
adicionais, estado parcial ou permissões não classificadas bloqueiam a decisão,
mesmo com checks automáticos verdes. Não executar DML exploratório no DEV.

## Contenção e drenagem

O inventário de 30/10 registrou migrator/runtime sem superuser, CREATEROLE ou
memberships. Isso não demonstrava autoridade para mudar LOGIN de outra role nem
sinalizar seus backends. PostgreSQL 18 exige CREATEROLE + ADMIN OPTION aplicáveis
para esse ALTER ROLE por não superuser; encerrar backends depende de autoridade
sobre a role ou `pg_signal_backend`, com restrições para superusers.
Referências: [ALTER ROLE](https://www.postgresql.org/docs/18/sql-alterrole.html)
e [funções administrativas](https://www.postgresql.org/docs/18/functions-admin.html).

### Janela de indisponibilidade aceita — Levi DEV

Exceção exclusiva do Levi DEV, registrada pelo responsável: não há usuários reais,
novas operações estão suspensas durante a janela, indisponibilidade temporária
aceita e WAF dispensado. A exceção não altera produção, não autoriza reset ou
contract e não dispensa a identidade do banco, a barreira de escrita nem a
validação posterior.

A barreira efetiva é `levi_dev_runtime`, operada por `neondb_owner` com
`CREATEROLE`, `ADMIN OPTION` sobre a runtime e `pg_signal_backend`:

1. `pnpm --filter levi db:cutover:status` confere identidade Neon, privilégios,
   uso da runtime em todos os bancos, transações/locks/prepared e estado de LOGIN.
2. `pnpm --filter levi db:cutover:prepare` exige runtime sem privilégios, uso
   somente em `levi_dev`, zero transações/locks/prepared; executa
   `ALTER ROLE levi_dev_runtime NOLOGIN`, termina somente backends runtime de
   `levi_dev`, confirma zero backends e então executa `converter.sql`,
   `runtime-acls.sql` e a verificação de journal, ACLs e preservação. A barreira
   permanece em qualquer falha.
3. Executar o workflow oficial **com a runtime ainda NOLOGIN**. O upload não usa
   SQL; confirmar versão/SHA/tráfego. Se os smokes finais falharem apenas por
   `NOLOGIN`, não repetir upload. Aguardar 30 s após a versão nova ativa para
   terminar requests antigos em voo.
4. `pnpm --filter levi db:cutover:resume` restaura somente `LOGIN` e exige zero
   backends/transações. Validar os seis GETs, headers e diagnóstico oficial.
5. Se conversão ou ACL falhar, manter `NOLOGIN` e o app indisponível; corrigir de
   forma compatível revisada ou restaurar sob autorização. Não executar reset,
   contract ou down migration.

Nesta janela DEV, o ensaio completo de restauração é dispensado pelo aceite
registrado; a custódia da versão anterior, o ponto de decisão e a proibição de
perda silenciosa permanecem. Produção mantém a exigência de restore demonstrado.
O executor é `tools/etapa7-cutover-dev.ts`; não há SQL destrutivo nele.
Credenciais e confirmações ficam somente no ambiente privado:
`LEVI_DEV_ADMIN_DATABASE_URL`, `LEVI_DEV_CUTOVER_CONFIRMATION` com
`PREPARAR|RETOMAR|CONSULTAR:<host>/levi_dev`, além de `LEVI_DEV_DATABASE_*` e
`LEVI_DEV_MIGRATION_CONFIRMATION=APLICAR:<host>/levi_dev`.

Fora desta janela, o mecanismo operacional continua bloqueado até o custodiante
comprovar:

1. M0 em todas as entradas, publicadores coordenados e ausência de outros
   invocadores/escritores. Telemetria aplicável da versão antiga cobrindo cada
   request aceito antes de M0, seus I/Os e trabalho posterior à resposta, até
   seu término real. Amostra, ausência de logs ou espera arbitrária não bastam.
2. Operador autorizado com privilégios existentes para barreira de banco, ou
   mecanismo equivalente comprovado. Se for usada barreira por role: inventariar
   uso em **todos os bancos**, registrar LOGIN original, memberships e escopo,
   suspender apenas runtime sob autorização e verificar em conexão independente.
3. Após espera graciosa e autorização específica, selecionar somente backends
   `levi_dev_runtime` de `levi_dev`, reconferindo PID + backend_start + identidade
   imediatamente antes da ação, para impedir reuso de PID. Confirmar término
   efetivo, sem tratar sinal enviado como término. Nunca terminar outros alvos.
4. Verificar zero backends runtime, transações/locks de aplicação e prepared
   transactions, além da prova externa de término dos requests. State NULL por
   visibilidade limitada é desconhecido, não ocioso. A amostra READ ONLY usa
   snapshot e não certifica exclusividade futura.
5. Manter M0; restaurar somente LOGIN original após prova de drenagem e banco
   compatível, antes de M1/publicação. Qualquer reconexão anterior inesperada
   interrompe. Confirmar via conexão nova, sem devolver privilégios adicionais.

NOLOGIN não encerra sessões autenticadas; término de sessões sem impedir nova
entrada não contém reconexões; o pool Hyperdrive pode conservar backends. O
ensaio local mostra trabalho pendente abrindo conexão **depois** de uma amostra
vazia. Nenhum desses sinais prova término HTTP. O Worker antigo não oferece
instrumentação suficiente comprovada. Se o custodiante não fornecer mecanismo
aplicável, bloquear o corte e preparar uma alteração específica na versão
compatível com legado, com autorização separada para sua publicação. Não
publicar o candidato novo no banco antigo para obter essa instrumentação.

## Ensaio descartável

Após build e `worker:build`, executar:

```bash
pnpm --filter levi exec tsx tools/test-integration.ts --etapa7 --runtime-acls
```

O harness preserva as guardas de loopback/banco/role e cria/remove seu próprio
container PostgreSQL 17, sem credencial persistente. O ensaio também integra
`test:integration --runtime-acls` no gate oficial e na CI existente. Não cria
recursos Neon/Cloudflare nem chama e-mail externo.

A fixture nasce no journal 0000–0006 com usuário verificado, senha, sessão,
igreja/admin, membro, histórico, recibo e auditoria sintéticos. Aplica 0007 e
0008 separadamente; confere preservação em conexões novas; ensaia erro e rollback
da conversão; converte/aplica ACLs; executa os seis smokes no Worker compilado
antes de contract. Um modelo local M1 rejeita demais caminhos, métodos, query,
Cookie, Authorization e ausência da capacidade antes de chamar o Worker.
Esse modelo é especificação testada, **não execução nem certificação de WAF**.

Depois de contract confere preservação, triggers e ACLs; testa senha anterior,
seleção/criação de igreja, proteção do último admin e SQL proibido à runtime.
Há detecção de identidade e escrita em READ ONLY; reconciliação de commit em
conexão nova. Perda real do ACK de COMMIT/upload, pooling remoto e encerramento
de invocações Cloudflare não são simulados. Os ensaios existentes de igrejas
complementam organizações vazias/ambíguas, flags, isolamento e concorrência.

## Recuperação do par Neon/Worker

Antes do corte, registrar sob custódia: responsável/decisor, T0 após última
escrita legítima drenada, ponto **recuperável** demonstrado pelo Neon, limite da
retenção, todos os bancos afetados, RPO/perda autorizada e RTO medido até o
retorno validado do aplicativo. Timestamp/LSN SQL e janela nominal de seis horas
não reservam histórico nem provam restore. O custodiante comprova tipo/root e
autoridade; instant restore se aplica à branch inteira e cria backup automático.
Ver [Neon: instant restore](https://neon.com/docs/postgres/backup-restore/branch-restore).
Sem essa evidência aplicável, não iniciar DDL.

Registrar o Worker antigo candidato `c9f488db-04ed-40c2-9f55-c2130944aebd`, SHA,
Assets, bindings, secrets sob custódia e elegibilidade efetiva para rollback.
A existência desse UUID no relatório não prova sua disponibilidade futura.
O custodiante deve validar a operação separada e o comportamento dos recursos
conectados conforme [Cloudflare: rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
O publicador normal permanece limitado à master atual e à continuidade entre
versão ativa/última enviada; não retirar esses gates para recuperar.

| Estado confirmado da falha      | Decisão preparada                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Antes de DDL                    | Preservar estado; reverter somente barreiras autorizadas após reconciliação                               |
| Transação sem commit confirmado | ROLLBACK quando controlável; conexão nova para reconciliar. ACK perdido é estado indeterminado, sem retry |
| Só expansão confirmada          | Pode permanecer; antigo só após provar que conversão/ACLs não começaram e compatibilidade permanece       |
| Conversão ou ACLs confirmadas   | M0; correção compatível revisada ou recuperar banco T0 + Worker antigo como par                           |
| Upload/smoke incerto            | Consultar deployment/UUID/SHA/tráfego/bindings; não repetir upload cegamente                              |
| Contract ou DML novo confirmado | Sem down; correção compatível ou restore integral aprovado, com perda explicitamente aceita               |

Para recuperar, declarar gatilho/autorização e manter M0/publicadores contidos;
comprovar drenagem novamente. O custodiante Neon executa apenas o mecanismo já
aprovado, incluindo escopo de todos os bancos e custódia do backup automático.
Reconferir identidade resultante, TLS, journal/schema/dados/ACLs de T0 e atributos
de role separadamente; restore pode mudar IDs de branch, e o cliente fixo deve
recusar essa divergência até revisão explícita, sem override oportunista.
Posicionar a versão antiga compatível com Assets/configuração comprovados e
100% do tráfego, ainda sob M0. Restaurar conectividade somente após excluir
requests incompatíveis pendentes; usar smokes próprios da versão recuperada,
login sintético, membros e auditoria. Liberar somente após reconciliação e
registrar tempos/perdas. Não reiniciar Hyperdrive, criar branch, redirecionar
binding ou apagar backup como improviso.

Localmente foram validados transformação, preservação, rollback SQL conhecido,
reconciliação por conexão nova, código novo e permissões em dados sintéticos.
**Não foi ensaiado restore Neon nem rollback da versão antiga/Assets/secrets.**
A recuperação do par real, o RTO, a barreira privilegiada, M0/M1 remotos e a prova
de término dos requests permanecem dependentes de evidência dos custodiantes e,
para qualquer mutação/recurso/dispatch, de autorização específica. O baseline
em memória é comparador, não backup e não substitui prova de recuperação.
