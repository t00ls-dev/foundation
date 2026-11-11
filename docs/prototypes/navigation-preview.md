# Protótipo: navegação lateral do Levi

Documento de referência de um protótipo mantido **apenas localmente**, em
`tools/navigation-preview/`. Registro em 11 de novembro de 2026.

## Status

O diretório não é versionado e permanece intencionalmente fora do Git, do
workspace pnpm e do CI. Não há build, teste automatizado, `package.json` nem
dependência instalada para ele. A documentação existe para registrar o que foi
explorado, sem transformar o protótipo em entrega do Foundation.

O código atual do Levi continua sendo a referência de comportamento; nada neste
protótipo foi integrado ao shell React.

## Objetivo

Validar interação e apresentação de uma navegação lateral antes de qualquer
mudança no Levi: abertura e fechamento do painel móvel, foco, navegação por
teclado, seleção de contexto de igreja, popover de conta e tela de configurações
da igreja.

A demonstração é estática e isolada da API. Ela serve para discutir fluxo e
identidade visual, não para medir desempenho, autenticação ou persistência.

## Como executar

A partir da raiz do repositório:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory tools/navigation-preview
```

Opcionalmente, para compartilhar a demonstração, o
`tools/navigation-preview/README.md` descreve o uso de `cloudflared tunnel`, que
cria um endereço público temporário e exige encerramento manual. O túnel não usa
credenciais e não deve ser tratado como ambiente de deploy.

Não há etapa de instalação: o protótipo usa apenas HTML, CSS e JavaScript
servidos como arquivos estáticos.

## Estrutura

| Caminho                  | Conteúdo                                            |
| ------------------------ | --------------------------------------------------- |
| `index.html`             | marcação das telas, painel móvel e popover de conta |
| `preview.js`             | interações, estado em memória e foco                |
| `style.css`              | layout, estados visuais e responsividade            |
| `levi-tokens.css`        | tokens de cor alinhados ao manifest do Levi         |
| `fonts/`                 | Instrument Sans e Bricolage Grotesque em WOFF2      |
| `assets/`                | ícones, manifest e OFL das fontes                   |
| `README.md`              | roteiro de teste manual e decisões de interação     |
| `THIRD_PARTY_NOTICES.md` | atribuições de terceiros                            |

O roteiro de exploração manual, incluindo o comportamento esperado de Tab,
Escape, toque fora e primeiro foco após a navegação, está no `README.md` do
próprio protótipo. Este documento não o duplica: alterações de interação devem
ser registradas lá.

## Identidade visual e acessibilidade

A paleta segue o manifest do Levi: roxo `#5936a2` e fundo `#f7f6fa`, com tons
derivados para superfícies e estados. Os tokens da aplicação ainda usam azul,
então a divergência é intencional e restrita ao protótipo.

O painel móvel usa `dialog.showModal()`, de modo que o navegador controla
modalidade e retenção de foco. A demonstração depende de marcação semântica,
nome acessível no painel e foco transferido ao título após a navegação. Não há
avaliação formal de acessibilidade nem teste assistivo registrado para o
protótipo; qualquer promoção a código do Levi exige essa validação.

## Dados e privacidade

Todos os dados são fictícios e vivem apenas na memória da página. O protótipo
não lê nem grava na API, não envia senhas e não encerra sessões reais: conta,
troca de senha e saída são simulações. Preferências de versões anteriores não
são lidas.

Se o túnel público for usado, o conteúdo da demonstração fica acessível por um
endereço temporário. Ele não deve receber dados reais de igrejas, membros ou
credenciais.

## Relação com o Levi

O protótipo reutiliza ícones, manifest, fontes e tokens copiados de `apps/levi`.
Ele não compartilha componentes, rotas, contratos ou estado com o app, e sua
remoção não afeta build, testes ou deploy.

## Critérios para promoção

Promover qualquer parte deste protótipo a código do Levi exige, no mínimo:

- decisão registrada em `docs/decisions/` sobre a nova navegação, se houver
  mudança de arquitetura ou de identidade visual;
- implementação no shell React do Levi, com os testes de componente, integração
  e E2E correspondentes;
- avaliação de acessibilidade do fluxo afetado, não apenas do protótipo;
- revisão de licenças e atribuições das fontes e dos assets reutilizados;
- atualização de `docs/project-status.md` quando a entrega for concluída.

## Licenças e atribuições

Fontes em `fonts/` e `assets/fonts/` mantêm suas licenças OFL, preservadas no
próprio diretório. Ícones e manifest pertencem ao Levi, sob a licença do
repositório. As atribuições consolidadas estão em
`tools/navigation-preview/THIRD_PARTY_NOTICES.md`.
