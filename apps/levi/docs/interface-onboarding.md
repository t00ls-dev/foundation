# Interface de onboarding

A SPA React permite verificar o e-mail, definir senha, entrar na conta,
provisionar a organização com a primeira igreja, selecionar uma organização
administrada, consultar suas igrejas e acessar um painel de atalhos. O escopo permanece em
[Decisões do MVP](decisoes-mvp.md); a API e a preparação do banco sintético estão em
[Onboarding e provisionamento](onboarding-provisionamento.md).

## Estrutura e execução

Aplicação do workspace pnpm do Foundation, com TypeScript estrito. `web/src/app.tsx` compõe os estados da
interface; `forms.tsx` contém os formulários; `api.ts` valida as respostas HTTP;
`session.ts` trata retornos de links e a chave de idempotência. O frontend não
importa módulos de servidor, schema, adapters ou credenciais. React e React DOM
são as únicas dependências de execução adicionadas. Vite produz os assets;
Playwright e Axe são ferramentas de teste. Não há biblioteca de UI ou estado global.

Após configurar o ambiente local sintético conforme o guia da API:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Abra **http://localhost:5173**. O comando inicia Vite e Hono e encerra seus próprios
processos ao sair. Vite encaminha `/api` à API em loopback, preservando `Origin`,
cookies e `Set-Cookie`; não habilita CORS nem reescreve cookies. A origem pública
5173 é configurada no servidor para os links de e-mail e a validação de origem.
Use esse hostname de forma consistente. Para iniciar os processos separadamente:

```sh
LEVI_PUBLIC_ORIGIN=http://localhost:5173 pnpm --filter levi dev:api
# Em outro terminal, com a mesma LEVI_PORT se personalizada:
pnpm --filter levi dev:web
```

`pnpm --filter levi build` compila API e SPA em `dist/`. `pnpm --filter levi start` serve ambos pela origem
local 3000. `src/web.ts` entrega HTML apenas nos caminhos conhecidos da SPA:
`/`, `/onboarding`, `/entrar`, `/organizacoes`, `/painel`, `/igrejas` e as rotas de membros
listadas em `src/web-paths.ts`. Rotas desconhecidas da
API continuam retornando JSON, sem fallback HTML. Migrations continuam explícitas
e separadas da inicialização e do build. A publicação Worker DEV usa o
[fluxo manual com gate de CI](deploy-dev.md).

## Fluxo e retomada

1. Informe o e-mail e abra o primeiro link recebido. A tela de confirmação não
   informa se uma conta já existe.
2. O Magic Link nativo verifica o e-mail e estabelece uma sessão recente.
3. Defina e confirme a senha diretamente no formulário, sem outro e-mail. A conta
   pronta pode continuar com a sessão já estabelecida. A tela de login permite
   autenticar sessões posteriores.
4. Informe os nomes da organização e da primeira igreja. Endereço, telefone e
   e-mail da igreja são opcionais, em uma seção expansível sem etapa adicional.
   Após o provisionamento confirmado, a SPA confere o vínculo e o contexto
   autorizado antes de abrir o painel, com confirmação e cadastro de membro
   como próxima ação opcional. A recuperação de resposta incerta consulta o
   estado antes de qualquer reenvio.

O login recorrente não exibe as três etapas de primeiro acesso. Durante a espera,
o endereço informado aparece para conferência e fica apenas em memória. Reenviar
não exige redigitação; alterar o e-mail é uma ação explícita. O reenvio aguarda
60 segundos após sucesso e respeita o prazo retornado em `429`.

Sem vínculo administrativo, o servidor distingue conta nova de conta já
provisionada por seu recibo. `sem-acesso` mostra orientação e atualização do
acesso, inclusive após reload ou novo login, sem oferecer criação de outra
organização. Múltiplos vínculos continuam disponíveis no seletor autorizado.

A primeira leitura e cada retorno/atualização consultam `/api/onboarding`. Refresh
retoma a etapa real do servidor; links inválidos, expirados ou reutilizados
orientam solicitar outra mensagem. Se o link de senha for aberto sem a sessão
verificada, é necessário restabelecer essa sessão e solicitar outro link.

