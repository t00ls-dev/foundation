# @t00ls-dev/create-app

CLI privado do workspace para gerar o preset aprovado `basic-d1` para Cloudflare
Workers e D1. O comando não é interativo.

## Uso

Na raiz do Foundation, compile a ferramenta e informe um destino absoluto fora
do checkout:

```sh
pnpm --filter @t00ls-dev/create-app build
pnpm --filter @t00ls-dev/create-app exec node dist/bin.js /caminho/para/meu-app --preset basic-d1
```

O preset é opcional. O destino deve ser um diretório novo ou vazio; arquivos,
links simbólicos, raízes do sistema e diretórios não vazios são rejeitados e
nunca sobrescritos. Para consultar as opções:

```sh
pnpm --filter @t00ls-dev/create-app exec node dist/bin.js --help
```
