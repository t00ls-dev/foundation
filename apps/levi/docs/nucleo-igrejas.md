# Núcleo de igrejas — etapas 3 e 4

Igreja é a única raiz operacional do Levi. A conta pode criar e selecionar várias
igrejas independentes, sem limite comercial inicial. `admin` gerencia a igreja e
seus acessos; `collaborator` consulta, cadastra e edita membros. Administração
global não concede acesso a igrejas. Conta, vínculo de acesso e membro da
congregação permanecem entidades distintas. Não existe exclusão de igreja nem
convites nesta etapa. A SPA oferece seleção, edição institucional e gestão de vínculos existentes.

## Contratos

- `GET /api/churches?after=<uuid>` lista até 100 vínculos atuais e retorna `next`.
- `POST /api/churches` recebe `name`, `address`, `phone`, `email` e header
  `Idempotency-Key` de 16–128 caracteres. A chave pertence à conta, admite outras
  chaves e rejeita payload divergente. Replay exige acesso atual e nunca restaura
  vínculo. Igreja, primeiro admin, seleção, recibo e auditoria são atômicos.
- `GET/PATCH /api/churches/:id` consulta e edita por versão. PATCH recebe os mesmos
  campos institucionais e `version`; contatos ausentes são limpos. Colaborador
  recebe apenas identificação mínima, sem contatos institucionais.
- `POST /api/context/church` recebe `churchId`; `GET /api/context` resolve seleção,
  papel e capacidades atuais. IDs do cliente não concedem autoridade.
- `GET /api/churches/:id/accesses?after=<uuid>` pagina vínculos (100 por consulta), com `next` (UUID ou null). Inclui `name`, `email`, papel, versão e data do vínculo somente para administradores autorizados daquela igreja.
  `PATCH/DELETE /api/churches/:id/accesses/:accessId` exige `version`; PATCH também
  recebe `role`. Não há endpoint para conceder acesso a contas novas nesta fase.
- Operações de membros exigem `X-Levi-Church` com a igreja esperada. Divergência
  com a seleção persistida retorna 409, sem gravar na seleção nova. Filtros e IDs
  nunca ampliam o escopo. Campos desconhecidos são recusados.
- Diretório e políticas globais usam `/api/admin/churches` e `churchIds`. Flags
  mantêm o comportamento existente: não alteram a disponibilidade real de membros.

As rotas organizacionais antigas retornam 404. A interface usa os contratos novos,
sem alias de IDs organizacionais. A paginação não limita o número de igrejas por
conta. Limites de abuso permanecem independentes de limites comerciais.

## Transações e integridade

A ordem de locks é sessão, seleção (quando aplicável), igreja, vínculos e recurso.
A linha da igreja serializa gestão de acessos e domínio. As permissões são
reconsultadas depois da espera. Leituras de membros também mantêm autorização e
consulta na mesma transação. A seleção de outra sessão não é alterada na revogação;
um contexto revogado falha na próxima resolução. Sessão é conferida novamente nas
escritas após esperas e auditoria. UUIDs, escopo e versões são validados no servidor.

O último admin não pode ser rebaixado ou removido. O serviço confere o estado
resultante e o contract instala constraint triggers diferidos, incluindo criação
de igreja, com lock da mesma raiz. A mutação de acesso também avança a versão MVCC da raiz
sem mudar os dados institucionais, protegendo snapshots REPEATABLE READ/SERIALIZABLE.
FKs de identidade não permitem cascata que
contorne a regra. A runtime não recebe DDL, TRUNCATE, exclusão de igreja/identidade
nem mutação dos identificadores. Históricos pessoais continuam elimináveis com a
ficha; auditoria técnica permanece append-only, com metadata mínima.

## Fases de migration e corte

Nada neste documento autoriza execução persistente. Não executar os scripts em
Neon DEV durante implementação ou CI. Migrations 0000–0006 permanecem intactas.

1. **Expand:** `migrations/0007_igrejas-expand.sql` é a única revisão nova no
   journal automático. Adiciona estruturas e FKs sem converter dados ou impedir
   o provisionamento legado. Os novos escopos de históricos ainda são nullable.