O token de senha é retirado imediatamente da URL, inclusive fragmentos/erros,
antes de renderizar React. Permanece somente na memória da página e é descartado
após aplicação ou erro. Atualizar essa página exige novo e-mail: não se persiste o
segredo para conservar o formulário. Não há analytics, logs de requests,
service worker ou armazenamento de tokens de sessão. Cookies permanecem HttpOnly.

Somente a chave opaca `levi.onboarding.request` pode ficar em `sessionStorage` para
repetir provisionamento. Nomes, e-mail, senha e payload não são persistidos. Falha
de rede não significa falha da transação: a interface exige consultar o resultado
antes de reenviar e conserva a chave. Após refresh, consulta a etapa antes de
mostrar o formulário. O servidor continua responsável pela atomicidade e pelos
conflitos. Botões e submissões concorrentes são bloqueados durante operações.

## Contratos e segurança

O cliente usa somente os endpoints documentados da API: consulta/emissão de
onboarding, senha, login/logout nativos, provisionamento/listagem de organizações,
seleção de tenant, contexto e listagem de igrejas. Todas as chamadas são relativas,
com cookies de mesma origem, sem cache e com limite de espera de 15 segundos.
Respostas são validadas antes de abrir estados protegidos. `401`/`403` removem os
dados exibidos e reconsultam a sessão/vínculos; `409` não concede acesso nem cria
uma nova tentativa automaticamente. Erros de conexão não expõem a exceção original.

A composição web utiliza contratos mínimos, preservando a política de autenticação:

- `GET /api/session-context` fornece apenas IDs internos de usuário e sessão,
  sem token/cookie, com `401` para sessão ausente ou expirada. A SPA compara
  essa identidade antes de reutilizar estado e antes de exibir dados consultados.
  Nova sessão, mesmo da mesma conta, descarta filtros, rascunhos, avisos, tentativas
  locais e respostas obsoletas. Uma troca observada também limpa esperas do cliente;
  os limites impostos pelo servidor continuam independentes.
- O callback de onboarding aceita uma opção estática `/onboarding` na composição
  local. O padrão `/api/onboarding` permanece para consumidores da API. Nenhum
  destino de redirecionamento é aceito do usuário.
- `GET /api/churches` conserva `churches` e acrescenta `organizationId`, obtido do
  mesmo contexto autorizado usado na consulta. Um teste reproduziu a troca de
  tenant entre a leitura do contexto e a leitura das igrejas. Se os IDs diferirem,
  a SPA retorna à seleção, impedindo mostrar igrejas sob o nome de outra organização.

O backend mantém a allowlist de auth, CSRF/origem, validação de prontidão e vínculo
atual. A SPA não concede autoridade por URL ou estado local. Não há UI para criar
outras organizações, igrejas adicionais, convites ou permissões locais. A
[interface de membros](gestao-membros.md) só aparece quando o servidor informa
a capacidade da organização ativa; troca de contexto remove os dados anteriores.

## Validação

```sh
pnpm --filter levi format:check
pnpm --filter levi typecheck
pnpm --filter levi test
pnpm --filter levi build
pnpm --filter levi test:integration
pnpm --filter levi test:e2e
```

As duas últimas suítes exigem Docker disponível; cada comando cria e remove seu
próprio PostgreSQL sintético, sem usar uma URL externa. O E2E exige o Chromium da
versão instalada do Playwright (`npx playwright install chromium`, se ausente).
O build deve preceder o E2E. As portas 4317, 4318 e 5173 precisam estar livres;
processos existentes não são reutilizados. É possível filtrar casos, por exemplo
`pnpm --filter levi test:e2e --project=desktop --grep 'fluxo real completo'`.

O navegador exercita a confirmação capturada localmente, links legados, cookies reais,
login/logout, retomada, seleção, revogação e consultas PostgreSQL. Falhas de rede
são induzidas antes e depois do commit; outra conexão confere o resultado. Há
cenários explicitamente interceptados para `401`/`403`/`409`, além dos testes
reais de autorização e conflito no backend. Interceptações não comprovam garantias
do banco. Nenhum e-mail é enviado externamente.

