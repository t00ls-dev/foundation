# ADR-001: SPA e API no mesmo Worker

- Status: aceito
- Escopo: v0.1

## Contexto

A fundação precisa de uma topologia simples, Cloudflare-first e replicável por
produtos independentes.

## Decisão

Cada app web usa uma SPA React e uma API Hono. O preset usa React Router; o Levi
implementa navegação própria com history e estado React. Ambos são publicados no
mesmo Cloudflare Worker: `/api/*` é reservado à API e Workers Assets serve os
arquivos estáticos e o fallback da SPA nas demais rotas. Não haverá SSR na v0.1.

## Consequências

- Frontend e API compartilham origin e deploy, reduzindo CORS e operação.
- O roteamento deve garantir que `/api/*` nunca caia no fallback HTML.
- A topologia não elimina os limites de módulos entre UI, contratos e API.
- SEO que exija renderização no servidor não é atendido por esta versão.