2. **Conversão:** `ops/etapa3/converter.sql`, fora do journal, exige transação e
   escritores suspensos/drenados. Bloqueia as relações envolvidas, recusa papéis
   desconhecidos e igrejas sem admin e compara os conjuntos exatos de pares
   administrativos. Cada admin legado conserva acesso a todas as igrejas antes
   acessíveis; organização vazia não gera igreja. Preserva UUIDs, datas, snapshots,
   hashes e versões. Seleção só é convertida quando há um destino inequívoco.
   Reexecução antes de novas escritas reconcilia sem duplicar vínculos; depois do
   corte não é um mecanismo de sincronização.
3. **ACLs e publicação:** revisar `ops/etapa3/runtime-acls.sql` e
   `ops/etapa3/bootstrap-acls.sql`, ainda sob manutenção. A versão nova escreve
   exclusivamente por igreja. Confirmar a publicação manual e a ausência de
   escritores antigos antes da liberação. Rollback de código anterior deixa de
   ser seguro quando novas igrejas sem organização forem criadas.
4. **Contract:** `ops/etapa3/contract.sql` exige transação e autorização própria.
   Revalida admins e instala proteções SQL; retira colunas redundantes e move as
   tabelas organizacionais para `levi_legacy`, sem readers nem acesso da runtime.
   Esse arquivo imutável preserva também organizações vazias, IDs dos vínculos,
   seleções e recibos antigos. FKs para identidades/sessões mutáveis são retiradas
   do arquivo para não impedir logout/renovação. O mapa histórico igreja/organização
   é preservado ali. Não existe organização oculta criada para igrejas novas.
   Auditoria mantém `tenant` como UUID histórico sem FK e novos eventos usam
   somente `church_id` ou escopo global permitido.

O contract não está pendente no migrator: não pode ser aplicado automaticamente
junto da expansão. O schema TypeScript descreve o escritor novo; o snapshot 0007
representa a expansão, ainda compatível com o escritor antigo. Uma próxima geração
de migration exige revisar essa diferença e registrar a fase elegível; não aceitar
remoções geradas automaticamente. O arquivo legado não participa do modelo Drizzle.
Não há dual-read/dual-write, RLS, reset, deploy automático ou concessão arbitrária.

Antes de operação persistente, comprovar identidade/consumidores do banco,
journal/hashes, owners, grants, triggers, dados/exceções e recuperação. Só liberar
escritas com versão nova confirmada e proteções/ACLs verificadas. O caminho normal
preserva dados; reset exige autorização separada e não foi implementado aqui.

## Validação descartável

`pnpm --filter levi test:integration` executa o ensaio de conversão em container
próprio e as regressões de API/autenticação. `--runtime-acls` repete com roles
restritas. `tools/prepare-church-test.ts` aplica conversão/contract exclusivamente
no cluster recém-criado pelo harness; não é um executor operacional.

O ensaio específico também pode ser executado com
`pnpm --filter levi exec tsx tools/test-integration.ts --churches --runtime-acls`.
Os scripts existentes de build, workerd e Playwright validam as adaptações mínimas
de interface. Nenhum harness usa credenciais operacionais.

## Interface de igrejas e acessos

`/igrejas/selecionar` apresenta as igrejas e os papéis Administrador e Colaborador.
A criação em `/criar-igreja` permanece disponível com ou sem vínculos existentes.
`/igrejas` apresenta a ficha ativa; contatos institucionais são restritos a admin.
`/igrejas/editar` permite edição por versão e preserva o rascunho em conflitos.
O usuário pode descartar explicitamente o rascunho e recarregar os dados atuais.

`/igrejas/acessos` lista pessoas com paginação, permite promoção, rebaixamento e
revogação com confirmação e versão. O servidor protege o último administrador.
Alteração do próprio acesso reconsulta o contexto imediatamente. Administradores
podem [convidar por e-mail](interface-onboarding.md#convites-por-e-mail), cancelar
e reenviar. O vínculo só é criado após o aceite autenticado. Não há busca global
nem exclusão de igreja. Dados pessoais ficam
somente em memória; identidade, papel e igreja são revalidados nas operações.

Membros usam exclusivamente a igreja ativa, sem seletor ou parâmetro `?igreja=`.
O servidor preserva o filtro legado divergente como lista vazia, sem ampliar escopo.
