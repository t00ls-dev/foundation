# Levi

Aplicação de gestão de igrejas da t00ls-dev, incorporada ao Foundation em
`apps/levi`. Organização é a fronteira de tenant; igreja é contexto funcional
interno; membro não é conta de usuário. API, UI, schema, migrations, ACLs e
recursos operacionais pertencem à aplicação.

## Origem e histórico

O código está em [apps/levi](./) no repositório t00ls-dev/foundation.
O histórico incorporado é identificado pelo commit
[`b2c892e27e3a8988f0be554692ffea43d35fcd61`](https://github.com/t00ls-dev/foundation/commit/b2c892e27e3a8988f0be554692ffea43d35fcd61).
A atribuição a um repositório `t00ls-dev/levi` no texto do commit de importação
está incorreta; esse repositório nunca existiu. O histórico Git foi preservado.
A incorporação usa subtree sem squash sobre Foundation
`3f892412a3f223df7ea394720b3bfe5b149c01c6`. O commit
`dfd1192b7b5e509878f65bec09228cb269d9cd82` preserva a árvore original sob
`apps/levi` e os 35 commits alcançáveis, com autoria, datas e SHAs intactos.
Adaptações de workspace, CI e licença são commits posteriores. Caminhos antigos
continuam na raiz dos commits originais; seguir apenas o prefixo atual não mostra
automaticamente todo o passado. O grafo incorporado pode ser consultado neste monorepo.
Para manter esse grafo na master, a integração do PR exige merge commit, sem squash.

## Estado e limites operacionais

A aplicação inclui entrada única por Magic Link para contas novas e existentes, com senha opcional posterior,
provisionamento atômico de organização/igreja/membership/auditoria, contexto
organizacional, gestão de membros e interface React. Os testes usam PostgreSQL
descartável e runtime workerd local.

O Foundation é o publicador DEV autorizado. O [publicador manual](../../.github/workflows/deploy-levi-dev.yml)
usa `t00ls-dev/foundation/master` e o Environment `levi-dev`, com token Cloudflare
único. Esta revisão adota cadastros canônicos LEVI_ e o gate `LEVI_DEPLOY_READY`;
a migração administrativa dos nomes ainda precisa ser realizada antes de qualquer
execução da nova definição. Os arquivos em [.github](.github/README.md) continuam
históricos. Esta padronização não altera cadastros reais nem autoriza publicação;
ver [Deploy DEV](docs/deploy-dev.md).
Worker, domínio, PostgreSQL/Neon, Hyperdrive, e-mail e credenciais permanecem
independentes do Links. Produção não está implementada.

Migrations persistentes exigem operação independente e autorizada. Importar,
instalar, compilar ou iniciar a aplicação não aplica migrations persistentes.
Replays de migrations em containers sintéticos isolados continuam permitidos.
A documentação histórica de DEV não atesta o schema/ACLs ou a configuração
remota atual; conferi-los antes de qualquer transferência operacional.

## Administração global

A [administração global](docs/administracao-global.md) usa sessão autenticada,
e-mail verificado e correspondência com o secret LEVI_ADMIN_EMAIL. O backend
protege `/admin` e suas APIs antes da entrega de HTML. Concessões históricas não
concedem acesso e não há gestão de administradores pelo painel. Tabelas e dados
existentes são preservados, assim como auditoria, flags, permissões e isolamento.
A configuração exige sincronização privada em publicação posteriormente autorizada.
Não altera a disponibilidade atual de membros.

## Workspace e validação

Node `>=22.22.0`, pnpm `10.15.1` e lockfile único na raiz do Foundation.
O pacote continua `levi@0.1.0`, privado. Os sete pacotes Foundation já utilizados
resolvem por `workspace:*` e exports públicos compilados, sem depender de npm.
Não há dependência do Links nem consumo de fontes internas de outro pacote.

Na raiz do monorepo:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=levi
pnpm --filter levi typecheck
pnpm --filter levi test
pnpm --filter levi worker:build
pnpm --filter levi test:integration
pnpm --filter levi test:integration --runtime-acls
pnpm --filter levi test:worker --runtime-acls
pnpm --filter levi exec playwright install --with-deps chromium
pnpm --filter levi test:e2e --runtime-acls
```

`worker:build` é apenas dry-run local. Integração, Worker e E2E exigem Docker,
criam seus próprios bancos sintéticos e os removem ao final; não recebem secrets
ou Environments operacionais. A CI raiz tem jobs próprios `levi-tests` e
`levi-e2e`, incluindo ACLs restritas, ligados ao agregador único `checks`.
O gate raiz `pnpm check` mantém os testes Foundation e adiciona o contrato runtime
do Levi. Os reporters Vitest e Node permanecem separados.

Para desenvolvimento com banco exclusivamente local, siga
[Onboarding](docs/onboarding-provisionamento.md). Execute em `apps/levi` ou use
`pnpm --filter levi dev`; não há carregamento automático de `.env`. O Vite usa
`http://localhost:5173` e a API usa loopback na porta 3000. `pnpm --filter levi start`
serve o build e a API localmente. Preserve cwd e reserve portas diferentes quando
executar outro aplicativo simultaneamente.

## Versões, licença e separação futura

A versão própria permanece no manifest; deploy não implica nova release.
Todos os pacotes Foundation são privados e consumidos com `workspace:*`.
A distribuição npm e o versionamento por Changesets foram encerrados.

O código próprio adota [MIT](LICENSE). [Avisos de terceiros](THIRD_PARTY_NOTICES.md)
preservam as licenças de ícones e dependências. A licença no histórico incorporado
não foi alterada. Extração futura leva a aplicação com seu histórico/proveniência
e seu fecho de dependências;
não exige banco, sessão ou deploy compartilhado com outro aplicativo.

## Documentação

- [Decisões do MVP](docs/decisoes-mvp.md).
- [Instruções da aplicação](AGENTS.md).
- [Onboarding e provisionamento](docs/onboarding-provisionamento.md).
- [Cloudflare Workers](docs/cloudflare-workers.md).
- [Preparação do publicador manual DEV](docs/deploy-dev.md).
- [Interface e onboarding](docs/interface-onboarding.md).
- [Gestão de membros](docs/gestao-membros.md).

A entrada por Magic Link não exige senha nem vínculo organizacional. A conta sem igrejas oferece o cadastro atual da primeira igreja e orientação para solicitar convite ao responsável; os novos serviços de igrejas e convites ainda não estão implementados. A primeira senha é opcional, configurada posteriormente com sessão verificada recente; credenciais existentes e recuperação por e-mail permanecem disponíveis. A administração global mantém a autoridade configurada e seus gates de sessão, sem exigir senha.
