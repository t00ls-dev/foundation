# ADR-003: Better Auth

- Status: aceito
- Escopo: v0.1

## Contexto

A fundação precisa de autenticação madura e self-hosted sem criar framework
próprio ou entregar os dados de identidade a uma infraestrutura obrigatória de
terceiros.

## Decisão

Better Auth OSS/self-hosted é o padrão. A aplicação controla usuários, contas,
sessões e memberships. A integração suporta D1 e PostgreSQL nos recursos
compatíveis por um wrapper opinativo: handler HTTP, resolução tipada de sessão e
operação server-only `setInitialPassword`. A API interna completa não é exposta.

Os fluxos básicos da v0.1 são cadastro, login, logout, sessão, verificação de
e-mail e recuperação/redefinição de senha. E-mails passam pela camada de e-mail
da fundação. Proteções como validação, cookies seguros, CSRF, rate limiting e
Turnstile são aplicadas conforme o risco do fluxo. Cloudflare Access pode
substituir auth da aplicação em ferramentas internas simples.

## Consequências

- Plugins dependem dos opt-ins públicos do wrapper; upgrades exigem validação
  dos contratos consumidos.
- Autenticação fica separada de tenancy e autorização.
- Magic Link está integrado; Google OAuth, TOTP e Turnstile são opt-ins
  existentes, sem adoção obrigatória por aplicação.
- Não há dependência do Better Auth Infrastructure pago.