Desktop e emulação móvel Chromium validam teclado, ausência de overflow horizontal
e Axe (WCAG 2 A/AA e 2.1 AA) nas telas de e-mail, provisionamento e igrejas. Labels,
erros associados, foco visível, regiões de status e contraste foram considerados.
Isso constitui acessibilidade básica, não certificação ou teste em aparelho físico.
Firefox não faz parte da suíte atual. O projeto móvel padrão usa iPhone 13 Mini
emulado em Chromium. `LEVI_WEBKIT=1 pnpm --filter levi test:e2e --runtime-acls` inclui
o mesmo conjunto no WebKit (instale com `npx playwright install --with-deps webkit`).
WebKit em Linux não equivale a Safari real nem ao teclado virtual de um iPhone.

Traces, vídeos, screenshots automáticos de falha e mensagens de erro originais do
runner são desabilitados para evitar cópias de links/credenciais. O reporter
registra títulos e localização da asserção, sem seus valores. Capturas
explícitas da interface, exclusivamente com fixtures sintéticas e sem tokens,
ficam em `.local/e2e/`, ignorado pelo Git. O logger de proxy
Vite também omite URLs em erros. A caixa sintética temporária é removida no final.

Entrega externa de e-mail e operação pública pertencem à composição Worker DEV,
conforme [Deploy DEV](deploy-dev.md). O E2E permanece sintético e local; não
comprova entrega externa ou operação remota nem autoriza dados reais.
O modo `pnpm --filter levi test:e2e --runtime-acls` preserva os mesmos cenários usando
login restrito; é o modo executado na CI.

Capturas finais e roteiro de revisão estão nas [evidências da interface](evidencias-interface/index.md).

## Direção da interface

A referência foi a organização visual dos [dashboards Preline](https://preline.co/blocks/application-pages/admin-dashboard-pages/)
e seus [formulários](https://preline.co/blocks/forms/create-and-edit-forms/),
com inspeção do preview. Não há biblioteca Preline, Tailwind, fontes remotas ou
serviços externos para renderização. O Levi usa CSS e componentes React próprios,
tema claro, violeta, tipografia de sistema e ícones neutros. O Foundation continua
fornecendo os contratos técnicos, sem fornecer a identidade visual do produto.

A navegação lateral desktop se torna uma grade no fluxo da página em tablets e celulares, com áreas de
toque de pelo menos 44 px e identificação persistente da organização. A lista de
membros usa linhas compactas no desktop e cartões no móvel, sem tabela larga.
Formulários são divididos por assunto e a confirmação fica ao final, sem barra
flutuante sobre os campos. Há estados vazio, carregando, erro e sucesso. A ficha
oferece edição conforme o [contrato de membros](gestao-membros.md#edição-cadastral).
O painel mostra apenas o número de igrejas já retornadas pela API e atalhos;
não inventa contagens de membros, gráficos ou módulos.

Os rascunhos ficam em memória. Ao recuperar foco, a aplicação consulta o servidor
sem desmontar o formulário preenchido; perda de acesso remove dados protegidos.
Erros de rede preservam valores, e o provisionamento incerto mantém sua chave e
consulta do resultado. Aviso nativo de saída é uma proteção adicional, sem promessa
de recuperação após encerramento do navegador pelo iOS. Senhas/tokens continuam
sem persistência. O controle focado é reposicionado por rolagem quando necessário para ficar fora
dos limites da área útil, respeitando o viewport visual. Cabeçalho e navegação não cobrem os campos.
A redução da área útil da tela é testada com viewport menor,
sem afirmar teste de teclado virtual real ou VoiceOver.

Os atalhos das igrejas abrem a lista de membros com `?igreja=UUID`. Esse filtro
institucional é preservado no reload; parâmetros de tokens, nomes e erros são
removidos da URL. Buscas por nome e rascunhos não são persistidos. O retorno da
ficha conserva filtros e paginação apenas em memória, vinculados à identidade
validada e à organização. Trocar organização ou sessão descarta esse recorte;
reload conserva apenas o ID institucional explícito da igreja, sem nome de pessoa.

Durante consultas entre telas de gestão, apenas a moldura pública é preservada,
com placeholders estáticos. Organização, navegação autorizada, dados e avisos são
removidos antes da revalidação. Respostas obsoletas são descartadas pela geração
da consulta; erros e ausência de acesso não conservam a moldura de gestão.
Não há cache de conteúdo privado entre sessões. A lista guarda somente seus
critérios em memória na mesma sessão, sem reter respostas de membros ao navegar.
