# Criação de uma aplicação

Na v0.1, `@t00ls-dev/create-app` gera apenas o preset autônomo `basic-d1`.

```bash
pnpm --filter @t00ls-dev/create-app build
pnpm --filter @t00ls-dev/create-app exec node dist/bin.js /caminho/para/meu-app --preset basic-d1
```

O destino deve ser novo ou vazio. O gerador não sobrescreve arquivos.

## Depois da geração

1. execute `pnpm install` no projeto gerado;
2. copie `.dev.vars.example` para `.dev.vars` e preencha valores locais;
3. crie o D1 e substitua `REPLACE_WITH_D1_DATABASE_ID`;
4. execute `pnpm db:migrate:local`;
5. execute `pnpm typecheck` e `pnpm build`;
6. configure ambientes, cache bypass e secrets antes do deploy remoto.

O preset inclui React, React Router, React Hook Form, Zod, Hono, D1, Drizzle,
Better Auth e Resend. Ele não inclui tenancy, billing, storage ou telemetria.

## Decisões no ponto zero

Antes de iniciar um produto real, registre pelo menos:

- D1 ou PostgreSQL;
- Better Auth, Cloudflare Access ou nenhuma auth;
- tenancy habilitada ou não;
- e-mail e telemetria necessários;
- imagens, storage e billing somente quando houver consumidor real.

PostgreSQL é preferível para SaaS, multi-tenancy, crescimento e consultas
avançadas. D1 permanece uma opção de primeira classe para aplicações simples.
