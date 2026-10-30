# Gestão de membros

Implementa cadastro, listagem paginada, filtros, ficha individual e edição cadastral. O escopo
pessoal e as invariantes continuam em [Decisões do MVP](decisoes-mvp.md).
Não implementa exclusão, alteração posterior de situação, transferência,
aniversariantes, indicadores, convites ou associação automática a contas.

## Habilitação e limites

O módulo está disponível para todas as igrejas, sem lista de UUIDs,
booleano de habilitação local ou restrição por origem DEV. Não há avaliação de
Feature Flags persistidas neste fluxo; sua integração será tratada separadamente.

`/api/context` informa `membersEnabled: true` após validar sessão pronta,
igreja ativa e vínculo atual. Essa capacidade não concede permissões: as
operações de membros continuam exigindo papel admin ou collaborator e a permissão
correspondente. Usuário deslogado recebe `401`; sessão não pronta, vínculo
revogado ou role sem permissão são recusados. Registros de outra igreja
retornam `404`, e identificadores enviados pelo cliente não alteram o tenant ativo.

As mutações revalidam sessão, vínculo, igreja e versão na transação, mantendo
auditoria, idempotência e isolamento. A SPA conserva o contrato de contexto e
limpa os dados após troca de igreja ou perda de acesso. Todas as migrations
e ACLs do módulo precisam estar disponíveis antes da publicação: schema ausente
falha com erro sanitizado, sem aplicar migrations automaticamente.

## Contratos e decisões mínimas

- Campos técnicos da API usam identificadores em inglês, como os contratos
  existentes; interface e mensagens usam português brasileiro.
- `name`, `churchId` e `status` são obrigatórios. `status` aceita somente `Ativo`
  ou `Inativo`; a seleção inicial visível é `Ativo`, sem impedir `Inativo`.
- Datas civis (`birthDate`, `joinedOn`, `baptismDate`) são strings `AAAA-MM-DD`
  válidas no calendário gregoriano, anos de 0001 a 9999, ou ausência. Persistem
  como `DATE`, com leitura string, sem conversão por `Date` ou deslocamento UTC.
  Não foram inventadas restrições de datas futuras ou relações entre essas datas.
- Telefone é texto de até 40 caracteres; e-mail de contato tem até 254 e validação
  sintática simples; função na igreja tem até 160. Nome tem de 1 a 160 caracteres
  após trim. **Endereço é um único texto opcional de até 500 caracteres**, sem
  campos pessoais adicionais, geocodificação ou catálogo. Não é campo de notas.
- Opcionais omitidos, `null`, vazios ou somente espaços normalizam para `null`.
  Tipos diferentes de string/null e campos extras são rejeitados. Contatos e nomes
  podem se repetir; função não concede permissão. Metadados não são aceitos do
  cliente. Cadastro não cria login, membership ou convite.

