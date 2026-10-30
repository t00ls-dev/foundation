# Decisões do MVP

**Escopo aprovado em 2026-10-16; estado atualizado em 2026-10-24.** O MVP completo
ainda não está implementado. A primeira fatia de onboarding e provisionamento
está descrita em [Onboarding e provisionamento](onboarding-provisionamento.md).
Este documento registra o escopo e suas invariantes, sem autorizar operação.

## Precedência e estado

Esta é a fonte de decisões do Levi, consolidada a partir das decisões aprovadas
na preparação do repositório e reafirmadas no alinhamento com o Foundation, em
2026-10-16. O [README](../README.md) apresenta um resumo; o
[AGENTS.md](../AGENTS.md) orienta o trabalho no repositório.

Decisões posteriores explicitamente aprovadas prevalecem e devem ser incorporadas
aqui. Fatos técnicos descrevem capacidades e limites; recomendações não se tornam
requisitos por repetição. Relatórios históricos permanecem como evidência de suas
execuções e não são necessários para compreender ou definir o escopo atual.

| Classificação         | Estado                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aprovado              | Regras das seções seguintes, com implementação parcial descrita abaixo.                                                                                                                                                                                                                                                                                                                                                            |
| Planejado/recomendado | Composição técnica candidata, sujeita a prova e autorização.                                                                                                                                                                                                                                                                                                                                                                       |
| Implementado          | API local e SPA React de onboarding, provisionamento inicial e navegação organizacional, com migrations, testes PostgreSQL e navegador. Composição Workers com DEV publicado, Neon/Hyperdrive e fluxo de CI/deploy próprios. Primeira fatia de membros disponível a todas as organizações na implementação Foundation, sob autorização por usuário e isolamento, conforme o guia próprio. Demais funcionalidades do MVP pendentes. |

A primeira fatia local de membros (cadastro, listagem e ficha) está descrita em
[Gestão de membros](gestao-membros.md). Esta etapa foi autorizada em 2026-10-22
inicialmente para implementação e validação sintética. Operações posteriores
autorizaram separadamente migrations 0000–0003 e privilégios mínimos no DEV;
a liberação de dados reais exige decisão operacional própria. A restrição temporária
por organização foi removida da implementação Foundation por autorização posterior;
o módulo está disponível a todas as organizações, preservando permissões e
isolamento. Isso não autoriza deploy ou altera o publicador original.
A reformulação de interface de 2026-10-24 acrescenta edição
cadastral, controle de versão e contatos opcionais da primeira igreja, somente
validados em bancos descartáveis. Migration 0004 e ACLs incrementais permanecem
pendentes de autorização operacional. Exclusão, alteração posterior de situação
e transferências continuam pendentes.

## Administração global interna

A Etapa 1 de [administração global](administracao-global.md) implementa apenas
persistência e operações internas, separadas das roles organizacionais. O primeiro
admin depende de bootstrap explícito e assistido, consumido uma única vez; demais
concessões exigem administrador global atual. A Etapa 2 acrescenta `/admin` e
`/api/admin`, com HTTP 404 antes do HTML e dos middlewares para quem não possui
concessão global ativa. O painel gerencia concessões e políticas preparadas, sem
ativação real ou troca do avaliador de membros. A política de flags não concede
membership nem autoriza dados de outras organizações.

## Igreja, acesso e identidade

A simplificação aprovada em 2026-10-29 substitui as decisões organizacionais
anteriores. O [núcleo de igrejas](nucleo-igrejas.md) documenta a etapa 3, os
contratos, as invariantes e o corte separado de schema.

- Igreja é a única raiz operacional; a conta pode acessar várias igrejas
  independentes e criar outras com chaves novas, sem limite funcional inicial.
- Há dois papéis locais: admin gerencia igreja, acessos e membros; collaborator
  consulta, cadastra e edita membros. Igreja sempre mantém administrador.
- Administração global é independente e não concede autoridade local.
- Conta, vínculo de acesso e membro da congregação são separados. Coincidência
  de e-mail/telefone não associa entidades nem concede privilégios.
- Membro pertence a exatamente uma igreja. IDs, dados e históricos existentes
  são preservados na conversão normal. Não há exclusão de igreja nesta fase.
- Autenticação permite conta sem igreja e senha opcional. A experiência completa
  de gestão visual pertence à etapa 4 e convites à etapa 5.

## Cadastro e consultas

| Campo pessoal                | Regra aprovada                                              |
| ---------------------------- | ----------------------------------------------------------- |
| Nome                         | Obrigatório e não vazio.                                    |
| Nascimento                   | Opcional; data civil conhecida ou ausência.                 |
| Telefone e e-mail de contato | Opcionais e compartilháveis; não são credenciais.           |
| Ingresso conhecido           | Opcional; não confundir com criação do registro no sistema. |
| Endereço                     | Opcional.                                                   |
| Data de batismo              | Opcional; ausência não significa “não batizado”.            |
| Função na igreja             | Opcional; não determina permissão administrativa.           |

