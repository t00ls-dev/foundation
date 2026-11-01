# Relatório do novo visual do Levi

A referência visual foi consultada em `/home/admin/ai_artifacts/levi-redesign/`,
sem incorporar arquivos do editor ao repositório. O código da interface está em
`apps/levi/web/src`; `apps/levi/src` contém a API e os contratos de rotas. Nas telas existentes foram preservados hooks, chamadas de API, autorização, guard HTTP de `/admin`, history, rascunhos, confirmações, validações e regras de negócio. Após autorização explícita para ampliar o escopo, foi acrescentada Minha conta (`/conta`), uma leitura autenticada em `/api/account` e a revalidação dessa página pelo mecanismo de sessão existente, sem mudar regras de autorização.

## Telas com referência visual

Caminhos abaixo relativos a `apps/levi/web/src`.

| Referência           | Arquivo                  | Rota/estado implementado                                                |
| -------------------- | ------------------------ | ----------------------------------------------------------------------- |
| Membros              | `app.tsx`, `members.tsx` | `/membros`                                                              |
| Entrar               | `app.tsx`, `forms.tsx`   | `/`, `/entrar`, `/onboarding`, entrada por e-mail                       |
| Link enviado         | `app.tsx`                | Mesmas rotas, após envio confirmado, incluindo reenvio e contagem reais |
| Escolher igreja      | `app.tsx`                | `/igrejas/selecionar`                                                   |
| Nova igreja          | `app.tsx`, `forms.tsx`   | `/criar-igreja`                                                         |
| Detalhe do membro    | `members.tsx`            | `/membros/:id`                                                          |
| Novo membro          | `members.tsx`            | `/membros/novo`                                                         |
| Acessos e convites   | `church-management.tsx`  | `/igrejas/acessos`                                                      |
| Aceitar convite      | `invitation.tsx`         | `/convite`, com e sem sessão                                            |
| Administração global | `admin.tsx`              | `/admin`, conteúdo condicionado à autorização existente                 |
| Minha conta          | `app.tsx`, `account.css` | `/conta`, acrescentada após autorização de ampliação do escopo          |

## Inventário das telas e estados generalizados

