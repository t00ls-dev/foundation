# `@t00ls-dev/doctor`

CLI privado de diagnóstico determinístico e somente leitura para projetos Node e
Cloudflare D1. Verifica versão do Node, manifesto, configuração Wrangler, nomes
obrigatórios de secrets, bindings, migrations e scripts de banco. Identifica
arquivos de secrets rastreados sem expor seus valores.

## Uso

```sh
pnpm --filter @t00ls-dev/doctor build
pnpm --filter @t00ls-dev/doctor exec node dist/bin.js /caminho/absoluto/para/app --json
pnpm --filter @t00ls-dev/doctor exec node dist/bin.js /caminho/absoluto/para/app --required AUTH_SECRET --required API_TOKEN
```

O diretório padrão é o atual. Os nomes exigidos por padrão são `AUTH_SECRET`,
`BASE_URL`, `EMAIL_FROM` e `RESEND_API_KEY`. Opções `--required NAME` substituem
essa lista. Erros de diagnóstico retornam status 1; uso inválido retorna 2.
Avisos isolados não falham o comando.

## API de biblioteca

`diagnoseProject(path, options)` retorna `DoctorReport`. Cada resultado possui
`check`, `severity` (`info`, `warning` ou `error`), `message` e opcionalmente
`path` relativo ao projeto. O relatório inclui nomes e caminhos, nunca valores
de secrets.
