# Interface de onboarding

A SPA React permite verificar o e-mail, definir senha, entrar na conta,
criar igrejas independentes, selecionar uma igreja
autorizada, consultar a ficha ativa e acessar um painel de atalhos. O escopo permanece em
[Decisões do MVP](decisoes-mvp.md); a API e a preparação do banco sintético estão em
[Onboarding e provisionamento](onboarding-provisionamento.md).

## Estrutura e execução

Aplicação do workspace pnpm do Foundation, com TypeScript estrito. `web/src/app.tsx` compõe os estados da
interface; `forms.tsx` contém os formulários; `api.ts` valida as respostas HTTP;
`session.ts` trata retornos de links e a chave de idempotência. O frontend não
importa módulos de servidor, schema, adapters ou credenciais. React, React DOM e o componente público Skeleton compõem a interface. Vite produz os assets;
Playwright e Axe são ferramentas de teste. O Skeleton vem do export público de `@t00ls-dev/ui`, com classe e CSS locais; não há biblioteca de estado global.

Após configurar o ambiente local sintético conforme o guia da API, na raiz do Foundation:

```sh
pnpm install --frozen-lockfile
pnpm --filter levi dev
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
`/`, `/onboarding`, `/entrar`, `/igrejas/selecionar`, `/painel`, `/igrejas` e as rotas de membros
listadas em `src/web-paths.ts`. Rotas desconhecidas da
API continuam retornando JSON, sem fallback HTML. Migrations continuam explícitas
e separadas da inicialização e do build. A publicação Worker DEV usa o
[fluxo manual com gate de CI](deploy-dev.md).

## Fluxo e retomada

1. Informe o e-mail e abra o primeiro link recebido. A tela de confirmação não
   informa se uma conta já existe.
2. O Magic Link nativo verifica o e-mail e estabelece uma sessão recente.
3. Continue com a sessão verificada. A primeira senha é opcional e pode ser
   definida posteriormente com sessão recente; login por senha existente permanece disponível.
4. Informe o nome da igreja. Endereço, telefone e
   e-mail da igreja são opcionais, em uma seção expansível sem etapa adicional.
   Após o provisionamento confirmado, a SPA confere o vínculo e o contexto
   autorizado antes de abrir o painel, com confirmação e cadastro de membro
   como próxima ação opcional. A recuperação de resposta incerta consulta o
   estado antes de qualquer reenvio.

O login recorrente não exibe as três etapas de primeiro acesso. Durante a espera,
o endereço informado aparece para conferência e fica apenas em memória. Reenviar
não exige redigitação; alterar o e-mail é uma ação explícita. O reenvio aguarda
60 segundos após sucesso e respeita o prazo retornado em `429`.

Sem vínculo, a conta pode criar uma igreja. Contas com vínculos também podem
criar outras igrejas independentes. O seletor apresenta o papel atual em cada
igreja. Edição institucional e gestão de acessos existentes exigem admin.

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
onboarding, senha, login/logout nativos, criação/listagem de igrejas,
seleção de igreja, contexto e listagem de igrejas. Todas as chamadas são relativas,
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
- `GET /api/churches` retorna vínculos com papel e versão, paginados por `next`.
  `GET /api/context` informa a igreja e o papel atual. Respostas tardias são
  descartadas após mudança de identidade ou geração de contexto.

O backend mantém a allowlist de auth, CSRF/origem e autorização atual. A SPA
não concede autoridade por URL ou estado local. A ficha, edição e gestão dos
acessos estão descritas em [Núcleo de igrejas](nucleo-igrejas.md).
A [interface de membros](gestao-membros.md) opera exclusivamente na igreja ativa.
Não há busca global de usuários ou exclusão de igrejas.

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

## Direção da interface

A referência foi a organização visual dos [dashboards Preline](https://preline.co/blocks/application-pages/admin-dashboard-pages/)
e seus [formulários](https://preline.co/blocks/forms/create-and-edit-forms/),
com inspeção do preview. Não há biblioteca Preline, Tailwind, fontes remotas ou
serviços externos para renderização. O Levi usa CSS e componentes React próprios,
tema claro, violeta, tipografia de sistema e ícones neutros. O Foundation continua
fornecendo os contratos técnicos, sem fornecer a identidade visual do produto.

A navegação e o CSS seguem as decisões implementadas das Fases 1/2 em
[Design UI](design-ui.md). O shell mantém identificação da igreja ativa e
navegação móvel; listas, formulários e feedback respeitam as capacidades atuais.

Os rascunhos ficam em memória. Ao recuperar foco, a aplicação consulta o servidor
sem desmontar o formulário preenchido; perda de acesso remove dados protegidos.
Erros de rede preservam valores, e o provisionamento incerto mantém sua chave e
consulta do resultado. Aviso nativo de saída é uma proteção adicional, sem promessa
de recuperação após encerramento do navegador pelo iOS. Senhas/tokens continuam
sem persistência. O controle focado é reposicionado por rolagem quando necessário para ficar fora
dos limites da área útil, respeitando o viewport visual. Cabeçalho e navegação não cobrem os campos.
A redução da área útil da tela é testada com viewport menor,
sem afirmar teste de teclado virtual real ou VoiceOver.

A seleção usa `POST /api/context/church`; membros operam na igreja ativa com
`X-Levi-Church`. Não há contrato de seleção por `?igreja=`. Filtros e rascunhos
ficam em memória e são descartados na mudança de identidade ou contexto.

Durante consultas entre telas de gestão, apenas a moldura pública é preservada,
com placeholders estáticos. Organização, navegação autorizada, dados e avisos são
removidos antes da revalidação. Respostas obsoletas são descartadas pela geração
da consulta; erros e ausência de acesso não conservam a moldura de gestão.
Não há cache de conteúdo privado entre sessões. A lista guarda somente seus
critérios em memória na mesma sessão, sem reter respostas de membros ao navegar.

## Convites por e-mail

Em **Gerenciar acessos**, administradores convidam por e-mail como Administrador
ou Colaborador, consultam estados, cancelam e reenviam. O prazo é de sete dias;
o reenvio substitui os convites abertos para o mesmo e-mail naquela igreja.
O envio não cria conta, vínculo ou membro da congregação.

O destinatário abre `/convite`, entra pelo Magic Link existente (conta nova ou
existente) e confirma o aceite. O token sai da URL ao abrir a página, permanece
somente em memória e não é guardado no navegador. Para retomar após fechar ou
recarregar a página, reabra o e-mail. O retorno do Magic Link leva novamente ao
convite. A seleção atual de igreja é preservada; após aceitar, selecione a igreja.

O servidor exige e-mail verificado correspondente e autoridade atual do emissor.
Convites inválidos, expirados, cancelados, usados ou de outro e-mail falham sem
revelar dados da igreja. Vínculo existente é preservado, inclusive seu papel;
um administrador pode ajustá-lo pela gestão de acessos. O envio para quem já
possui vínculo é recusado. Alterar ou revogar um acesso cancela os convites
pendentes anteriores daquela pessoa na igreja.

A migration aditiva `0008_convites-igreja` cria somente a tabela de convites e
seus índices/ACLs. Sua aplicação persistente exige autorização separada. Tokens
aleatórios de 256 bits são armazenados apenas como hash. Auditoria transacional
registra IDs e ações, sem e-mail ou token. As quotas duráveis existentes limitam
requisições e envios por destinatário e orçamento global. Falha ou limite de envio
não confirma o novo convite; o anterior permanece válido no rollback. E-mail e
commit não são atômicos: em falha de conexão após entrega, consulte o estado antes
de reenviar; um link entregue sem commit será recusado. Não há retry automático.
