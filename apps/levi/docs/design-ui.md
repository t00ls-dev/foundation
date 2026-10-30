# Levi — proposta de UI, Fase 0

Proposta para avaliação em 29/10/2026. Não autoriza implementação.

## Evidência e diagnóstico

Inspeção em `/root/foundation`, branch `master`, árvore inicialmente limpa.
Destinos de documentação graváveis; nenhum arquivo anterior nos destinos.
Playwright, Chromium, axe e Prettier disponíveis localmente. Nenhuma instalação.

Referências normativas: [instruções do Levi](../AGENTS.md),
[acessibilidade](../../../../ACCESSIBILITY.md),
[onboarding](interface-onboarding.md), [MVP](decisoes-mvp.md),
[Foundation UI](../../../../packages/ui/README.md) e
[ADR-008](../../../../docs/decisions/008-foundation-ui-v1.md).

A página [Preline Dashboards](https://preline.co/templates/dashboards/) foi
consultada diretamente em conteúdo textual: Admin, CRM, CMS e Analytics.
Não houve inspeção visual dos previews premium nem reutilização de recursos.
A inspiração se limita à hierarquia, superfícies, navegação e organização.

Confirmações em `web/src`: `app.tsx` tem 1266 linhas e coordena estados,
revalidação, navegação por `history.pushState` e renderização; `style.css`
tem 1361 linhas. Existem tokens roxos, valores locais, `:has()` e `!important`.
Esses recursos não são, isoladamente, defeitos de acessibilidade. O corpo usa
16 px e vários auxiliares 14 px; reduzir mais comprometeria leitura móvel.
A hipótese de cartões exclusivamente no desktop não se confirma: já existem
linhas compactas. Também existem placeholders, feedback e estados vazios.
O principal ganho proposto é consistência, hierarquia e navegação móvel estável.
Administração global tem composição própria, sem reaproveitar todo o shell.
O manifest do Levi não inclui UI compartilhada nem Tailwind.

## Inventário confirmado e limites

| Área          | Comportamento atual a preservar                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Onboarding    | E-mail, espera/reenvio, verificação, senha e confirmação, organização e primeira igreja; contato opcional expansível         |
| Entrada       | Login recorrente sem etapas de criação; recuperação de links inválidos/expirados; logout                                     |
| Organizações  | Seleção entre vínculos autorizados; sem acesso não oferece criar organização novamente                                       |
| Painel        | Quantidade de igrejas retornadas e atalhos; nenhuma contagem global de membros                                               |
| Igrejas       | Consulta e atalho para membros filtrados por UUID institucional                                                              |
| Membros       | Busca por nome, filtros de igreja/situação, paginação, cadastro, ficha e edição cadastral com versão                         |
| Administração | `/admin`, sessão global, políticas preparadas de membros, seleção de organizações e paginação; não ativa o avaliador vigente |

Administradores organizacionais acessam todas as igrejas da organização autorizada.
Capacidade de membros vem do servidor; URL e navegação não concedem acesso.
Não há exclusão, transferência ou alteração posterior de situação nesta proposta.
Não há gráficos, relatórios, convites ou criação de igrejas adicionais.
A UI global inspecionada edita políticas; não presumir uma tela de concessões
apenas porque operações internas existem. Sem concessão global, servidor retorna
404 antes do HTML. Não incluir `/admin` no menu organizacional por presunção.

## Direção visual e tokens

Roxo refinado, superfícies neutras e tipografia de sistema. Identidade acolhedora
sem ilustrações decorativas ou fotografias de pessoas. Prioridade: reconhecer
contexto, encontrar uma pessoa e concluir uma tarefa com poucos obstáculos.
Modo claro e modo escuro conforme a preferência do sistema (revisão da
Fase 2; ver abaixo).

| Token            | Valor                     | Aplicação                       |
| ---------------- | ------------------------- | ------------------------------- |
| primary          | `#5936a2`                 | Ação principal e seleção        |
| foreground       | `#252238`                 | Texto principal                 |
| muted-foreground | `#625e73`                 | Texto secundário                |
| background       | `#f7f6fa`                 | Fundo                           |
| card             | `#ffffff`                 | Superfícies                     |
| accent           | `#f0ebfa`                 | Seleção e informação            |
| border           | `#e3e0ea`                 | Separadores decorativos         |
| input            | `#82798f`                 | Limite de controle              |
| success          | `#245b3b` sobre `#eaf5ee` | Situação confirmada             |
| destructive      | `#a3293e` sobre `#fff3f5` | Erro textual                    |
| ring             | `#5936a2`                 | Contorno 3 px, afastamento 4 px |

Calcular contraste pela luminância relativa sRGB, sem arredondar para aprovar.
Branco/primary aproximadamente 8:1; texto principal/branco acima de 15:1;
muted/branco acima de 6:1; input/branco acima de 4:1. Separadores claros não
identificam controles. Estados sempre incluem texto, não só cor. Axe complementa
as verificações, sem comprovar conformidade completa.

Fonte `system-ui, sans-serif`, corpo 16 px/1,6; auxiliares 14 px; h1 de 28 a
38 px, h2 21 px. Escala de espaço 4, 8, 12, 16, 20, 24, 32 e 48 px.
Raios: controle 8–9 px, painel 16 px, badge circular. Sombra
`0 3px 12px #25223803`; bordas de 1 px. Alvos de 44 px ou maiores.
Não adicionar fontes remotas; fontes locais só se a avaliação justificar custo.

## Shell e navegação

360–430 px: topbar no fluxo, organização visível e navegação inferior com quatro
destinos: Início, Membros, Igrejas, Mais. Membros só aparece com capacidade
confirmada. Mais contém seleção organizacional e saída. Safe area inferior via
`env(safe-area-inset-bottom)`; conteúdo reserva espaço para a barra.
Formulário não tem ação fixa cobrindo campos. Na implementação, recolher a barra
quando necessário ao teclado virtual, preservando alternativa de navegação.

768 px: lateral de 184 px e painéis em duas colunas quando couberem.
A partir de 1200 px: lateral de 232 px, conteúdo limitado e margens de 48 px.
Não é necessário recolher sidebar nesta primeira versão: poucos destinos.
Listagem em linhas alinhadas no desktop, cartões textuais no celular; não
introduzir tabela complexa sem necessidade de comparação entre colunas.
Autenticação usa coluna central de até 700 px, sem navegação privada.

Skip link precede o shell; h1 recebe `tabIndex=-1` e foco após navegação real.
No protótipo, links carregam documentos completos. Preservar links nativos,
voltar/avançar, abertura em nova aba e rascunhos protegidos na aplicação futura.

## Componentes e arquitetura futura

Reutilizar exports existentes: Button, Input, Skeleton, Spinner, PendingButton,
InlineFeedback, PageProgress e, quando necessário, Dialog/AlertDialog e
Collapsible. Feedback confirmado pertence ao provider limitado por identidade.
Não usar toast para espera ou resultado incerto.

Permanecem no Levi: shell organizacional, filtros de membros, ficha religiosa,
seções de cadastro, etapas de onboarding e políticas globais. Um EmptyState
neutro poderá ser extraído após demonstrar uso nas listas de igrejas e membros;
um badge genérico só merece extração se houver segundo uso concreto. Nenhum
componente novo do pacote é pré-requisito desta proposta.

Tailwind v4 é a direção preferida, com `@source` explícito e imports públicos.
Tokens roxos devem ser escopados ao Levi, sem substituir o verde padrão do UI.
O consumidor original do pacote foi removido segundo o ADR atualizado; ainda
assim, validar testes de primitives e não alterar defaults compartilhados.

Não adicionar roteador na primeira migração visual. A composição atual é grande,
mas trocar o motor de navegação simultaneamente amplia risco de popstate,
rascunhos e respostas obsoletas. Avaliar roteamento declarativo em mudança
posterior, com benefício demonstrado e testes equivalentes de histórico/foco.

Migrar CSS por superfície, colocando legado em camada inferior após avaliar
cascata; aliases temporários explícitos. Não misturar resets globais sem revisão.
Remover regras somente após ausência de consumidores, inclusive `/admin`.

## Estados, linguagem e privacidade

- Carregando: moldura pública e skeleton estático com região nomeada/busy;
  não mostrar organização ou dados antes de validar identidade.
- Vazio confirmado: “Nenhum membro encontrado”, com ajuste de filtro. Não
  converter erro de consulta em lista vazia.
- Erro: mensagem junto ao campo, associação por descrição e foco no primeiro
  inválido; erro recuperável persistente com próxima ação.
- Resultado incerto: “Não foi possível confirmar. Consulte o resultado antes
  de tentar novamente.” Não prometer rollback nem sucesso.
- Sucesso: uma confirmação após resposta autoritativa; no protótipo, sempre
  identificada como simulação. Operações concorrentes bloqueadas.
- Indisponível/sem acesso: remover dados protegidos; consultar acesso. Admin
  não autorizado permanece recurso não encontrado.
- Informação ausente: “Não informado”; batismo sem data não significa “Não
  batizado”. Nunca inferir estado negativo a partir do desconhecido.

Microcopy em português brasileiro: verbos concretos, “Cadastrar membro”,
“Salvar alterações”, “Trocar organização”. Distinguir conta de membro e contato
de credencial. Sem nomes pessoais em toasts, títulos do navegador ou URLs.
Usar somente informações necessárias; nenhuma foto ou endereço na listagem.

`main.tsx` chama `takeLinkReturn` antes de renderizar; `session.ts` remove token,
fragmento e erros da URL, preservando apenas filtro institucional válido.
Guardar apenas chaves opacas autorizadas em sessionStorage, nunca payloads.
Preservar `useDraftGuard`, `useFormFocusVisibility`, geração de consultas,
revalidação de usuário/sessão/organização e descarte de respostas antigas.
Preservar CSP e `Referrer-Policy: no-referrer` na composição servidor/Worker.
Protótipos não reproduzem cabeçalhos HTTP nem provam essas proteções.
Nenhuma fonte remota, CDN, telemetria, persistência ou API nos protótipos.

## Protótipos e avaliação

Abrir [painel](prototipos/painel.html) diretamente no navegador. HTML, CSS e JS
locais, sem build. Cinco telas principais: painel, membros, formulário, detalhe
e onboarding. Auxiliares: login, igrejas e seleção de organização. Administração
global fica documentada, sem protótipo para evitar reduzir qualidade do núcleo.

Lista permite busca/situação e vazio; formulário demonstra espera/sucesso sem
salvar. Edição mantém igreja/situação bloqueadas. Onboarding mostra e-mail e
prévia da etapa organizacional; verificação real, senha e cooldown não são
simulados integralmente. Dados são fictícios e não representam indicadores reais.

Galeria externa:
`/home/admin/ai_reports/foundation/levi-ui-fase0-2026-10-29/index.html`.
Cinco larguras por tela: 360, 390, 768, 1024 e 1440 px. Altura de viewport
900 px; capturas de página inteira. Nenhuma imagem no repositório.

## Fases propostas e aceite

1. **Fundação, após aprovação:** commits separados para tokens/camadas e consumo
   UI; depois shell/navegação e feedback. Aceite: identidade isolada, foco e
   navegação preservados, nenhuma retenção privada em troca de contexto,
   typecheck e testes de componentes afetados aprovados.
2. **Telas:** agrupar onboarding/autenticação, painel/contexto e membros por
   fluxo coerente, sem impor um commit por tela. Aceite: contratos existentes,
   reenvio, resultado incerto, conflito de versão, filtros e permissões mantidos;
   E2E existentes focados e axe nas telas alteradas.
3. **Acabamento:** estados excepcionais, reflow, teclado, desempenho e remoção
   segura de legado/documentação. Aceite: cinco larguras sem overflow, zoom
   200%, foco visível/não encoberto, movimento reduzido, avaliação assistiva
   registrada e bundle comparado à linha de base, sem requisições externas.

Riscos principais: CSS de terceiros fora de camadas, barra inferior com teclado,
refetch sensível, migração de foco e divergência entre formulário visual e
contratos. Testar explicitamente antes de remover código atual. Aprovação visual
não autoriza mudanças funcionais, deploy ou uso de dados reais.

A Fase 0 encerra na avaliação desta proposta. Fases seguintes exigem aprovação
explícita do usuário.

### Registro de validação

Prettier dos entregáveis e `pnpm --filter levi format:check` aprovados.
As 25 combinações foram abertas por `file://` no Chromium, sem overflow
horizontal. Busca sem correspondência exibe vazio; Tab alcança controle nativo.
O axe identificou inicialmente aviso fora de landmark, corrigido para região
nomeada. Capturas regeneradas após correção. Revisão visual do painel móvel
realizada; não equivale a revisão humana completa de todas as capturas.

Não foram executados backend, suíte monorepo ou testes da aplicação real, pois
nenhum arquivo funcional foi alterado. Zoom 200%, leitor de tela, teclado virtual,
Safari físico e percurso completo por teclado permanecem inconclusivos.
Ausência de recursos externos verificada nas fontes locais, sem auditoria de
rede dedicada. Galeria usa imagens relativas e links nativos para ampliar.
A aprovação visual e essas verificações complementares são pendências para a
próxima fase; não se declara conformidade WCAG integral.

## Decisões de implementação — Fase 1

A autorização da Fase 1 sucede a proposta acima. O shell usa uma única
navegação responsiva; “Mais” é um disclosure nativo, sem criar rota nova,
com troca de organização e saída. O comportamento da barra com o teclado
virtual foi revisto na Fase 2.

O Levi consome Skeleton pelo export público de `@t00ls-dev/ui`, com a classe
local de placeholder estático. Os demais componentes serão avaliados por
superfície na Fase 2. Tailwind fica adiado: o CSS existente atende esta
integração sem acrescentar dependências de build ou reset global. Tokens e
estilos do shell pertencem ao aplicativo; defaults compartilhados permanecem.

## Decisões de implementação — Fase 2 (template e uso móvel)

Revisão do template com prioridade para o uso móvel. Contratos, permissões,
rascunhos protegidos e fluxos de navegação permanecem inalterados.

**Breakpoints.** O shell usa um único breakpoint de viewport, 48rem (768 px):
abaixo dele, topbar compacta e navegação inferior; a partir dele, lateral de
184 px (232 px a partir de 75rem). O conteúdo de `<main>` responde ao espaço
disponível por container queries (`panel`, limite de 40rem), e não à largura
da janela. Isso elimina a faixa de 768–1024 px em que telas móveis apareciam
dentro da lateral de desktop. Como a consulta usa rem, texto a 200% também
adota o layout estreito. O onboarding mantém duas colunas a partir de 64rem;
abaixo disso, a lista de etapas dá lugar a uma barra de progresso compacta
junto de “Etapa N de 3”.

**Navegação.** A ordem é a mesma no DOM e na tela: Início, Membros, Igrejas,
Mais. Não há reordenação por CSS. “Mais” continua um `<details>` nativo e
fecha com Escape (devolvendo o foco ao resumo), com toque fora e quando o foco
sai do menu. “Configurar senha” passa para “Mais” sempre que a navegação da
igreja existe; sem igreja, permanece na topbar. O nome da igreja ocupa uma
linha com reticências no celular e mantém o nome completo em `title`. Ícones
SVG substituem glifos de texto.

**Teclado virtual.** Com um campo de texto, data ou seleção em foco no celular,
a barra inferior recua para fora da tela (sem ocupar outro lugar), e o
formulário não se desloca. Ela volta quando o campo perde o foco.
`useFormFocusVisibility` desconta barras fixas ou aderentes que não contenham o
controle focado, e `scroll-padding-bottom` reserva a área da barra.

**Formulário de membro.** Com alterações não salvas, a área de ações fica
aderente ao fim da tela, acima da navegação. A posição não muda com o foco,
para que o botão não se desloque entre o toque e a soltura;
`useFormFocusVisibility` rola o campo em foco para acima da barra, que portanto
não cobre o que está sendo digitado. Os campos de membro usam
`autocomplete="off"`: são dados de outra pessoa, e o preenchimento automático
sugeriria os dados do operador. Endereço usa `textarea`; telefone usa
`inputMode="tel"`.

**Lista de membros.** A linha inteira abre a ficha (link estendido). O nome
acessível continua “Consultar ficha de <nome>”, contém o texto visível e
descreve a igreja por `aria-describedby`. A situação é filtrada por um controle
segmentado de rádios (Todas, Ativo, Inativo), visível em todas as larguras, e a
busca usa `type="search"`. A paginação mostra o intervalo exibido; o total não
é mostrado porque a API não retorna contagem, e acrescentá-la exigiria mudança
de contrato. Avatares recebem um de cinco tons estáveis, calculados pelo
identificador, sem fotos.

**Ficha e igreja.** Telefone e e-mail viram links `tel:` e `mailto:`; datas de
registro usam `Intl.DateTimeFormat` (`dateStyle: medium`). As telas de
administração da igreja ganham abas segmentadas, seções em superfícies,
formulário de convite em grade e ações empilhadas no celular. Cancelar convite e
revogar acesso usam estilo destrutivo.

**Painel.** Ações principais logo após o título; o círculo decorativo foi
removido.

**Tokens e CSS.** Todas as cores estão em `tokens.css`. O espaçamento segue a
escala `--space-N` = N × 4 px. O antigo `style.css` foi dividido por superfície
(`base`, `shell`, `access`, `churches`, `members`, `admin-global`), importados
em ordem fixa. Camadas `@layer` não foram adotadas: mudariam a precedência
entre arquivos e exigiriam revisão de cada seletor, sem ganho visível. Os
`!important` locais foram substituídos por especificidade explícita (o de
`[hidden]` permanece). Estados de hover ficam em `@media (hover: hover)`, para
não persistirem após toque. Títulos usam `clamp` com base em rem e
`text-wrap: balance`.

**Modo escuro.** A paleta escura redefine os mesmos tokens em
`prefers-color-scheme: dark`, com `theme-color` correspondente. Contrastes,
calculados pela luminância relativa sRGB: texto principal/superfície 14,4:1;
texto secundário/superfície 7,8:1; ação (`#c4b0f5`)/superfície 8,9:1;
branco/botão primário (`#6d4fc4`) 5,9:1; limite de controle/superfície 5,1:1;
erro, sucesso, selos e avatares acima de 8:1. No modo claro, avatares ficam
acima de 6,3:1 e o botão destrutivo em 7,1:1. Separadores continuam
decorativos.

**Instalação.** `web/public/assets` publica o manifesto, o ícone SVG e os PNGs
(180, 192, 512 e 512 _maskable_) sob `/assets`, já servido pelo Node e pelo
Worker, sem novas rotas. Não há service worker nem uso offline.

**Não adotado nesta fase.**

- AlertDialog no lugar de `window.confirm`. A guarda de rascunho precisa
  continuar síncrona em `popstate` e na navegação, e o componente compartilhado
  depende de classes Tailwind que o Levi não compila. Mantém-se o diálogo nativo,
  acessível e consistente com a plataforma.
- Seções opcionais recolhidas no cadastro. Ocultariam campos do foco de erro e
  da revisão antes de salvar; as seções já são curtas.
- Snapshots visuais versionados. Exigiriam imagens no repositório e variam
  entre fontes locais e da CI. A cobertura passa a ser feita por asserções de
  reflow, sobreposição e axe.

**Validação.** O novo `e2e/layout.spec.ts` roda nos projetos desktop e mobile e
também em `android-360` (Galaxy S8, 360 px), `tablet` (iPad Mini em Chromium,
768 px) e `iphone-landscape` (712 × 327). Em cada tela principal, incluindo
acessos e edição da igreja, verifica ausência de overflow com texto a 100% e
200%, navegação fixa sem cobrir o conteúdo e axe nos modos claro e escuro.
Também verifica o fechamento de “Mais” e o recuo da barra com campo em foco.
Teclado virtual real, VoiceOver/TalkBack e Safari físico continuam fora do
alcance da emulação.
