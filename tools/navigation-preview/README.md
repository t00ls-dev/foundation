# Preview de navegação lateral

Demonstração estática com dados fictícios, isolada da API do Levi. Usa HTML, CSS
e JavaScript, com `dialog.showModal()` para o painel móvel. É um protótipo para
validar interação e apresentação; ainda não integra o shell React do Levi.

Execute a partir da raiz:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory tools/navigation-preview
cloudflared tunnel --url http://127.0.0.1:4173 --no-autoupdate
```

O túnel gera um endereço público temporário. Nenhuma credencial é necessária. Os
dados editados ficam apenas em memória nesta demonstração. Não há gravação na
API nem compartilhamento entre usuários.

Neste servidor, os processos foram iniciados como unidades transitórias:
`foundation-navigation-preview` e `foundation-navigation-tunnel`. Para encerrar:

```sh
systemctl stop foundation-navigation-tunnel foundation-navigation-preview
```

Experimente abrir e fechar o menu, usar Tab/Escape, navegar entre destinos,
expandir Organização e editar Configurações antes de tentar sair. Em telas acima
de 900 px, a lateral fica visível. O navegador controla a modalidade e o foco; a
aplicação transfere foco ao título após a navegação.

## Identidade visual

A referência de cor é o manifest do Levi: roxo `#5936a2` e fundo `#f7f6fa`. O
preview reutiliza os ícones originais de `apps/levi/web/public/assets`,
inclusive o favicon SVG, os PNGs e o manifest. Fontes e tokens foram copiados do
Levi; os tokens de cor desta demonstração foram alinhados ao manifest, com tons
derivados para estados e superfícies. As fontes mantêm suas licenças em
`assets/fonts`. Os tokens da aplicação Levi ainda usam azul; esta mudança visual
se limita ao preview.

## Identidade da igreja

O nome e as iniciais da igreja aparecem somente na lateral. O cabeçalho contém o
botão de navegação móvel e o menu da conta. A marca Levi aparece discretamente
no rodapé. A identificação no topo é estática. Trocar igreja é uma opção
secundária no fim da lateral, separada por uma linha e acompanhada de um ícone
de troca. A lista abre acima do botão e indica a igreja atual. Existem três
contextos fictícios para demonstração.

O formulário de personalização foi removido. Configurações mantém somente a
edição cadastral de nome, em memória. Preferências salvas pela versão anterior
não são mais lidas. A marca do navegador e o manifest originais são preservados.

## Conta e configurações da igreja

O avatar da barra superior abre um popover nativo com Minha conta, Trocar senha
e Sair da conta. Escape e toque fora fecham o popover. O painel móvel tem nome
acessível, sem título visível; nome e símbolo da igreja ficam lado a lado.
Configurações da igreja permanece na lateral.

As páginas de conta, alteração de senha e saída são simulações. O formulário
valida a confirmação e limpa os campos ao concluir, sem gravar ou enviar senhas.
Sair mostra o estado de encerramento da demonstração; não encerra sessões reais.

O seletor fecha com Escape ou toque fora. Dentro do painel móvel, o primeiro
Escape fecha a lista e o seguinte fecha o painel. As iniciais do botão da conta
usam alinhamento central e padding zero.
