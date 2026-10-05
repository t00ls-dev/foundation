# `@t00ls-dev/security`

Defaults de headers HTTP seguros para Hono e respostas privadas.

## Quando usar

Use como baseline em aplicações Hono e em respostas autenticadas ou
personalizadas. Não use como solução completa de autenticação ou autorização.

## Instalação

Pacote privado do workspace; não é publicado em registry.

```sh
pnpm --filter <app> add '@t00ls-dev/security@workspace:*'
```

## API

- `foundationSecurityHeaders(options?)`: middleware Hono com CSP, CORP,
  Referrer-Policy e `X-Frame-Options`. `options.turnstile: true` permite apenas
  script/frame no domínio oficial `https://challenges.cloudflare.com`. Opt-in
  ausente mantém a CSP self-only; não relaxa connect-src, framing da aplicação
  ou CSRF.
- `privateResponseHeaders(headers)`: muta e retorna `Headers` com
  `Cache-Control: private, no-store` e `Vary: Cookie, Authorization`.
- `foundationCors(options)`: middleware CORS configurável compatível com Hono.
- `csrfProtection(options)`: valida a origem de requisições inseguras que usam
  cookies.
- `fixedWindowRateLimit(options)`: rate limiter de janela fixa com store atômico
  injetado.
- `verifyTurnstile(options)`: verifica tokens do Cloudflare Turnstile.

## Exemplo

```ts
import {
  foundationSecurityHeaders,
  privateResponseHeaders,
} from "@t00ls-dev/security";
import { Hono } from "hono";

const app = new Hono();
app.use("*", foundationSecurityHeaders());
app.get(
  "/me",
  (c) =>
    new Response("private", { headers: privateResponseHeaders(new Headers()) }),
);
```

## Limitações e segurança

A CSP permite estilos inline e restringe scripts, imagens e conexões à própria
origem; ajuste-a conscientemente para recursos externos.
`privateResponseHeaders` sobrescreve `Vary` existente, portanto aplique-o antes
de acrescentar outras variações. Teste os headers no ambiente final, inclusive
atrás de CDN ou proxy.
