# Pacotes internos do Foundation

Os pacotes Foundation são privados e consumidos exclusivamente no monorepo por
dependências `workspace:*`, resolvidas como links locais pelo pnpm. A
distribuição npm foi encerrada; não há automação de publicação ou versionamento
por Changesets. Versões e changelogs existentes são históricos. Builds, APIs,
testes e deploys das aplicações permanecem independentes.

## Consumo e validação

Adicione a dependência no manifesto do consumidor dentro de um dos globs de
`pnpm-workspace.yaml`, por exemplo:

```json
{ "dependencies": { "@t00ls-dev/config": "workspace:*" } }
```

Execute `pnpm install` na raiz e versione o lockfile. Compile com `pnpm build`;
os consumidores usam os exports públicos locais. Sete dependências Foundation do
Levi são compiladas; `@t00ls-dev/ui` fornece fontes TSX ao bundler. O Levi segue
esse contrato. O gerador basic-d1 usa bibliotecas upstream diretamente e não
depende de pacotes Foundation publicados.

`pnpm test:workspace` verifica manifests privados, protocolos internos, links
reais, lockfile e o grafo de builds. O gate final é `pnpm check`. Consulte
[Testes](testing.md).

Os adaptadores D1 preservam seus tipos oficiais e o perfil Workers de `db/d1`;
veja o [README do db](../../packages/db/README.md).

## Limites operacionais

Esta mudança não publica, despublica ou deprecia versões existentes no npm, nem
revoga credenciais ou altera Trusted Publishers externos. Nenhuma versão
histórica no registry é necessária para instalar ou compilar o workspace. Não
existe fluxo de release externo vigente. Deploys e migrations mantêm seus gates
e autorizações próprios.
