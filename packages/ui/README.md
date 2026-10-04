# Foundation UI v1

Workspace **privado**, consumido por fontes no Links, sem publicação ou
Changeset. Veja [ADR-008](../../docs/decisions/008-foundation-ui-v1.md).

## Consumo

Importe por componente, por exemplo `@t00ls-dev/ui/components/skeleton` ou
`@t00ls-dev/ui/patterns/pending-button`. O app importa Tailwind v4 e
`@t00ls-dev/ui/styles.css`, com `@source` explícito para `packages/ui/src`. O
`components.json` configura shadcn/ui (família Radix); Button e Skeleton são
adaptações MIT das primitives shadcn. Spinner é decorativo. Só acrescente
primitives com consumidor real. Composições pertencem ao Foundation.

O Vite do Links pré-otimiza os imports TSX do shell (incluindo `.tsx` nas
extensões do optimizer), para evitar uma cadeia de requests de módulos do
workspace em cada reload. Ao editar fontes UI durante dev, reinicie o Vite com
`--force` para atualizar a pré-otimização; isso não altera o build de produção.

Tokens: background/foreground, card, primary, muted, accent, destructive,
border/input/ring, info, espaçamento, tipografia, radius, fonte local, foco,
alvo de toque e duração de movimento. O Links mantém aliases de cor e layout
legado durante a migração. Camadas `theme, base, legacy, components, utilities`
permitem que utilities superem seletores globais antigos. Não estilize roles
ARIA; aplique classes visuais explícitas.

## Loading e ações

- Um `PageProgressProvider` envolve o app, com um `PageProgress`. A barra tem
  nome acessível, sem valor/porcentagem fictícios e não desloca o layout.
- `useProgressOperation(active)` acompanha estados assíncronos reais e libera a
  operação no cleanup. Para promises: `const finish = progress.begin(signal)`;
  execute `finish()` em `finally`. Abort é idempotente e remove só essa
  operação. Não observe indiscriminadamente fetch; BrowserRouter não fornece
  useNavigation.
- Sessão inicial desconhecida: Skeleton decorativo, com região nomeada/busy.
  Formato conhecido: reserve dimensões próximas às finais. Refetch da mesma
  identidade mantém estrutura e conteúdo; erro recuperável é contextual.
- `PendingButton` bloqueia a ação e comunica `aria-busy`, spinner oculto e label
  explícita. Não prometa porcentagem, sucesso ou rollback de resultado incerto.
- Movimento reduzido elimina animações, preservando indicação visual estática.

## Feedback

- Erro de campo: junto ao campo, foco e descrição acessíveis.
- `InlineFeedback`: erro recuperável/resultado indeterminado contextual e
  persistente. `tone` controla aparência; `announce` controla urgência ARIA.
- Um `FeedbackProvider`/Sonner Toaster por app, keyed pela fronteira de
  identidade/sessão. `useConfirmedFeedback()(operationId, fixedMessage)` anuncia
  uma vez por operação **após** confirmação autoritativa e navegação/fechamento.
  Use IDs únicos por mutation; o provider descarta feedback de identidades
  antigas. Não envie payloads, emails, passwords, códigos, key/URI ou outros
  secrets.
- Copy: feedback local “Copied” só após sucesso da Clipboard API.
- Sem toast de loading, sem sucesso redundante toast + alert + mensagem. Não use
  `toast.promise` em auth; HTTP concluído não comprova reconciliação. Use o
  padrão scoped, sem importar `toast` diretamente nos apps.
- Estado desconhecido nunca vira estado negativo (TOTP desconhecido ≠ Off).
  Settings escolhe Dialog ou inline pela tarefa, não por obrigatoriedade global.

## Fronteiras

Esta base não contém router, auth, API ou domínio. O app conserva geração de
requests e descarte de secrets na troca/rotação de sessão, logout, expiração,
navegação e bfcache. Persistência visual não autoriza reter snapshots privados
fora da sessão autoritativa. O refetch anônimo já resolvido preserva
formulários; sessão inicial desconhecida não exibe controles presumidamente
anônimos.

Validação: `pnpm --filter @t00ls-dev/ui test`, lint/typecheck, E2E do shell no
Links e `pnpm check` como gate final.

O Vitest compartilhado usa jsdom 26.1.0 para lifecycle DOM/StrictMode. A versão
é fixada também no peer opcional `vitest>jsdom`, para não introduzir via
resolução automática uma versão que exija Node acima do mínimo 22.22.0 do
repositório.
