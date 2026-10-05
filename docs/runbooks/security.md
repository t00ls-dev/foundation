# Segurança operacional

Os pacotes fornecem primitivas; cada aplicação continua responsável por escolher
e configurar os controles adequados às suas rotas.

## Baseline obrigatória

- use `foundationSecurityHeaders()` ou baseline equivalente;
- mantenha auth e respostas privadas com `private, no-store`;
- mantenha `/health` com `no-store`;
- configure o bypass Cloudflare descrito em [Cache](cache.md);
- valide toda entrada externa;
- nunca registre senha, token, cookie, secret ou dados pessoais desnecessários;
- use `createAuditEvent` antes de persistir metadados de auditoria.

### SPA e Workers Assets

No Links, `assets.run_worker_first: true` garante que HTML, fallback SPA e
assets passem pelo middleware `foundationSecurityHeaders()` antes da resposta
final. Servir assets primeiro contorna esse middleware. O fallback cria uma
Response com headers mutáveis a partir de `ASSETS.fetch`, preservando
body/status/headers dos assets para que Hono possa aplicar a política central.

A CSP usa `frame-ancestors 'none'` e `X-Frame-Options: DENY` para impedir que o
app seja embutido. Isso não impede o iframe do Turnstile: o opt-in continua
permitindo `https://challenges.cloudflare.com` em `script-src` e `frame-src`. O
teste E2E de headers usa o build real em Wrangler local, além do harness Vite
dos fluxos de usuário. Após um deploy autorizado, confira os headers finais de
`/`, `/bookmarks`, um asset JavaScript e `/health` no domínio público; o teste
local não valida regras de cache/transformação externas da Cloudflare.

## Controles por risco

- CORS só deve ser habilitado para origens explicitamente aprovadas;
- CSRF deve proteger mutações autenticadas por cookie fora dos handlers que já
  oferecem proteção equivalente;
- rate limiting deve considerar rota, IP, usuário ou tenant conforme o risco;
- Turnstile é indicado para cadastro, recuperação, formulários públicos e abuso;
- webhooks devem validar assinatura antes de processar payloads.

Não habilite CORS amplo, não use IP como identidade única e não use KV como
fonte da verdade para sessão, autorização, saldo ou pagamento.

## Incidentes

Em caso de exposição ou suspeita, revogue o secret, preserve evidências sem
copiar o valor comprometido, avalie os dados afetados e documente a rotação.
Secrets de DEV e PROD devem ser rotacionados separadamente.
