# Instruções do repositório

## Responsabilidades e referência

- Levi é a aplicação de gestão de igrejas. Foundation é o monorepo
  principal; esta cópia vive em `apps/levi` e consome seus pacotes pelo workspace.
  A operação DEV está integrada ao Foundation; consulte `docs/deploy-dev.md` para os gates vigentes.
- Consulte o [README](README.md) para o estágio atual e
  [Decisões do MVP](docs/decisoes-mvp.md) para o escopo vigente. Recomendações e
  relatos históricos não constituem aprovação de funcionalidades.
- Preserve trabalho preexistente e mantenha as mudanças no escopo autorizado.
  Incorporação de código/CI não autoriza deploy, migrations persistentes ou publicação.

## Reutilização e organização

- Prefira contratos públicos dos pacotes `@t00ls-dev/*` do Foundation para
  autenticação, tenancy, autorização, dados, segurança, e-mail e auditoria,
  conforme a necessidade. Confirme exports, versão e limitações antes de integrar.
- Regras eclesiásticas, políticas de acesso do produto e composição de seus dados
  pertencem ao Levi. Não duplique bibliotecas, infraestrutura ou processos
  compartilhados; justifique uma adaptação quando o contrato existente não bastar.
- Mantenha limites claros entre interface, contratos/validação, regras de negócio
  e persistência. Evite dependências de servidor na interface, abstrações
  especulativas e pacotes sem necessidade concreta.
- Use pnpm/lockfile e CI da raiz. Preserve configurações TypeScript, banco PG e
  runtime próprios; não copie o D1, credenciais ou publicadores do Links.
- Workflows sob `apps/levi/.github` são históricos, sem execução ativa no Foundation.

## Convenções e manutenção

- Escreva documentação, interface e mensagens ao usuário em português brasileiro.
  Preserve identificadores técnicos exigidos por APIs e bibliotecas.
- Use nomes descritivos; novos documentos usam minúsculas e hífens. Prefira links
  relativos dentro do repositório e uma única fonte para cada decisão.
- Ao iniciar código em etapa autorizada, adote TypeScript estrito e os padrões
  compatíveis do Foundation, com validação de entrada no servidor e contratos
  coerentes entre interface, API e persistência.
- Mantenha mudanças pequenas e dependências justificadas. Não versione segredos,
  configurações privadas, dados reais ou artefatos gerados desnecessários.

## Autenticação, isolamento e integridade

- Separe autenticação de autorização. Valide sessão, vínculo atual por igreja
  e acesso ao recurso no servidor; IDs e contexto enviados pelo cliente não
  concedem autoridade.
- Igreja é a fronteira operacional. Todo acesso a dados de domínio deve
  carregar e validar esse contexto, inclusive buscas, contagens e histórico.
  Os papéis por igreja são admin e collaborator; administração global não concede
  acesso local. Escritas revalidam autoridade na transação e preservam o último admin.
- Membro e conta de usuário são independentes; contato ou função eclesiástica não
  cria vínculo de login nem concede privilégios.
- Preserve as invariantes documentadas: integridade por igreja, UUID de
  servidor e operações relacionadas atômicas. Não suponha que adapters genéricos
  assegurem sozinhos transações, isolamento ou regras do Levi.
- Separe histórico pessoal eliminável de auditoria técnica mínima. Minimize dados
  em logs e relatórios; não registre credenciais ou perfis pessoais na auditoria.
- Considere a natureza sensível dos dados religiosos e a LGPD: finalidade, base
  legal, retenção, direitos dos titulares e recuperação são responsabilidades do
  produto, a definir antes do uso de dados reais.

## Evolução e validação

- O Levi é dono do schema composto e do histórico de migrations. A execução de
  migrations deve permanecer separada de inicialização, CI e deploy; CI pode
  validar o histórico em bancos sintéticos descartáveis, sem alterar banco
  persistente. Atualizar pacotes não deve adaptar o banco automaticamente.
- Valide proporcionalmente à mudança e registre limitações. Para documentação,
  confira diffs, links e coerência com as decisões. Não invente comandos de build
  ou teste enquanto não houver aplicação e scripts correspondentes.
- Ao implementar mudanças autorizadas, priorize testes de contrato e regras,
  integração PostgreSQL real para isolamento/integridade/transações e E2E dos
  fluxos críticos, com acessibilidade e uso móvel. Use dados sintéticos e serviços
  isolados; mocks não comprovam garantias de banco.
