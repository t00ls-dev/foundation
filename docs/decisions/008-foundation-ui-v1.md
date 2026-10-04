# ADR-008: Base UI Foundation v1 privada e incremental

- Status: aceito
- Escopo: base UI e shell do Links (PR 1)

## Contexto

O Links precisa de feedback acessível e de um shell estável durante a leitura de
sessão. CSS global ligava roles ARIA à aparência de alerts e refetch removia
páginas indiscriminadamente. Há um consumidor concreto; o design system completo
continua adiado pelo [ADR-007](007-v01-scope.md).

## Decisão

Criar `@t00ls-dev/ui` em `packages/ui`, workspace privado, não publicável e sem
Changeset nesta fase. Exports por componente apontam para fontes TSX consumidas
pelo bundler do app; não há distribuição externa, build de pacote ou allowlist
de release adicional.

Três camadas: tokens semânticos com Tailwind CSS v4 (`@theme inline`),
primitives shadcn/ui da família Radix, e padrões de composição mantidos pelo
Foundation. Primitives entram conforme uso. Esta etapa incorpora Button,
Skeleton e Spinner; Dialog e demais controles aguardam tarefas reais. Settings
pode usar Dialog ou fluxo inline conforme a tarefa e a melhor UX.

Preservar verde, superfícies claras, fontes locais e alvos de toque. CSS legado
permanece em camada inferior às utilities, com aliases temporários. Semântica
ARIA e aparência visual são independentes.

**Estado desconhecido nunca é apresentado como estado negativo.** Sessão
desconhecida não é logout confirmado; status TOTP desconhecido não é Off. Erros
e resultados indeterminados ficam contextuais e persistentes. Sonner é único,
usado somente para sucesso confirmado após navegação/fechamento, sem duplicação.

PageProgress registra operações explícitas e concorrentes, indeterminadas, com
cleanup idempotente em conclusão/abort/unmount e movimento reduzido. Não
intercepta fetch nem usa `useNavigation` num BrowserRouter.

## Consequências

- Padrões não conhecem Better Auth, endpoints ou entidades do produto.
- Refetch da mesma identidade mantém conteúdo; não há cache paralelo de usuário.
  `null`/401, logout e expiração continuam removendo conteúdo privado. A árvore
  de rotas e feedback é limitada por usuário **e sessão**; troca/rotação
  descarta estado sensível. A geração de requests continua sendo invalidada
  antes dos efeitos das páginas privadas.
- Feedback global pertence à identidade e não recebe secrets. Callbacks de
  identidades descartadas não podem produzir notificações novas.
- Compatibilidade com a troca de senha existente: seu resultado confirmado por
  leitura autoritativa pode entregar uma mensagem fixa à **sessão de reposição**
  exata, depois do remount. Isso preserva feedback sem transportar campos ou
  secrets da árvore descartada; não reformula Account nem altera reconciliação.
- Bookmarks, Account e TOTP serão migrados em PRs próprios, preservando seus
  controllers e contratos. Sem alterações de backend ou política de providers.
- Bundle e testes acompanham cada etapa. A base privada não altera publicação
  nem o PR Version Packages #30.