A igreja atual é obrigatória no registro e validadas pelo
servidor, assim como os metadados gerados pelo sistema. Campos pessoais opcionais
não podem tornar-se obrigatórios por efeito do formulário, API ou banco. Não
inventar datas para preencher lacunas.

As situações aprovadas são **Ativo** e **Inativo**. Situação não é estado civil,
inativação não é exclusão e transferência não cria uma terceira situação.

O escopo inclui cadastro, consulta e alteração de membros, busca/listagem,
aniversariantes e indicadores simples. Os recortes ainda não definidos estão em
[Pendências reais](#pendências-reais). Homônimos e contatos compartilhados são
legítimos; não há identidade automática ou fusão baseada nesses atributos.

CPF, gênero, estado civil, profissão, escolaridade, conversão, filiação, cônjuge,
casamentos, quantidade de filhos e observações livres não possuem aprovação neste
recorte. Não entram por herança do legado nem por campos livres genéricos.

## Histórico, transferências e exclusões

- Manter histórico cadastral, de situação e de transferências internas.
- Transferência ocorre somente entre igrejas da mesma organização, mantendo o
  membro e seu UUID e registrando origem/destino. Não inclui cópia entre tenants,
  solicitação/aceite local ou saga entre organizações.
- Exclusão definitiva do membro elimina a ficha e seu histórico pessoal. A
  auditoria técnica conserva somente o mínimo justificado, sem perfil ou diffs
  pessoais; identificadores técnicos continuam sujeitos a retenção e proteção.
- Igreja só pode ser excluída sem membros atuais, incluindo os Inativos.
  Nomes institucionais registrados no histórico devem permanecer após a exclusão
  legítima da igreja vazia.
- Exclusão de organização é excepcional e fica fora da interface do MVP.

## Onboarding

1. Verificar o e-mail, comprovando seu controle.
2. Permitir definição de senha após a verificação.
3. Criar a organização com a primeira igreja e o vínculo de administrador
   organizacional.

O envio de e-mail não equivale à verificação. A primeira igreja não é opcional no
provisionamento inicial. Esse fluxo não cria automaticamente um membro para o
administrador. Conta verificada, com ou sem senha, pode existir antes do provisionamento
da organização; não prometer uma transação única incluindo interação humana e
envio externo de e-mail.

O DEV está preparado para acesso público, sem Cloudflare Access ou allowlist de
e-mails, com limites duráveis de solicitações e envio. Essa composição não concede
acesso anônimo aos dados privados. Publicações DEV exigem CI aprovada;
procedimento em [Deploy DEV](deploy-dev.md).

## Dados e operação

- PostgreSQL principal compartilhado; IDs de entidades em UUID gerados no
  servidor. Tokens e identificadores externos preservam seus contratos próprios.
- Operações relacionadas devem ser atômicas, incluindo negócio, histórico,
  auditoria e resultado idempotente quando aplicável. Referências devem impedir
  cruzamentos entre organizações.
- Datas civis usam `DATE`; instantes usam `TIMESTAMPTZ`, com apresentação no fuso
  do dispositivo. Não persistir idade calculada ou deslocar datas civis via UTC.
- Schema composto e migrations são responsabilidade do Levi, versionados e com
  execução independente de inicialização, CI e deploy. Validação em banco
  descartável não equivale a aplicar migrations em banco persistente.
- Recuperação efetivamente testada continua pendente: visualizar histórico Neon
  não comprova restauração nem reserva um ponto. A janela móvel deve ser
  reconfirmada antes de cada operação; não há RPO/RTO definido. Avaliar RLS como defesa adicional, sem adoção automática.
- Histórico pessoal, auditoria, logs e backups têm finalidades e retenções
  distintas. Definir governança LGPD antes de dados reais, incluindo a natureza
  sensível dos dados religiosos e eventual tratamento de dados de menores.

## Integração com o Foundation

O [Foundation](https://github.com/t00ls-dev/foundation) fornece mecanismos
genéricos; organização/igrejas, membros, histórico e políticas do produto ficam no
Levi. Reutilizar os contratos públicos necessários dos nove pacotes oficiais:
`config`, `db`, `auth`, `tenant`, `access`, `security`, `email`, `observability` e
`audit`, no scope `@t00ls-dev`, com dependências locais `workspace:*`.

**Fatos técnicos da referência examinada:** Foundation em
`22a4aa0dd4a560f86aaa4e3272138799c922e76e`. Seu exemplo Links usa D1 e não demonstra
o domínio multi-tenant do Levi; o gerador tem somente o preset `basic-d1`. UI e
ferramentas de workspace são privadas para publicação. A disponibilidade de um
pacote não obriga usar todos os seus recursos, como convites e plugins de auth.

**Composição adotada no DEV:** TypeScript modular, React/Hono, Cloudflare Workers,
Hyperdrive sem cache e Neon PostgreSQL, com roles distintas de migradora e runtime.
O procedimento de publicação e suas evidências estão em [Deploy DEV](deploy-dev.md).
O paralelismo com resultado agregado e as guardas de SHA seguem o Foundation;
as fases D1 automáticas do Links não se aplicam às migrations PostgreSQL do Levi.
A infraestrutura de produção permanece fora deste fluxo.

**Composição verificada na primeira fatia (2026-10-19):** os pacotes publicados
`auth@0.3.0`, `db@1.0.0`, `tenant@1.0.0` e `audit@1.0.0` substituem as limitações
técnicas da referência histórica acima: UUID opt-in no wrapper, factory assíncrona
com `pg` e adapters com executor `query`. O schema composto UUID, o onboarding
e-mail-primeiro e o rollback conjunto de provisionamento/auditoria são cobertos
pelos testes locais. Isso não comprova operação remota ou o restante do MVP.

**Verificações de engenharia contínuas e futuras:**

- Preservar a compatibilidade UUID, o onboarding e-mail-primeiro, retomada e
  tratamento de conta existente ao evoluir a composição.
- Compor sessão e contexto de tenant com vínculo atual e autorização estática no
  servidor. Os pacotes não filtram automaticamente as consultas do domínio.
- Compatibilizar schema do consumidor, FKs e contratos dos adapters; garantir a
  mesma transação para negócio, histórico e auditoria. Os adapters PostgreSQL
  atuais recebem executor `query`; a garantia depende da composição explícita no
  mesmo Client, validada em PostgreSQL real.
- Verificar isolamento, concorrência, repetição de tentativas, exclusões e
  recuperação com dados sintéticos em ambiente isolado.
- Confirmar consumo suportado de UI, textos em português brasileiro, runtime,
  pooling e eventual RLS, sem alterar decisões de produto para acomodar exemplos.

Rechecagem assistida de duplicidades, coordenação de escritas e recibos de
idempotência são recomendações técnicas de composição, não novos módulos
aprovados. Nomes físicos de tabelas, protocolo de locks, índices e distribuição
de UI continuam decisões de engenharia; este documento não é um schema.

## Fora da implementação inicial

- Financeiro, cobrança, planos, assinaturas, comercialização, quotas ou bloqueios
  comerciais, incluindo o limite histórico proposto de 50 membros.
- Migração real do CEPEG, importadores, sincronização e estruturas preparatórias
  de correspondência com o legado.
- Operadores/administradores locais por igreja, conjuntos Secretaria/Consulta,
  concessões locais e editor de permissões.
- Pessoa global, vínculos eclesiásticos atuais simultâneos, transferências entre
  organizações e fusão automática de cadastros.
- Hierarquias denominacionais, catálogos ministeriais, workflows e módulos sem
  requisito concreto aprovado.

O legado `t00ls-dev/Levi.old` é preservado em repositório separado. Propostas de
relatórios anteriores não reativam essas funcionalidades.

## Pendências reais

| Tema                    | O que falta definir                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consultas               | Inclusão de Inativos nos aniversariantes, tratamento de 29/02, exibição de idade/ano e recorte dos indicadores simples.                                                 |
| Datas de negócio        | Correção retroativa e apresentação de saída/retorno com data desconhecida.                                                                                              |
| Administração adicional | Quem pode adicionar/revogar administrador organizacional, convite ou vínculo a conta existente e recuperação do último administrador. Não altera o primeiro onboarding. |
| Operação                | Volume/latência esperados, responsáveis, RPO/RTO, retenção e custo de backup/recuperação.                                                                               |
| Dados reais             | Agentes de tratamento, finalidades/bases legais, retenção por categoria, atendimento a titulares, menores e eventual evidência de representação.                        |

Essas pendências não reabrem organização como tenant, PostgreSQL, campos opcionais,
Ativo/Inativo, administradores exclusivamente organizacionais ou a sequência de
onboarding aprovada.

A entrada por Magic Link não exige senha nem vínculo organizacional. A conta sem igrejas oferece o cadastro atual da primeira igreja e orientação para solicitar convite ao responsável; os novos serviços de igrejas e convites ainda não estão implementados. A primeira senha é opcional, configurada posteriormente com sessão verificada recente; credenciais existentes e recuperação por e-mail permanecem disponíveis. A administração global mantém a autoridade configurada e seus gates de sessão, sem exigir senha.
