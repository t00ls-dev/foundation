# Ambientes

O Foundation usa apenas os ambientes `local` e `dev` para a aplicação de
referência. Aplicações consumidoras são responsáveis pelos próprios ambientes
DEV e PROD, com recursos e secrets separados.

## Local

O fluxo local deve funcionar depois de `pnpm install` e da criação de
`.dev.vars` a partir de `.dev.vars.example`.

```bash
pnpm --filter @t00ls-dev/example-links db:migrate:local
pnpm dev
```

Use apenas credenciais de desenvolvimento. Arquivos `.dev.vars`, `.env` e
equivalentes com valores reais nunca devem ser versionados.

## DEV

DEV recebe deploy automático depois de uma CI verde em `master`. Ele possui
Worker, D1 e secrets próprios e usa `foundation.t00ls.dev` como Custom Domain. O
endereço `*.workers.dev` e as Preview URLs estão desabilitados. A configuração
mínima é:

- GitHub: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` e `DEV_HEALTH_URL`;
- Worker: `AUTH_SECRET`, `BASE_URL`, `EMAIL_FROM` e `RESEND_API_KEY`;
- opcionais: `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.

`DEV_HEALTH_URL` deve apontar para `https://foundation.t00ls.dev` (sem
`/health`); o workflow acrescenta o caminho e valida também a conectividade D1.
`BASE_URL` do Worker deve ser `https://foundation.t00ls.dev`. `AUTH_SECRET` deve
ter pelo menos 32 caracteres e não deve ser reutilizado em aplicações
consumidoras.

Para publicar o Custom Domain, a zona `t00ls.dev` deve estar ativa na conta
Cloudflare e o hostname não pode ter um CNAME conflitante. Configure uma Cache
Rule para bypass de `/health` e das rotas dinâmicas conforme [Cache](cache.md).

## Aplicações consumidoras

Cada aplicação consumidora define seus próprios ambientes e procedimentos de
deploy. Não existe Worker, banco ou workflow PROD no Foundation.