| Método/caminho                   | Contrato                                                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/members`              | JSON com os campos acima e header `Idempotency-Key` de 16 a 128 caracteres alfanuméricos, `_` ou `-`. Responde `201` com `{ churchId, memberId }`, inclusive no replay idêntico.                          |
| `GET /api/members`               | Filtros opcionais `name`, `churchId`, `status`, `page`, `pageSize`. Responde `{ churchId, members, page, pageSize, hasNext }`. Lista somente ID, nome, igreja e situação, sem contatos ou ficha completa. |
| `GET /api/members/:id`           | Ficha, com `{ churchId, member }`. Outra igreja e UUID inexistente recebem o mesmo `404`.                                                                                                                 |
| `GET /api/members/requests/:key` | Recupera `{ churchId, memberId }` da tentativa do próprio ator na igreja atual. Sem recibo, outra igreja ou outro ator recebem `404`. Não recebe nem devolve perfil pessoal.                              |

Todas exigem sessão pronta e vínculo administrativo atual. Permissões estáticas
`members:read`, `members:create` e `members:update` usam `@t00ls-dev/access`; contexto usa o contrato
Foundation existente. Falhas preservam o padrão `{ erro, mensagem }`, headers
privados, CSRF e limites de corpo existentes. Nenhuma resposta é cacheável.

Busca de nome é por trecho literal sem distinção de caixa (`ILIKE`), preservando
acentos; `%`, `_` e barra invertida não viram curingas do usuário. Igreja e situação
combinam-se com nome por AND. Filtros nunca atravessam a igreja; igreja
inexistente ou externa produz lista vazia, sem exposição de existência.

Paginação: página padrão 1, tamanho padrão 20, máximo 100 e página máxima 10000.
Valores inteiros positivos, parâmetros desconhecidos e repetidos são validados.
Ordenação por nome e UUID, conforme collation do PostgreSQL; UUID desempata
homônimos. Busca usa `LIMIT tamanho+1` para `hasNext`, sem contagem global.
Paginação por offset não promete snapshot entre requisições quando há cadastros
concorrentes. Volume/índices de busca por trecho devem ser medidos antes de uso
em escala; não há dependência de extensão ou serviço de busca.

## Integridade, histórico e reenvio

A migration `0002_membros.sql` cria `members`, `member_history` e
`member_creation_requests`. O núcleo atual isola membros e históricos por `church_id`; a conversão e o
contract estão documentados em [Núcleo de igrejas](nucleo-igrejas.md). O histórico inicial contém somente fato de criação,
ator, instante, nome institucional da igreja e situação inicial, sem copiar a
ficha em JSON ou propor um histórico genérico. Seu nome de igreja é um snapshot
para sobreviver à evolução institucional. Novos tipos de histórico exigirão
outra decisão/migration na etapa correspondente.

Membro, histórico, evento técnico `member.created` com metadata `{}` e recibo
confirmam na mesma transação e no mesmo Client PostgreSQL. Falha em qualquer
um desfaz todos. Histórico e recibo têm FK composta com `ON DELETE CASCADE` para a
ficha; isso prepara futura eliminação, sem oferecer API de exclusão agora.
Auditoria técnica permanece separada, mínima e append-only, com identificadores
sujeitos à política de retenção ainda pendente.

Idempotência é escopada por igreja, ator e chave aleatória. Um advisory lock
transacional por tentativa serializa reenvios; sessão, tenant ativo e membership
são revalidados depois da espera, com locks compartilhados durante a criação.
Recibo guarda hash SHA-256 da entrada normalizada e ID resultante, dentro da área
eliminável; não é chave de identidade nem metadado de auditoria. Chave igual com
entrada divergente retorna `409`; chave nova permite cadastrar homônimo legítimo.
Nenhum adapter Foundation foi alterado.

A interface impede submissões simultâneas e conserva somente chave opaca por
igreja em `sessionStorage`, nunca nome, contato, ficha ou token. Após resultado
incerto, oferece consulta do recibo e repetição explícita da mesma tentativa. Após
refresh do formulário, tenta recuperar o resultado pela chave antes de permitir
nova submissão. Se ainda não há recibo, conserva a chave para evitar duplicação
quando a tentativa anterior concluir. Dados do formulário são mantidos somente
na memória da página. Sem storage, a proteção permanece durante a mesma montagem;
refresh nesse caso perde a chave e exige consultar os cadastros antes de uma nova
tentativa. Recibos permanecem enquanto a ficha existir; não há rotina de expiração
que permita reutilização silenciosa de chaves antigas nesta entrega.

Ao navegar/trocar igreja, a aplicação remove os dados anteriores antes de
reconsultar. Ao recuperar foco/página, revalida sessão/contexto. Respostas carregam
igreja e são comparadas ao contexto exibido; respostas atrasadas de uma
montagem anterior não repovoam a tela. Uma revogação externa só pode ser conhecida
na próxima consulta/revalidação; não há canal de push ou promessa de atualização
instantânea enquanto a página permanece sem interação.

## Edição cadastral

A ficha oferece **Editar membro**. `PATCH /api/members/:id` recebe `version`
inteiro positivo e o perfil completo: `name` obrigatório; `birthDate`, `phone`,
`email`, `joinedOn`, `address`, `baptismDate` e `churchRole` opcionais, com as mesmas
normalizações e limites do cadastro. Omitir um opcional o normaliza para `null`;
a interface envia os valores atuais, permitindo limpar explicitamente um contato.
A ficha acrescenta `version`; sucesso devolve `{ churchId, memberId, version }`.

A allowlist rejeita qualquer outro campo, inclusive `tenant_id`, `churchId`,
`status`, identificadores, autoria, histórico e auditoria. Igreja e situação são
somente consulta neste fluxo; transferência e mudança de situação permanecem
fora desta entrega. O servidor exige sessão pronta, capacidade habilitada,
igreja ativa e vínculo atual com `members:update`. Revalida e mantém
locks compartilhados de sessão/contexto/vínculo durante a transação, reutilizando
o mecanismo do cadastro. O membro é consultado e bloqueado por ID e igreja;
a escrita mantém também a igreja atual no predicado. Outro tenant e ID inexistente
recebem o mesmo `404`.

`SELECT FOR UPDATE` serializa a ficha. Versão desatualizada retorna `409
MEMBRO_ALTERADO` sem modificar dados; a interface conserva o rascunho em memória e
oferece **Consultar ficha atual**. Não sobrescreve automaticamente nem refaz o
PATCH. Após falha de rede, consultar a ficha antes de tentar novamente: se o
commit ocorreu, uma repetição com a versão antiga será recusada. Isso impede
duplicar a mesma revisão sem introduzir outro recibo ou alterar a idempotência
do cadastro.

Perfil atualizado, incremento da versão, snapshot anterior dos campos permitidos
em `member_profile_history` e evento `member.updated` com metadata `{}` confirmam
na mesma transação/Client. Histórico pessoal possui FK composta e cascata com a
ficha; não é auditoria técnica nem JSON genérico de request. O histórico inicial,
os recibos de cadastro, UUID, igreja, situação e data de criação são preservados.
A runtime apenas insere o novo histórico, sem SELECT/UPDATE/DELETE nessa tabela.

A migration [0004](../migrations/0004_interface-e-edicao.sql) e as
[ACLs incrementais](../ops/interface-e-edicao-acls.sql) foram preparadas para
aplicação administrativa posterior. Os privilégios exatos e a ordem operacional
estão no [guia Workers](cloudflare-workers.md#roles-e-acls-mínimas-dev).
Nenhum deles foi aplicado em DEV ou produção nesta tarefa. Sem a migration e as
ACLs, a nova edição não está operacionalmente liberada. A capacidade de membros
está disponível para todas as igrejas; edição exige `members:update`.

## Confirmação e uso móvel

O formulário tem seções de identificação, contato e datas, com erro associado a
cada campo, foco no primeiro erro e botão explícito **Salvar membro** ou **Salvar
alterações**. O primeiro submit do formulário é desabilitado e oculto, impedindo
a submissão implícita nativa. O handler aceita somente o botão real como
`SubmitEvent.submitter`. Enter em input de uma linha avança ao próximo controle;
Tab, selects, composição IME e ativação do botão por teclado/tecnologia assistiva
continuam disponíveis. Enter em busca mantém sua semântica de filtrar.

A guarda síncrona de operação, os controles desabilitados e a idempotência existente
impedem submissões simultâneas. Sucesso abre a ficha com confirmação. Navegação
com rascunho exige confirmação de descarte; `beforeunload` solicita a proteção
nativa quando o navegador a oferece. Recuperar foco revalida autoridade sem
desmontar um formulário preenchido; revogação ou troca de tenant remove os dados.
Não há persistência pessoal em storage. Matar o app, fechar a aba ou o sistema
descartar a página pode perder o rascunho, especialmente no iOS.

### Proteção do UPDATE necessário ao lock no DEV

A migration `0003_protecao-update-runtime.sql` acrescenta uma função de trigger
`SECURITY INVOKER` e triggers `BEFORE UPDATE FOR EACH STATEMENT` em `churches` e
`tenant_memberships`. Rejeita com SQLSTATE `42501` toda instrução UPDATE cujo
`current_user` seja `levi_dev_runtime`, inclusive sem linhas correspondentes.
Não dispara no SELECT FOR SHARE e não impede UPDATE de outras roles autorizadas.
O retorno NULL da função é ignorado por ser um trigger por instrução; não oculta
atualizações de outras roles nem descarta linhas silenciosamente.

PostgreSQL exige UPDATE em ao menos uma coluna para FOR SHARE. A concessão
somente em `created_at` satisfaz o lock, enquanto o trigger rejeita a
mutação efetiva pela runtime DEV. **Esta migration não concede privilégios** e
não habilita o módulo. Sua aplicação persistente, os grants mínimos e qualquer
deploy exigem operações separadas autorizadas.

A função usa `search_path = pg_catalog`, sem leitura de dados ou elevação de
privilégios. A role que aplica a migration deve ser a proprietária das tabelas;
função e triggers permanecem sob seu controle. A runtime deve continuar sem
ownership, CREATE no schema, TRIGGER, capacidade de assumir outra role ou alterar
`session_replication_role`. Owners e administradores podem modificar a proteção;
o nome exato da role DEV é parte da política e renomeá-la exige revisão. Uma
futura função SECURITY DEFINER que execute UPDATE com outra identidade também
exigirá revisão, pois o bloqueio usa o usuário efetivo. Não é uma proteção RLS
nem substitui a autorização por igreja na aplicação.

O teste `test/runtime-update.integration.test.ts`, executado pelo harness de
integração, cria outro banco no mesmo container descartável, com migradora owner
sem SUPERUSER e logins runtime/operador independentes. Aplica primeiro 0000–0002,
preserva fixtures sintéticas e aplica 0003 pelo migrator Drizzle. Exercita locks,
bloqueio de UPDATE, tentativas de alterar/desativar a proteção e operações
legítimas de outras roles. Não utiliza conexão ou credencial de ambiente remoto.

## Validação isolada

Com dependências e ferramentas locais existentes:

```sh
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm worker:build
ppnpm test:integration
ppnpm test:worker
ppnpm test:e2e
```

Integração e E2E usam exclusivamente os containers descartáveis dos harnesses,
com imagem PostgreSQL fixada e porta aleatória em loopback. Aplicam o histórico
duas vezes nesse banco sintético e o removem em `finally`. Não executar
`db:migrate:dev` ou `deploy:dev` para validar localmente. Geração da migration
usa `pnpm db:generate -- --name=membros`, sem conexão a banco.

O modo opcional reproduz as ACLs do DEV, sem ampliar permissões:

```sh
ppnpm test:integration -- --runtime-acls
ppnpm test:worker -- --runtime-acls
ppnpm test:e2e -- --runtime-acls
```

`test/runtime-acl-fixture.ts` prepara roles no cluster descartável, aplica 0000–0004
pela migradora e separa login de execução e conexão observadora. O modo padrão
continua disponível; a CI executa integração nos dois modos e workerd/E2E no modo
restrito, preservando todos os cenários dessas suítes. As ACLs de cadastro, o incremento de edição
e os limites de segurança estão no [guia Workers](cloudflare-workers.md#roles-e-acls-mínimas-dev).

A imagem local fixada é PostgreSQL 17.11. Inspeção estrutural e conexão direta
Neon PostgreSQL 18.6 não equivalem a homologação funcional nesse servidor ou
pelo Hyperdrive. Nenhum desses testes autoriza habilitar o módulo, publicar
dados reais ou executar alterações remotas.

A SPA não oferece filtros ou seletores de igreja nem preserva `?igreja=`.
O cadastro deriva `churchId` da igreja ativa e todas as consultas enviam
`X-Levi-Church`. Nome, situação e paginação permanecem disponíveis. O filtro
legado `churchId` da API nunca amplia o escopo: divergência produz lista vazia.
