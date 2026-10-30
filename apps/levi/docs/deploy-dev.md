# Deploy DEV público

Este documento descreve o publicador manual do Foundation para `apps/levi`.
A transferência do Levi DEV foi concluída; o Foundation é o publicador autorizado.
O histórico incorporado permanece preservado. A cópia histórica em
`apps/levi/.github` não é executada como workflow raiz.

O [workflow Deploy Levi DEV](../../../.github/workflows/deploy-levi-dev.yml) utiliza
os cadastros do Environment `levi-dev`. Esta revisão padroniza seus nomes, mas não
altera cadastros reais, secrets, gates ou recursos. Antes de qualquer execução da
nova definição, realizar a [migração administrativa dos nomes](#migração-administrativa-dos-nomes)
sob autorização própria. Merge e publicação exigem autorizações separadas.

O alvo permanece Worker `levi-dev`, domínio `https://levi.t00ls.dev`, PostgreSQL/Neon,
Hyperdrive e e-mail próprios. Nenhum recurso é transferido ou recriado pelo código
de preparação. Não há deploy do Links, migrations, Release ou dependência de
publicação npm nesse workflow. Produção permanece fora deste procedimento.

## Diagnóstico Cloudflare somente leitura

O [workflow manual de diagnóstico](../../../.github/workflows/diagnose-levi-cloudflare.yml)
é independente do publicador. **Sua preparação não autoriza integração ou execução:**
primeiro revisar/integrar e depois executar somente sob autorização correspondente.
Não usar o workflow de deploy, o Smoke Hyperdrive de outro produto, uma branch de
PR ou a credencial local revogada para testar acesso.

O diagnóstico usa somente o Environment **levi-dev do Foundation**, preservando sua
política de master. Não pode consultar os secrets do original: `levi/dev` continua
com `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_READ_TOKEN` **não testados** por esse fluxo.
Não copiar esses valores ao Foundation nem inferir igualdade entre cadastros.

Após integração e autorização, selecionar master e informar `execution_sha` igual
ao SHA completo desse checkout. O input `token_type` define a rota de autenticação:
`user` para `/user/tokens/verify` ou `account` para
`/accounts/{account_id}/tokens/verify`, conforme metadados conhecidos do cadastro.
Não há fallback de tipo/identidade após falha. O workflow exige ref/master,
repositório Foundation e SHA exato; checkout não persiste credenciais e setup Node
ocorre antes do step que recebe secrets. Não instala dependências, importa o app
ou executa Wrangler; usa apenas Node e código integrado no repositório.

O runner lê `CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_API_TOKEN` do Environment e os IDs
já cadastrados em variables. Não exige abrir LEVI_DEPLOY_READY nem altera esse gate.
É permitido diagnosticar com LEVI_DEPLOY_READY=false; isso não habilita publicação.

As chamadas são exclusivamente GET à API HTTPS Cloudflare, com timeout, sem retry
ou redirects: autenticação, configuração Hyperdrive, metadados do Worker,
domínio esperado, zona/rotas e versões/deployments. A listagem de versões é limitada
às cinco mais recentes; consulta detalhes das versões ativas e até três recentes,
no máximo cinco versões distintas. Reconsulta deployment e última enviada para
indicar consistência do snapshot, sem coordenar ou impedir outro publicador.

A saída JSON nos logs identifica o cadastro testado, status HTTP e resultados
fechados, UUIDs de deployment/versão, tráfego e tags SHA válidas. De bindings e
Hyperdrive emite somente verificações booleanas (`null` quando um campo opcional
não foi informado), sem valores de secrets,
remetente, seleção de organizações, usuários ou payload integral. Não cria
artifacts, caches, arquivos de credenciais ou summary com dados brutos.
Distingue 401, 403, 404, 429/5xx, erro de rede e resposta incompleta. Uma falha em
um GET não muda a credencial nem impede registrar consultas independentes.

`ok=true` significa autenticação ativa, consultas reconhecidas e snapshot estável;
**não atesta prontidão de deploy, igualdade entre secrets, ausência de divergências
de configuração nem recuperação homologada**. As verificações booleanas precisam
ser lidas individualmente. Tráfego dividido ou uma versão enviada sem tráfego são
registrados sem correção automática. Versões anteriores consultáveis são somente
candidatas: recuperar exige comprovar Assets/recursos/configuração e obter
outra autorização. Credenciais de escrita não são testadas com chamadas de escrita.

Se houver 401, registrar somente o cadastro testado como rejeitado; 403 indica
negação da consulta específica e 404 não deve ser tratado como invalidação global
da credencial. Falhas transitórias não autorizam trocar token ou abrir gates.
Não repetir automaticamente. Nenhum erro, header Authorization, fingerprint,
texto remoto arbitrário ou valor de credencial deve ser anexado a logs/relatórios.

## CI, identidade e publicação

A [CI raiz](../../../.github/workflows/ci.yml) valida PRs e pushes em master,
incluindo os gates do Foundation e os jobs próprios Levi de
PostgreSQL/ACLs/Worker/E2E. O agregador `checks` exige
sucesso de todos os jobs de validação; falha, cancelamento, omissão e skip indevido
bloqueiam o resultado. CI não recebe Environment ou secrets operacionais do Levi.

O publicador aceita **somente workflow_dispatch**, selecionando `master`, sem
input SHA. O SHA imutável do evento (`github.sha`) é capturado internamente. O job validate, sem Environment,
reutiliza o [validador raiz](../../../.github/scripts/ci-evidence.mjs): exige
`t00ls-dev/foundation`, ref master, CI canônica de push/master concluída com
success no SHA exato e `checks` aprovado na tentativa atual. A conclusão global
inclui Version Packages. Não aceita evidência de PR/fork, CI incompleta ou antiga,
nem baixa artifacts de PR. A instalação/build só ocorrem após essa validação.

O job deploy recebe o SHA validado, usa setup pnpm/Node da raiz, instalação
`pnpm install --frozen-lockfile` e `pnpm exec turbo run build --filter=levi`.
O grafo `^build` compila os sete pacotes workspace antes do aplicativo pelos
exports públicos. O operador executa com cwd `apps/levi`.

O [ci-evidence Levi](../tools/ci-evidence.ts) repete as guardas Foundation/master,
consulta run/tentativa/jobs e reconsulta run mais recente e master para recusar
mudanças durante a consulta. [deploy-dev](../tools/deploy-dev.ts) reconfirma
master remota, HEAD limpo e a mesma evidência imediatamente antes do upload.
Antes de gravar configuração ou chamar Wrangler, exige Worker e domínio existentes,
domínio público habilitado e sem previews, workers.dev/previews desabilitados,
Hyperdrive/cache/TLS corretos, uma versão com
100% do tráfego e tag SHA identificável. Confere Assets, presença dos dois secrets,
origem pública e remetente da versão ativa. Ausência, 403 ou
divergência bloqueiam antes do upload; o executor não provisiona esses recursos.

O remetente de destino é estritamente `Levi <hi@levi.t00ls.dev>`. Para o primeiro
corte, somente a versão original `526d47d8-39cc-46af-8ec5-1bf2bf3d7282`, tag SHA
`b2c892e27e3a8988f0be554692ffea43d35fcd61`, pode apresentar o remetente anterior
`Levi <noreply@levi.t00ls.dev>` no preflight. Uma versão futura ou reenviada com
noreply é recusada. A expectativa validada do remetente integra o snapshot
reconferido antes do upload; mudança de remetente, UUID ou SHA interrompe a
operação. Depois do upload exige hi, sem aplicar essa compatibilidade inicial.
As demais verificações de bindings/secrets permanecem idênticas em todas as fases.

A última versão enviada deve ser a versão ativa, pois a herança de secrets do
Wrangler usa a última versão enviada. O executor registra SHA/UUID anteriores e
reconfere versão/bindings imediatamente antes do upload. Isso detecta mudanças
entre consultas, mas não constitui lock com outro repositório nem impede uma
escrita externa após a última consulta. A contenção operacional é obrigatória.
O executor chama Wrangler uma vez e não repete automaticamente o comando/job.
O Wrangler 4.149.0 pode repetir internamente requisições de API em falhas
transitórias (`retryOnAPIFailure`); não há garantia de um único POST de versão.
Falha ou timeout exige conferir deployments e versões enviadas antes de decidir
qualquer nova tentativa, inclusive se houver versão enviada sem tráfego.

As permissões GITHUB_TOKEN são apenas contents: read/actions: read. Secrets ficam
somente no step publish, após readiness, instalação e build, no Environment exclusivo
`levi-dev`, restrito à master. A fila `levi-dev` usa
cancel-in-progress: false e é distinta de `foundation-dev-d1`; não coordena
publicadores de repositórios diferentes.

**`LEVI_DEPLOY_READY` é o único interruptor administrativo, no Environment `levi-dev`.**
A primeira etapa do job deploy exige literalmente `true`; ausente, false ou
qualquer outro valor falha explicitamente antes de checkout, instalação, build,
consultas operacionais e acesso aos secrets pelo step publish. Não depende de
variables de Environment no if do job. Validate continua sem Environment e sem
credenciais operacionais; pode validar CI mesmo com readiness fechado.

O workflow mapeia `LEVI_DEPLOY_READY` para a entrada interna `LEVI_DEV_READY`, cuja
assertiva o operador preserva. Não existe dependência do interruptor de repositório.
Readiness não prova schema/ACLs e não autoriza uma operação por si só. Mantê-lo
fechado durante a migração dos nomes e abri-lo apenas sob autorização de publicação.
Referenciar um Environment ausente pode criá-lo implicitamente no GitHub; sua
existência isolada não é uma barreira de publicação.

## Recursos e pré-requisitos remotos

Inventariar antes de criar recursos. Confirmar elegibilidade e quotas Workers
Free, Neon Free e Resend Free. Não contratar upgrades. Recursos devem ser próprios
do Levi, sem usar credenciais ou modificar recursos do Foundation.

1. Projeto/banco Neon DEV identificado, host direto e TLS, roles separadas
   `levi_dev_migrator` e `levi_dev_runtime`; runtime sem DDL. Banco com histórico
   revisado e aplicado explicitamente por operação administrativa autorizada.
   A role runtime precisa de SELECT/INSERT/UPDATE/DELETE em `abuse_counters`
   (incluindo a limpeza), sem permissão para criar/alterar tabelas.
2. Hyperdrive exclusivo `levi-dev`, host/banco DEV esperados, role runtime,
   porta 5432, **TLS `verify-full` e CA configurada**, com
   **`caching.disabled=true` conferido pela API**. Sem query cache para
   sessões, memberships, contadores ou dados organizacionais.
3. Resend com domínio remetente verificado e tracking de links desabilitado.
   Chave própria de envio restrita ao domínio. Não há allowlist de destinatários.
   Domínio/chave de teste que só envie ao proprietário não satisfaz cadastro público.
4. Worker `levi-dev`, Static Assets e API na mesma origem HTTPS. Somente custom
   domain `levi.t00ls.dev`; workers.dev/previews permanecem desabilitados.
   Inventariar rotas alternativas em todas as zonas acessíveis. O script confere
   custom domains da conta e rotas da zona t00ls.dev; não atesta zonas fora do token.
5. Nenhuma aplicação Access deve interceptar o hostname público. O processo não
   exige ID/permissões de Access nem remove políticas remotas automaticamente.
   O smoke exige HTML público e estado de onboarding, sem redirects para Access.
6. Validar e-mails, autenticação, persistência, isolamento, quotas e CPU remotamente.
   Métricas locais workerd não são CPU faturada Cloudflare. Não reduzir scrypt
   para caber no Free. Um limite real impeditivo exige parar antes de contratar.

A falta de acesso aos provedores não impede CI/testes locais, mas impede validar
provisionamento, planos, entrega de e-mails ou publicação.

## Secrets e configuração privada

Não depende de `wrangler login` no runner. Configurar tokens exclusivos em
Settings → Environments → levi-dev do GitHub Foundation, sem fornecer valores pelo chat ou
versioná-los. Em terminal privado, `gh secret set NOME --repo t00ls-dev/foundation --env levi-dev`
solicita o valor interativamente.

| Secret do Environment levi-dev | Uso                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`        | Conta correta                                                                 |
| `CLOUDFLARE_API_TOKEN`         | Leitura dos recursos verificados e publicação Worker/Assets/custom domain     |
| `RESEND_API_KEY`               | Fonte da chave de envio, sincronizada no mesmo upload do Worker               |
| `LEVI_AUTH_SECRET`             | Fonte exclusiva do binding de autenticação; obrigatório, mínimo 32 caracteres |
| `LEVI_ADMIN_EMAIL`             | Único e-mail administrativo; ausente, vazio ou inválido nega acesso           |

Variables do Environment: `CLOUDFLARE_ZONE_ID`, `LEVI_HYPERDRIVE_ID`, `LEVI_DATABASE_HOST`,
`LEVI_DATABASE_NAME`, `LEVI_EMAIL_FROM` e `LEVI_DEPLOY_READY`. O workflow as mapeia para as entradas
internas existentes, preservando os bindings do Worker e os alvos esperados.
Não há fallback para nomes legados na nova definição. Os IDs devem corresponder aos recursos
existentes; host direto Neon e banco `levi_dev` ou prefixo permitido.

### Migração administrativa dos nomes

Esta implementação não modifica o Environment. A definição integrada passará a
exigir exclusivamente os nomes canônicos abaixo, sem fallback. Os nomes internos
do executor e os bindings permanecem compatíveis:

| Cadastro legado | Nome canônico no GitHub | Entrada interna preservada                           |
| --------------- | ----------------------- | ---------------------------------------------------- |
| EMAIL_FROM      | LEVI_EMAIL_FROM         | LEVI_EMAIL_FROM                                      |
| HYPERDRIVE_ID   | LEVI_HYPERDRIVE_ID      | LEVI_HYPERDRIVE_ID                                   |
| DATABASE_HOST   | LEVI_DATABASE_HOST      | LEVI_DEV_DATABASE_HOST                               |
| DATABASE_NAME   | LEVI_DATABASE_NAME      | LEVI_DEV_DATABASE_NAME                               |
| DEPLOY_READY    | LEVI_DEPLOY_READY       | LEVI_DEV_READY; DEPLOY_READY local no step readiness |

O diagnóstico lê somente os nomes canônicos de Hyperdrive/host/banco. Não precisa
do gate de deploy nem de e-mail; não deve receber secrets de runtime.

Sequência para operação posterior, separadamente autorizada:

1. Coordenar uma janela sem deploy ou diagnóstico em andamento e sem novos dispatches.
   Manter os gates aplicáveis fechados durante a migração, sem reativar o original.
2. Cadastrar as cinco variables canônicas com a configuração existente, preservando
   exatamente remetente, IDs e destino. Preparar LEVI_DEPLOY_READY=false; não abrir
   o gate como teste. Não alterar RESEND_API_KEY ou CLOUDFLARE_*.
3. Após integração autorizada do PR e CI aprovada da master, conferir os mapeamentos
   de deploy e diagnóstico. Cadastros legados podem existir temporariamente para
   coordenar a transição; o código novo nunca os usa como fallback. Removê-los só
   depois de confirmar que todos os consumidores usam os nomes canônicos.
4. Não copiar AUTH_SECRET presumindo equivalência. Esta revisão passa a exigir
   o novo LEVI_AUTH_SECRET cadastrado pelo responsável; sua primeira aplicação é
   uma troca efetiva de segredo, condicionada à autorização própria descrita abaixo.
5. Habilitar LEVI_DEPLOY_READY somente para uma publicação expressamente autorizada.
   Ausência de configuração canônica deve bloquear, mesmo se o nome legado existir.

O status do cadastro real e o estado do gate devem ser consultados na janela;
este documento não declara que a migração operacional já ocorreu.

O módulo de membros é disponibilizado a todas as organizações, conforme
[Gestão de membros](gestao-membros.md#habilitação-e-limites), mantendo sessão,
permissões e isolamento. Não há variable ou binding de recorte a provisionar,
propagar ou comparar com versões anteriores. Um binding legado na versão ativa
não altera o comportamento do novo runtime nem impede o preflight. O smoke de
`/api/members` exige `401` para visitante deslogado. Feature Flags não são avaliadas.

O token Cloudflare único deve permitir todas as leituras anteriores/posteriores
(Hyperdrive, Worker/versões/subdomínio/domínios, zona/rotas) e o upload. Sua presença
não comprova os escopos efetivos; falha de permissão bloqueia sem contorno. Esta
adaptação não concede permissões nem requer Hyperdrive Write ou acesso migrador.

O Environment **foundation/levi-dev** é a fonte exclusiva de `RESEND_API_KEY`,
`LEVI_AUTH_SECRET` e `LEVI_ADMIN_EMAIL` para a definição desta revisão. Ambos são recebidos somente
no step `publish`; ausência, Resend vazio ou segredo de autenticação com menos de
32 caracteres úteis bloqueiam antes de consultar recursos ou fazer upload.
LEVI_ADMIN_EMAIL é normalizado; ausência ou formato inválido envia string vazia
para negar administração sem herdar valor remoto anterior. O endereço não é
impresso nem comparado em diagnóstico. Ver [Administração global](administracao-global.md).
Não há fallback para AUTH_SECRET legado nem para o valor remoto anterior. Atualizar o cadastro GitHub exige depois uma publicação
manual da master com CI aprovada; a alteração do secret não dispara deploy.

O Wrangler **4.149.0** fixado envia a chave junto ao código por `deploy
--secrets-file`, sem `secret put/bulk` nem versão adicional. O runner verifica que
`/dev/shm` é tmpfs, cria diretório privado 0700 e arquivo JSON exclusivo 0600 com
**somente RESEND_API_KEY, LEVI_AUTH_SECRET e LEVI_ADMIN_EMAIL**, sem valor em argv, config, logs, artifacts ou caches.
A configuração não secreta também fica nesse diretório volátil, removido no
`finally` em sucesso ou falha. Sem tmpfs ou com falha de escrita, não publica.
Interrupção abrupta pode impedir o finally; nenhum arquivo é gravado em disco
persistente e o runner hospedado é descartado ao encerrar o job.
Ver [upload de secrets com código](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code).

### Troca do segredo: impacto e publicação posterior

O novo LEVI_AUTH_SECRET foi cadastrado pelo responsável no GitHub, mas sua
aplicação ao Worker **não foi executada nesta preparação**. O valor remoto antigo
não está disponível; esta revisão prepara uma troca, e não uma migração que
prometa preservar assinaturas antigas. Não extrair ou comparar valores, não ler
AUTH_SECRET legado e não incorporar keyring ou segunda fonte de verdade.

A investigação do Better Auth **1.7.10** fixado e do factory Levi identificou:

| Área                                     | Impacto da troca                                                                                                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookies e sessões                        | Cookies assinados com o segredo antigo deixam de autenticar. As linhas de sessão não são apagadas nem revogadas por isso; uma nova autenticação cria cookies válidos. O contexto de organização por sessão pode precisar ser selecionado novamente. |
| Senhas                                   | Hash scrypt independente do segredo; a senha existente continua válida.                                                                                                                                                                             |
| Magic links                              | Tokens aleatórios persistidos, não assinados com esse segredo. Podem continuar válidos até expiração/consumo; a troca não é revogação de links.                                                                                                     |
| Recuperação de senha                     | Token aleatório persistido também pode continuar válido. No Levi, definir senha continua exigindo uma sessão verificada correspondente; cookies antigos não atendem esse requisito.                                                                 |
| Verificação JWT de e-mail do Better Auth | Depende do segredo; tokens antigos falham com a chave nova. Esse endpoint genérico não é exposto pelo Levi.                                                                                                                                         |
| Limites de abuso                         | Mudam as chaves HMAC por IP/usuário/destinatário; essas janelas recebem novos contadores. O orçamento global diário email-day não depende do segredo e é preservado. Os registros antigos expiram normalmente.                                      |
| Dados de domínio e integrações           | Organização, igreja, memberships/roles, auditoria e hashes de idempotência não dependem desse segredo para decifração. Google/OAuth e TOTP não são habilitados pelo factory Levi; nenhuma cifragem de domínio dependente do segredo foi encontrada. |

Os testes usam PostgreSQL descartável, senha/segredos sintéticos e e-mail em
memória: verificam recusa de cookie antigo, novo login com a mesma senha,
preservação do hash/vínculos/auditoria e consumo único de magic link e recuperação
emitidos antes da troca. Não consultam dados do Neon nem enviam mensagens reais.
Essa análise não cobre uma futura ativação de OAuth com tokens criptografados,
TOTP ou novas funcionalidades que persistam ciphertext: reavaliar antes dessas
mudanças. A documentação do provedor descreve [segredos versionados](https://better-auth.com/docs/reference/options#secrets),
mas manter a chave antiga exigiria dispor dela; essa estratégia não é adotada aqui.

Antes da primeira publicação com esta revisão:

1. Integrar primeiro a padronização de variables do PR #169 e esta preparação,
   cada qual sob autorização própria; exigir CI aprovada do SHA final da master.
2. Confirmar a presença do novo LEVI_AUTH_SECRET no Environment levi-dev, sem
   expor valor; não criar fallback. O runner valida o comprimento no step privado.
3. Obter autorização expressa para a publicação que aplicará o novo segredo,
   reconhecendo o impacto de cookies antigos e o fato de que links aleatórios não
   serão necessariamente invalidados. Não abrir LEVI_DEPLOY_READY nesta preparação.
4. Publicar uma única vez pelo workflow oficial, após seus preflights existentes.
   Resend e autenticação vão no mesmo upload; secrets não relacionados são herdados
   pelo Wrangler. Worker, domínio, Assets, Hyperdrive e TLS não são alterados.
5. Conferir UUID/SHA/100% tráfego, bindings e smokes. Validar login, nova sessão e
   acesso às organizações com conta previamente autorizada. Envio real de e-mail
   continua exigindo autorização específica. Em falha ou estado incerto, parar:
   sem segundo upload, limpeza de sessões, rollback ou alteração de dados automática.

Estar pronto no código não significa que o Worker já use a chave GitHub nem que a
centralização integral tenha sido operacionalmente concluída. Não retornar a uma
versão antiga automaticamente; qualquer recuperação deve revalidar a configuração
de secrets e seus efeitos sobre sessões.

A presença do binding Resend após upload comprova seu nome/tipo, não entrega de
mensagem nem correção funcional de login por link. O sucesso do upload e os smokes
não substituem validação de envio real separadamente autorizada.

Presença/nome/data de atualização não provam equivalência de secrets. A preparação
não afirma equivalência com o segredo antigo e não a utiliza como requisito para
a troca futuramente autorizada. Continua obrigatório comprovar versão ativa igual
à última enviada, ausência de publicador concorrente e demais preflights antes
do upload. O sucesso do deploy não substitui testes funcionais autorizados.

`LEVI_ACCESS_APP_ID` e `LEVI_DEV_EMAIL_ALLOWLIST` deixaram de ser consumidos;
nenhum endereço pessoal deve ser colocado em variables públicas. Chaves de gestão
Neon/Resend e credenciais migrator não pertencem ao workflow. A configuração
Wrangler raiz continua sem rotas e com Hyperdrive placeholder para testes locais.

## Proteção contra abuso

A composição Worker habilita o limitador público `fixedWindowRateLimit` do
`@t00ls-dev/security`, com store PostgreSQL atômico do Levi. A política completa,
identificadores, limites efetivos e custo estão em
[Rate limiting contextual](rate-limiting.md). Leituras autenticadas usam quota por
usuário validado no servidor, separada de escritas e ações sensíveis. A guarda
ampla por IP executa antes da sessão. Login, pedidos de e-mail e quotas de envio
mantêm os tetos anteriores. A documentação do código não atesta publicação.

IP vem exclusivamente de `CF-Connecting-IP`, garantido pela entrada Cloudflare;
`X-Forwarded-For` do visitante não define autoridade. Header ausente usa bucket
compartilhado. A entrada Node local não habilita essa confiança em headers.
Os contadores usam HMAC-SHA-256 com segredo do servidor, sem IP/e-mail em claro,
expiração e limpeza limitada/indexada no mesmo statement do incremento. O schema
técnico consta na migration `0001_abuse-limits.sql`, sem aplicação remota automática.

Excesso de limite HTTP retorna 429 em português com `Retry-After`. Excesso por destinatário
ou orçamento global suprime envio mantendo a resposta genérica; envio não é
confirmação de entrega. Suprimir não depende da existência da conta. Falhas do banco
não liberam solicitações e falhas do provider não são declaradas como envio
confirmado; ambas não provocam retry automático. Tentativas de envio falhas também
consomem orçamento. Credenciais inválidas no login mantêm erro/status genéricos.
Os parâmetros criptográficos nativos permanecem intactos.

O wrapper auth compartilhado também oferece rate limiting por banco e Turnstile; esses
contratos foram examinados. O limitador Hono existente foi escolhido para cobrir
as rotas compostas e reutilizar o mesmo store nas quotas de envio, sem segundo
schema de contadores ou CAPTCHA. Limites nativos do Better Auth não substituem a
proteção durável entre invocações.

São limites conservadores para DEV, não garantia contra bots distribuídos, DDoS
ou exaustão intencional da quota global. Endereços IP distintos continuam sujeitos
ao teto global de e-mails. Limites de janela têm rajada na fronteira; podem atrasar
uso legítimo e precisam de acompanhamento. As quotas reais da conta Resend podem
ser compartilhadas com outros usos; o teto do Levi não atesta saldo do provedor.

## Migrations, operação e recuperação

Migrations PostgreSQL permanecem separadas de build, CI, deploy e inicialização.
CI aplica o histórico somente nos próprios containers sintéticos. Aplicação remota
exige tarefa/autorização específica, identificação de host/banco/role/TLS/schema
esperado e comando `pnpm --filter levi db:migrate:dev`; ver
[Cloudflare Workers](cloudflare-workers.md#migrations-dev-explícitas).

O primeiro deploy exige autorização específica, além da integração revisada do
publicador e da CI de push/master correspondente. Antes disso, reconciliar recursos,
schema/journal/0005–0006/ACLs e o gate existente; preparar `levi-dev` e credenciais sob
custódia privada, preservando os secrets do Worker existente. Não incluir credencial migradora.
A publicação auth@0.3.2 e seu plano antigo continuam adiados e intactos.

No corte autorizado, fechar/suspender o publicador original e aguardar naturalmente
qualquer execução já iniciada. Conferir filas/CI capazes de gerar novos eventos;
não cancelar operação persistente como mecanismo de contenção. Tokens separados e
retirada segura da capacidade antiga, quando autorizada e comprovadamente exclusiva,
reforçam o controle de um único publicador. Não reabrir o original enquanto
Foundation puder publicar. Não se realizou nenhuma dessas operações nesta preparação.

Após preparação administrativa e autorização do primeiro dispatch, selecionar
somente a master atual com SHA completo e CI conjunta aprovada. Qualquer avanço
de master ou troca de tentativa/run invalida a seleção e exige nova verificação.
Não usar SHA histórico arbitrário para sobrescrever revisão mais nova.

Falha anterior ao upload preserva a versão existente; após upload, o job pode
falhar mesmo com versão nova ativa. Conferir APIs de deployments/versões antes de
repetir, sem retry automático. Correção de código via novo PR e CI verde é o
caminho normal. Reverter conteúdo usa commit revisável compatível com o schema,
sem reescrever Git ou desfazer migrations. Retirar domínio ou restaurar banco são
operações excepcionais, autorizadas separadamente; não são rollback automático.

A publicação gera configuração e arquivo de secrets privados em tmpfs e os remove ao terminar.
A saída bruta Wrangler e seus logs em disco ficam desabilitados/sanitizados.
Não habilitar request logs ou traces com URLs de autenticação. O resumo do job
registra SHA e conclusões em vocabulário fechado, em melhor esforço; o sucesso
depende das verificações do runner, não do resumo.

### Evidências pós-deploy e seus limites

1. **Configuração Hyperdrive:** GET da configuração antes/depois do upload exige
   ID esperado, nome Levi DEV, origem/porta/banco/role runtime, cache desabilitado,
   TLS `verify-full` e identificador da CA. Não comprova consulta SQL.
2. **Binding ativo:** consultar deployments do Worker, exigir versão única com
   100% do tráfego, consultar essa versão e conferir tag SHA, binding `HYPERDRIVE`,
   ID do recurso, Assets, presença dos secrets, origem e remetente. A configuração enviada não basta.
   O runner registra somente SHA, UUID da versão, tráfego e resultados sanitizados,
   sem expor outros bindings ou valores de secrets. As permissões de leitura
   existentes do workflow são necessárias; 403 bloqueia confirmação, sem contorno.
3. **Execução SQL:** os GETs anônimos de `/api/onboarding`,
   `/api/organizations`, `/api/churches` e `/api/members` atravessam
   `src/app.ts` → `src/abuse.ts`. O limitador incrementa com
   `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` e limpeza limitada
   (`DELETE` de até 100 contadores expirados por incremento) em `abuse_counters`.
   Erro SQL falha fechado, sem devolver os estados de sucesso esperados.
   Com binding ativo correto e cache desabilitado, smokes aprovados evidenciam
   execução SQL pelo Hyperdrive **por inferência desse fluxo real**.
   Não consultam identidade SQL do projeto/branch/servidor nem fazem homologação
   funcional autenticada. Conexão direta administrativa não substitui esse caminho.
4. **Rotas:** HTML público, onboarding anônimo `{ etapa: "email" }`,
   `401` em organizações/igrejas/membros, além de `404` anônimo em
   `/admin` e `/api/admin/session` com `no-store`, headers
   de segurança e sem redirects. Nenhuma chamada de criação de negócio ou
   envio de e-mail é feita. O smoke de membros não habilita o módulo.

Os quatro GETs API não são estritamente sem efeitos: incrementam contadores
técnicos HMAC/expiração, sob a runtime e rate limiting normais; não modificam
dados de negócio nem exigem privilégios adicionais. O efeito por invocação é
limitado e conhecido, sem criação duplicada de negócio. Evitar loops e retries
para não consumir limites ou gerar ruído técnico. Os testes do runner usam I/O
simulado; apenas uma publicação real confirma essas evidências no ambiente.

Os smokes não substituem testar e-mails reais, autenticação, organização,
isolamento, CPU/quota remota ou recuperação. O gate de membros existente deve ser reconciliado e preservado, sem ampliar,
esvaziar ou interpretar seu conteúdo como autorização de dados reais. Privacidade, retenção, direitos dos
titulares e recuperação precisam ser resolvidos antes de uso real. A janela móvel
de histórico Neon e as limitações de restauração estão no [procedimento de
migrations](cloudflare-workers.md#migrations-dev-explícitas).

## Referência de corte: prosseguimento e interrupção

O corte inicial já foi concluído, com o original contido. A tabela mantém a
sequência de referência para uma eventual operação de transferência autorizada;
não descreve o estado atual dos gates nem autoriza repetir etapas. A migração dos
nomes segue sua seção própria acima. Cada passagem exige evidência atual e um
responsável identificado; falha, 403, identidade incerta ou resultado ambíguo
interrompe antes da etapa seguinte. Não executar o workflow para testar o gate.

| Ordem                   | Evidência e ação a autorizar                                                                                                                                                                                                                                                                                                                                                                                                                         | Interromper se                                                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Recuperação          | Custodiante identifica conta/Worker/domínio/Hyperdrive e projeto/branch/banco Neon. Registrar UUID, SHA, Assets/configuração da versão ativa e versão anterior recuperável; comprovar leitura de deployments/versions/domains e capacidade autorizada de republicar essa versão. No Neon comprovar janela PITR/backup, retenção que cubra a operação, ponto recuperável, RPO/RTO aceitos e procedimento de restauração validado em ambiente isolado. | Houver 403, versão sem identificação, perda de histórico durante a janela, restauração não comprovada ou versão anterior incompatível com schema/configuração previstos. Não criar backup/branch/restore sem autorização própria. |
| 2. Banco e ACLs         | Autorizar explicitamente 0005 e 0006 e aplicação independente de [administracao-runtime-acls.sql](../ops/administracao-runtime-acls.sql), após os preflights abaixo. Reconsultar journal e permissões em conexão nova.                                                                                                                                                                                                                               | Aparecer outra migration pendente, hash/objeto/owner divergente, colisão, evento incompatível com CHECK, espera de lock ou falha de commit. Não iniciar upload com schema/ACLs incompletos.                                       |
| 3. Continuidade         | Sob autorização específica para configurações, reconciliar o remetente ativo com o pretendido `Levi <hi@levi.t00ls.dev>` e a variable `LEVI_EMAIL_FROM`, sem rotação de secrets. Confirmar Resend/domínio, origin, Assets, Hyperdrive, cache/TLS e nomes dos secrets existentes; manter seus valores remotos. Validar escopos reais do token exclusivo Foundation e restrição do Environment à master.                                               | Não for possível conferir o binding ativo ou for necessária rotação de secrets. Nenhuma dessas divergências é corrigida automaticamente pelo executor.                                                                            |
| 4. Candidato            | Preparação integrada por revisão, master limpa, SHA completo escolhido e CI push/master mais recente aprovada, incluindo checks e Version Packages. Confirmar compatibilidade de rollback e matriz de validação.                                                                                                                                                                                                                                     | Houver avanço da master, nova tentativa/run pendente, falha, skip obrigatório ou candidato não revisado.                                                                                                                          |
| 5. Conter original      | Com autorização para o original, fechar `LEVI_DEV_DEPLOY_ENABLED`, fechar `LEVI_DEV_READY` e suspender `.github/workflows/deploy-dev.yml`. Inventariar gatilhos, dispatch/rerun, execuções e filas; aguardar término natural das já iniciadas. Retirar a capacidade de publicação antiga sob custódia, somente após comprovar token exclusivo, sem afetar o novo ou outros consumidores.                                                             | Restar execução/ator/automação capaz de escrever, ou os tokens forem compartilhados/escopo incerto. Não cancelar upload em curso para simular exclusão. Grupos concurrency entre repositórios não são lock.                       |
| 6. Habilitar Foundation | Com autorização do corte e exclusividade comprovada, abrir `LEVI_DEPLOY_READY` somente no Environment levi-dev; preservar execução manual, revisão e proteções. Registrar responsável e janela.                                                                                                                                                                                                                                                      | O original ainda puder publicar ou qualquer condição anterior tiver expirado. Não abrir gates como investigação.                                                                                                                  |
| 7. Publicar             | Dispatch manual do SHA exato da master aprovada, no Worker levi-dev e domínio existentes. Preflight deve confirmar última versão enviada igual à ativa e configurações preservadas. Uma invocação Wrangler, sem retry do executor; observar os retries internos descritos acima.                                                                                                                                                                     | Houver qualquer divergência remota ou mudança de versão. Após upload, falha do job não prova que a versão anterior continua ativa: consultar antes de decidir.                                                                    |
| 8. Validar              | Confirmar SHA/UUID/100% tráfego, bindings e smokes; depois, com conta sintética aprovada, sessão anterior, login/logout, onboarding, organizações, permissões/isolamento e disponibilidade de membros para todas as organizações autorizadas. `/admin` e `/api/admin` devem manter 404 anônimo/comum; usar admin existente somente se disponível. Conferir logs sanitizados, quotas e saúde.                                                         | Houver regressão, perda de sessão não aceita, acesso a membros sem permissão/isolamento ou exposição administrativa. Sem primeiro admin, declarar painel publicado tecnicamente e não ativado. Não fazer bootstrap como correção. |
| 9. Consolidar           | Registrar versão ativa, CI/run de publicação, publicador único Foundation e original contido, incluindo custódia e canais manuais. Manter evidência privada de configurações sem secrets em logs.                                                                                                                                                                                                                                                    | Existir segundo escritor ou versão sem comprovação. Aguardar estabilidade antes de encerrar a janela.                                                                                                                             |
| 10. Falha               | Aplicar somente recuperação previamente validada e autorizada, conforme os limites abaixo; interromper novas publicações e revalidar estado.                                                                                                                                                                                                                                                                                                         | A ação necessária exceder a autorização ou não houver evidência de recuperação segura. Não improvisar DDL reverso nem alternar publicadores concorrentes.                                                                         |

### Migrations e ACLs: verificações independentes

O [runner DEV](../tools/migrate-dev.ts) exige `--through TAG` e aplica somente a
primeira revisão pendente selecionada, mantendo o
histórico Drizzle, com advisory lock não bloqueante. Confirmar imediatamente
antes quais revisões estão pendentes. Para o corte administrativo histórico,
autorizar **0005 e 0006** individualmente, na ordem. Para a simplificação
estrutural, seguir a seção de etapa 7 abaixo. A 0005 depende do histórico
0000–0004, de `user`, `tenants` e `audit_events`, ownership apropriado, ausência de
colisões das quatro tabelas e de ações globais reservadas incompatíveis no audit.
A 0006 depende de `admin_bootstrap` e cria função/trigger permanente, sem seed.

A operação autorizada deve conferir hashes/ordem do journal, banco/role/schema,
TLS, projeto/branch Neon via gestão, owners, privilégios, constraints e índices,
trigger append-only e locks; definir janela, `lock_timeout` e `statement_timeout`
de sessão proporcionais ao tamanho real. O runner não define esses timeouts.
ALTER/CHECK/FKs podem bloquear escritas; não prometer ausência de interrupção.

Após aplicação, em nova conexão: journal 0000–0006 sem pendências/hashes divergentes;
quatro tabelas presentes e vazias; FK/PK/UNIQUE/CHECK/versionamento corretos;
`audit_events.tenant` nullable apenas para ações globais conhecidas; triggers
append-only e de proteção do recibo habilitados. Confirmar preservação dos totais
de negócio/auditoria, sem inserir eventos ou contas de teste no DEV.

Aplicar os grants runtime em transação própria e conferir com funções de inspeção
de privilégios, sem DML de teste persistente. Os grants são por coluna: consultar
`has_column_privilege` além de ACLs da relação. Runtime pode ler/inserir concessões
e flags, atualizar somente colunas permitidas e substituir seleções; não pode
escrever recibo, alterar identidade, apagar concessões/flags, executar DDL ou
alterar auditoria. Preservar grants legados de auth/tenancy/abuse e ausência de
ownership, grant option e memberships privilegiadas. Não criar default ACL ampla.
A revisão do artefato não substitui verificar o estado real após GRANT.

A role `levi_dev_bootstrap` e
[administracao-bootstrap-acls.sql](../ops/administracao-bootstrap-acls.sql) são uma
operação opcional posterior, independente do deploy: não são necessárias para
publicar com zero administradores. Exigem conta/sessão/UUID e confirmação assistida
conforme [Administração global](administracao-global.md). Não configurar ADMIN_EMAIL,
criar concessões ou semear flags durante migrations/deploy. Não tocar no recibo
para recuperar privilégios.

### Recuperação de código, banco e configuração

- **Código/Worker:** voltar a uma versão UUID comprovada exige procedimento e
  autorização de recuperação, incluindo Assets, bindings e compatibilidade com o
  schema aditivo. O publicador normal exige master atual; não aceita SHA histórico
  arbitrário para recuperação. Um rollback Cloudflare não desfaz Neon ou recursos
  conectados. Registrar a nova versão/deployment ativo e repetir validações.
  Um rollback pode deixar a última versão enviada diferente da ativa. Nesse caso,
  o publicador normal permanece bloqueado: uma operação de recuperação separada,
  previamente validada e autorizada, precisa restabelecer essa linha de base com
  código, Assets, configuração e secrets comprovados. Um novo PR, isoladamente,
  não resolve essa divergência. Não retirar a guarda ou reutilizar o deploy
  normal para contorná-la. Sem esse procedimento, a recuperação segue pendente
  e o corte não pode prosseguir.
- **Banco:** PITR/backup precisa de ponto/branch, janela e procedimento comprovados;
  timestamp/LSN não criam backup nem reservam retenção. Restauração pode perder
  gravações legítimas posteriores e afetar recibos permanentes. Exige decisão
  própria sobre perda de dados e preservação da unicidade do bootstrap. Não
  executar down migrations, apagar journal ou restaurar recibo por automatismo.
- **Configuração:** variables, gates, domínio, Hyperdrive, Resend e secrets têm
  custódia e plano de restauração separados. Não presumir que rollback de código
  restaura esses recursos ou secrets. Reconferir metadados/valores não sensíveis e
  continuidade funcional; valores secretos permanecem sob custódia privada.

Para devolver a publicação ao original em recuperação, primeiro conter Foundation,
aguardar execuções e retirar sua capacidade exclusiva, depois restaurar a do
original mediante autorização. Nunca manter dois escritores. Esta preparação
não executa qualquer um desses procedimentos.

## Corte estrutural — etapa 7

A [preparação técnica da etapa 7](etapa7-preparacao.md) descreve o smoke restrito
por capacidade temporária, o cliente de leitura, o ensaio descartável e os
impedimentos de drenagem/recuperação que precisam de comprovação dos custodiantes.

Preparação não autoriza execução. O caminho padrão preserva dados e acessos,
sem reset. Em Actions → Deploy Levi DEV → Run workflow, selecionar `master`.
O SHA do evento é fixado, validado pela CI e reconferido antes da publicação;
se master avançar, iniciar novo dispatch autorizado. O resumo registra SHA e
versão publicada. Não existe aplicação SQL nem credencial SQL no publicador.

1. Obter autorização própria para inventário SQL, migrations e janela de corte.
   Identificar projeto/branch Neon, host direto, banco, consumidores, owners,
   journal/hashes, grants/triggers e dados existentes. Status não prova ACLs.
   Confirmar backup com restauração ensaiada, responsável, retenção e ponto de
   recuperação. Nenhuma ferramenta atual cria backup automaticamente.
2. Conter todos os escritores e publicadores, inclusive autenticação, tarefas
   externas e conexões em voo. O Worker atual não tem uma guarda de manutenção
   comprovada; não confiar apenas em uma página 503. A estratégia de contenção
   e drenagem deve ser ensaiada e autorizada antes da janela.
3. Consultar `pnpm --filter levi db:status:dev` com a confirmação CONSULTAR
   descrita em Cloudflare Workers. Revisar cada pendência histórica antes de
   autorizar aplicação. `db:migrate:dev` sem seleção falha antes de conectar.
   Com confirmação APLICAR e alvo já comprovados, usar, por exemplo,
   `pnpm --filter levi db:migrate:dev --through 0007_igrejas-expand`.
   Isso aplica exclusivamente a primeira pendência: não salta revisões nem
   reaplica uma revisão concluída. Reconsultar status em conexão nova.
4. Aplicar 0008 separadamente com `--through 0008_convites-igreja`, validar
   tabela/índices/constraints e grants dos convites. Ela depende da expansão
   0007; não depende do contract. O journal não inclui conversão nem contract.
5. Seguir as fases de [núcleo de igrejas](nucleo-igrejas.md#fases-de-migration-e-corte):
   conversão transacional, comparação exata dos acessos e ACLs revisadas,
   publicação compatível e confirmação de versão/bindings. Contract exige
   autorização independente e ausência comprovada de consumidores antigos.
   Validar invariantes e proteções antes de liberar escritas.
6. Autorizar dispatch apenas com schema/ACLs compatíveis. Os smokes exigem
   respostas normais: manutenção não conta como sucesso. Planejar a liberação
   para permitir os smokes existentes; não desabilitá-los. Complementar com
   validação autenticada autorizada de Magic Link, igrejas, papéis e convites.

Interromper por identidade ou exclusividade incerta, hash divergente, papel
legado desconhecido, igreja sem admin, diferença nos conjuntos administrativos,
lock/timeout, backup não recuperável ou resultado indeterminado de commit/upload.
Não repetir automaticamente: reconciliar journal e versão ativa primeiro.
Depois de novas escritas por igreja ou contract, voltar ao Worker antigo pode
ser incompatível. Preferir correção compatível revisada; restauração exige
outra autorização e recuperação comprovada. Nunca executar down automático.

### Reset DEV opcional — procedimento bloqueado por padrão

Não há necessidade comprovada de reset para este corte. Não foi criado botão,
input, secret SQL, função privilegiada ou comando de limpeza. Portanto nenhum
input de deploy pode apagar dados. Produção não integra este procedimento.

Se houver necessidade posterior, o operador deve solicitar uma operação manual
específica, fora do deploy, com estes checkpoints obrigatórios:

- Comprovar projeto e branch Neon exclusivamente DEV, host direto e banco exatos,
  proprietários e todos os consumidores. Nome `levi_dev`, regex ou Environment
  sozinhos não comprovam isolamento. Qualquer possibilidade de produção bloqueia.
- Inventariar e aprovar o manifesto efetivo: identidades, contas/credenciais,
  sessões/verificações, igrejas/acessos, membros/históricos/recibos, convites,
  auditoria, bootstrap, contadores e arquivo `levi_legacy`. Revisar retenção e
  configuração que deve permanecer, preservando journal, schema, grants e triggers.
- Obter backup recuperável, contenção/drenagem e confirmação explícita escrita
  `APAGAR DEV <projeto>/<branch>/<host>/<banco>` pelo responsável autorizado.
  A confirmação não habilita nenhum executor deste repositório.
- Preparar SQL específico somente depois do inventário e submetê-lo à revisão.
  Não usar TRUNCATE CASCADE ou desabilitar triggers genericamente: auditoria e
  bootstrap têm proteções deliberadas. Não usar runtime para limpeza nem
  conceder ownership ao workflow. Sem alvo exclusivo e revisão, não executar.
- Ensaiar em clone descartável; validar transação/rollback, concorrência,
  preservação estrutural e revogação de sessões/links. Commit indeterminado exige
  reconciliação, sem repetição que possa apagar dados criados depois.

A etapa 7 padrão pode prosseguir sem reset após suas autorizações e evidências.
O reset permanece uma decisão posterior; este procedimento não contém SQL
executável destrutivo nem afirma que o banco DEV esteja vazio.