| Arquivo                                    | Rota                                               | Estados cobertos                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app.tsx`                                  | Todas as rotas do shell                            | Leitura inicial, esqueleto público de gestão, operação pendente, erro de rede, erro de sessão, recuperação de acesso, 429 e espera, sucesso e informação                       |
| `app.tsx`                                  | `/`, `/entrar`, `/onboarding`                      | Link inválido, expirado ou reutilizado, conferência de e-mail, alteração de endereço e reenvio indisponível                                                                    |
| `app.tsx`                                  | `/onboarding`, `/igrejas/selecionar`               | Conta sem igreja, acesso revogado e seleção sem vínculos disponíveis                                                                                                           |
| `app.tsx`, `forms.tsx`                     | `/entrar/senha`                                    | Entrada com senha, campos obrigatórios, credenciais recusadas e operação pendente                                                                                              |
| `app.tsx`, `forms.tsx`                     | `/conta/senha`, `/onboarding` com retorno de senha | Senha opcional, retorno com token, redefinição por e-mail, confirmação divergente, erros e sucesso                                                                             |
| `app.tsx`, `forms.tsx`                     | `/criar-igreja`                                    | Contatos opcionais recolhidos/expandidos, validação, resultado incerto e consulta de recuperação                                                                               |
| `app.tsx`                                  | `/painel`                                          | Visão geral e atalhos, inclusive disponibilidade de Membros conforme o contrato vigente                                                                                        |
| `app.tsx`, `church-management.tsx`         | `/igrejas`                                         | Detalhes institucionais, dados ausentes/restritos e comandos disponíveis segundo o papel                                                                                       |
| `church-management.tsx`, `forms.tsx`       | `/igrejas/editar`                                  | Edição, contatos opcionais, recarga de versão, erro e confirmação de descarte existente                                                                                        |
| `members.tsx`                              | `/membros`                                         | Consulta pendente, vazio inicial, filtros sem resultado, erro, atualização e paginação                                                                                         |
| `members.tsx`                              | `/membros/novo`                                    | Validação local, obrigatórios e opcionais, pendência, resultado incerto e repetição da mesma tentativa                                                                         |
| `members.tsx`                              | `/membros/:id`                                     | Carregamento, dados opcionais ausentes, ficha indisponível e erros de acesso                                                                                                   |
| `members.tsx`                              | `/membros/:id/editar`                              | Edição, validação, erro de versão, consulta da ficha atual, rascunho e sucesso                                                                                                 |
| `church-management.tsx`                    | `/igrejas/acessos`                                 | Carregamento, convites vazios, lista de vínculos vazia, envio, aceito/cancelado/expirado/pendente, reenvio, cancelamento, promoção, rebaixamento, revogação, erros e paginação |
| `invitation.tsx`                           | `/convite`                                         | Consulta da sessão, link indisponível, entrada com e-mail convidado, troca de conta, erro, convite aceito e seleção de igreja                                                  |
| `admin.tsx`                                | `/admin`                                           | Confirmação da autorização, acesso negado, falha, atualização, catálogo de políticas, seleção de igrejas, confirmação de política global, paginação e reautenticação           |
| `ui.tsx`, `shell.tsx`, `design-system.tsx` | Transversal                                        | Vazio, situação, foco, controles desabilitados, navegação, menu Mais, guarda de rascunho e visibilidade dos campos                                                             |

## Decisões e diferenças necessárias

- Tokens da referência são a única paleta, escala de texto, fontes, raios e
  sombras do visual. O tema é claro, inclusive sob preferência de sistema escura,
  pois o material não define tokens escuros.
- Foram criados Button, Input, Select, Pill, Avatar, Card, ListRow,
  SegmentedControl, FilterChip, PageHeader, TabBar, Fab, FormFooter e InfoRow.
  Button e Input estendem os exports públicos de `@t00ls-dev/ui`; os demais
  pertencem à composição do Levi. Não há dependências novas.
- Filtros preservam radios nativos e seleção de situação preserva o select
  existente. Links de seções usam `aria-current`; não foram convertidos em
  botões que alterariam os papéis esperados pelos testes.
- Chips têm alvo de 44px, atendendo ao requisito de toque, mesmo onde o exemplo
  desenha 40px. A curva do bloco azul usa o raio de cartão fornecido (16px),
  pois o raio de 28px do HTML não pertence à lista de tokens autorizados.
- A lista usa os dados reais retornados pela API. O app oferece Ativo/Inativo,
  busca por nome com botão Filtrar e paginação. Não há total de membros, filtro
  Visitante, ministérios predefinidos ou ação de afastamento nesse contrato.
- A navegação mantém Início, Membros, Igrejas e Mais. Não foi inventada permissão para uma aba Admin. O atalho superior e o menu Mais abrem Minha conta. A configuração de senha continua disponível pelo comando existente e pela nova página de conta.
- Nova igreja mantém nome e contatos institucionais opcionais. Cidade e UF não
  são campos do contrato atual. O cadastro de membros mantém seus campos reais,
  mais extensos que o exemplo, organizados em cartões de coluna única.
- A ficha mantém os dados e títulos atuais e apresenta ações de telefone/e-mail
  quando os respectivos contatos existem. Não foi acrescentado WhatsApp nem
  alterada a situação por uma ação inexistente.
- Convites e equipe permanecem visíveis em seções, preservando as ações atuais,
  sem acrescentar estado de abas ou ocultar comandos existentes.
- Administração global aplica a linguagem visual ao catálogo e à configuração
  de políticas existentes. Não apresenta métricas, busca ou criação de igrejas
  fictícias do exemplo. O convite não revela nome da igreja, remetente, papel
  ou validade antes da aceitação, pois o cliente atual não obtém esses dados.
- Mensagens de erro/sucesso continuam contextuais. Carregamento usa indicador
  simples e moldura pública; vazios usam Card e o ícone existente. Foram
  explicitados os vazios de convites e acessos, sem novas chamadas de API.
- FormFooter fica acima da navegação móvel, para não cobrir links; em telas
  públicas fica junto à borda inferior. Os campos podem ser rolados acima dele.
- As confirmações de descarte, saída, alteração de acesso e política continuam
  nos diálogos nativos existentes. Substituí-los por modais exigiria alterar os
  controllers/hooks, fora do escopo autorizado.

## Compatibilidade dos testes

Os testes existentes foram preservados; foram acrescentados contratos do cliente e um E2E de Minha conta. Foram mantidos nomes acessíveis, papéis e textos
usados pelos E2E: por exemplo, “Seu e-mail”, “Receber link de acesso”,
“Cadastrar membro”, “Nome (obrigatório)”, “Ficha do membro”, “Salvar membro”,
“Acessar igreja …”, “Gerenciar acessos” e os comandos do menu Mais.

O comando visível “Acessar igreja” foi compactado para uma seta; seu texto
continua disponível e o nome acessível permanece “Acessar igreja {nome}”.
Foram acrescentados os textos de vazio “Nenhum convite cadastrado.” e
“Nenhum acesso disponível nesta consulta.”, o status “Consultando acessos…” e
os rótulos das ações de contato “Ligar” e “E-mail”.

## Ampliação autorizada: Minha conta

A nova rota usa dados da sessão verificada e vínculos já disponíveis, sem criar
credenciais, providers ou permissões. `src/app.ts` expõe somente nome, e-mail,
verificação e IDs da identidade em `GET /api/account`; tokens e demais dados da
sessão não são transportados. `web/src/api.ts` valida a resposta e `app.tsx`
confere a identidade novamente antes de exibir o perfil. Respostas antigas e
trocas de sessão seguem o descarte por geração já existente.

Os arquivos adicionais são `web/src/account.css`, `src/web-paths.ts`,
`test/web.test.ts` e `e2e/onboarding.spec.ts`. Os novos textos acessíveis são
“Minha conta”, “Dados da minha conta”, “Definir senha”, “Escolher igreja” e
“Voltar às igrejas”. Os rótulos anteriores de senha e saída permanecem.
