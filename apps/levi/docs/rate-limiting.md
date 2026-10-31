# Rate limiting contextual

Esta é a política do código, não uma confirmação da versão publicada no DEV.
O Worker habilita `publicAbuseProtection`; a entrada Node local não confia em
headers Cloudflare nem habilita a proteção por padrão. Turnstile não está integrado.

## Identidade e categorias

As guardas de origem e tamanho do corpo continuam antes da conexão e dos limites.
Depois da conexão, a guarda ampla por IP e os limites existentes de pedidos de
e-mail/login executam antes da resolução de sessão. As demais categorias executam
depois de `resolveSession` do Foundation. Logout também resolve a sessão para
classificação. Nas demais rotas, os cookies de renovação são propagados; no POST
de logout, somente os cookies da resposta nativa são propagados, para a renovação
preliminar não substituir a limpeza após revogação nem renovar cookies em falha.

| Categoria                           | Limite       | Identificador e abrangência                                                                     |
| ----------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| Guarda ampla                        | 1.200/minuto | IP; todas as rotas `/api/*`, antes da resolução                                                 |
| Leitura autenticada                 | 300/minuto   | Usuário; GET/HEAD onboarding, igrejas, contexto, membros, recibos, acessos e convites           |
| Escrita autenticada                 | 60/minuto    | Usuário; POST membros, PATCH membro/igreja, PATCH/DELETE acessos, mutações de convites e aceite |
| Seleção de igreja                   | 30/minuto    | Usuário; POST /api/context/church                                                               |
| Provisionamento                     | 5/15 minutos | Usuário; POST /api/churches                                                                     |
| Definição de senha                  | 5/15 minutos | Usuário; POST onboarding/password                                                               |
| Logout autenticado                  | 30/minuto    | Usuário; POST auth/sign-out                                                                     |
| Anônimo ou rota não classificada    | 60/minuto    | IP; inclui sessão inválida e logout sem sessão                                                  |
| Callbacks de autenticação           | 60/minuto    | IP; GET/HEAD magic-link/verify e reset-password/:token, bucket conjunto próprio                 |
| Pedidos de e-mail                   | 5/minuto     | IP; POST onboarding/email e onboarding/password-email, bucket original conjunto                 |
| Login por senha                     | 10/minuto    | IP; caminho auth/sign-in/email, bucket original                                                 |
| Tentativas de envio ao destinatário | 3/15 minutos | Destinatário normalizado; compartilhado entre os dois e-mails                                   |
| Tentativas de envio globais         | 90/dia UTC   | Toda a aplicação; mantém orçamento e supressão genérica                                         |

Todos são limites de janela fixa alinhada ao relógio Unix. Há rajada na fronteira;
não são tetos para qualquer intervalo móvel. Quotas por usuário atravessam
sessões, dispositivos, IPs e igrejas: trocar igreja não renova o orçamento.
Contas distintas no mesmo IP têm quotas funcionais independentes, sujeitas à
guarda ampla. Não há quota comercial de igrejas ou membros.
Repetições de uma requisição idempotente também consomem tentativas HTTP; o limite
não substitui nem altera a garantia de não duplicar o resultado.

O usuário vem exclusivamente da sessão resolvida no servidor. Headers, body,
e-mail declarado, cookie bruto e IDs de tenant não concedem essa categoria.
Autenticação não substitui autorização: verificações de e-mail, vínculo
administrativo atual, tenant do recurso, transações, auditoria e idempotência
continuam nas rotas. Rotas novas não ganham limite autenticado automaticamente.
HEAD compartilha a categoria e a janela de GET porque o Hono executa o mesmo
handler; a classificação não altera o método real nem o corpo vazio da resposta.

O IP vem somente de `CF-Connecting-IP` na entrada confiável Worker. Ausência usa
bucket compartilhado; X-Forwarded-For não altera a chave Levi. IPv6 usa o endereço
integral, sem agregação /64. HMAC-SHA-256 com segredo do servidor evita IP/e-mail/ID
em claro nos contadores; isso não é anonimização. Os prefixos novos usam `v2`;
prefixos e quotas de credenciais/envio existentes foram preservados.

## Persistência e custo

Reutiliza `fixedWindowRateLimit` de `@t00ls-dev/security` e a tabela
`abuse_counters`, sem dependência, schema ou migration novos. Cada incremento
executa um único statement. A guarda usa CTE de limpeza e UPSERT atômico; a
categoria seguinte usa somente o UPSERT, evitando limpar duas vezes. A limpeza usa o
índice de expiração, seleciona até 100 linhas com `FOR UPDATE SKIP LOCKED` e exclui
a própria chave do incremento. Não espera expirados já bloqueados por outra
transação. Falha do store continua fechada, com erro sanitizado; não há fallback
para memória. Limpeza física é oportunista e depende de tráfego posterior.

Antes: um limite HTTP × dois statements (DELETE e UPSERT). Agora: guarda + uma
categoria × um statement, mantendo **dois statements de contadores por chamada
aceita**, antes de sessão/negócio. Uma negação na guarda custa um. Limpeza e
incremento são atômicos por statement; guarda e categoria são contagens
independentes e não precisam de transação conjunta.

Com duas quotas de envio, um pedido que efetivamente chega ao provedor usa quatro
statements de contadores, frente aos seis anteriores. Supressões continuam
genéricas; falhas do provedor consomem orçamento e não provocam retry automático.
A aplicação não confirma entrega por causa de um 200.

O número de statements de transporte não aumenta na navegação, mas há dois
incrementos duráveis e mais chaves do que antes, com uma limpeza por chamada.
O store público e quotas de envio preservam limpeza quando usados isoladamente. A guarda cria
contenção intencional por IP e não evita abrir a conexão. Testes sintéticos não
medem faturamento Hyperdrive, distribuição na borda ou capacidade do DEV. Conferir
o volume/latência e a franquia efetiva antes de integração; não compensar custo
com perda de atomicidade ou confiança em identidade do cliente.

## HTTP 429 e interface

O Levi responde 429 com `LIMITE_DE_SOLICITACOES`, mensagem sanitizada e
`Retry-After` em segundos até o fim da janela que negou, mínimo 1. Preserva os
headers `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (instante Unix
em segundos), cookies e headers privados/de segurança. A regra funcional fornece
os headers em chamadas que passaram pela guarda; negação da guarda informa seu
próprio teto.

O Better Auth permanece inalterado, com seus limites internos conforme o ambiente
e versão. Estes podem ser mais restritivos e usam contadores distintos do Levi.
O wrapper Levi preserva `X-Retry-After` nativo e também o expõe como `Retry-After`
quando válido e ausente. Não se aumentou limite de credenciais ou envio.

O cliente distingue 429 de rede, 503 e 401/403. Interpreta Retry-After (segundos
ou data HTTP) e X-Retry-After; usa 60 segundos se nenhum for válido, mínimo 1 e
máximo 24 horas para a espera de UX. Exibe orientação em português e impede novas
chamadas da categoria bloqueada durante a espera, inclusive revalidações por
foco. A espera fica somente em memória e não concede autoridade no servidor.
Não há timer de retry nem repetição automática após expirar. Seleção, leitura,
escrita, logout, senha, provisionamento, login e e-mail têm esperas independentes.
Login, definição de senha ou logout confirmados encerram as esperas da identidade
anterior; o servidor continua impondo suas quotas.

Operações de resultado incerto conservam o tratamento existente de reconciliação
e idempotência. Não se repete automaticamente escrita, autenticação ou envio.
O usuário pode executar outras categorias, ainda sujeito às respectivas guardas
e às leituras prévias necessárias para validar seu contexto na interface.
Desafios ou validação Turnstile ficam para uma entrega futura separada.

## Validação

Os testes de categorias/janelas e cliente entram em `pnpm test`. A integração
existente acrescenta sessões reais, revogação/expiração, NAT, troca de tenant,
isolamento, concorrência entre conexões e limpeza com locks. Runtime e E2E usam
os harnesses descartáveis existentes; nenhum cenário de carga deve acessar o DEV.
O ensaio de vinte contas sintéticas a trinta leituras no mesmo IP verifica a
margem funcional; não é benchmark da Cloudflare nem comprova Safari físico.

Para validar persistência, usar os harnesses oficiais de integração, workerd e
E2E, incluindo o modo `--runtime-acls`. Eles criam seu próprio PostgreSQL
descartável, aplicam e reaplicam o histórico completo e removem o container ao
terminar. Não substituir esse preparo por export do schema: os testes de journal,
auditoria imutável e proteção de UPDATE dependem das migrations e seus triggers.
Essa preparação sintética não autoriza migrations em bancos persistentes.

A conferência do store inclui 80 incrementos concorrentes em quatro conexões,
contagens sem perda e limpeza que ignora um expirado bloqueado e o remove após
liberar o lock. O UPSERT da chave atual permanece atômico; somente a limpeza usa
`SKIP LOCKED`. A categoria seguinte conserva o incremento atômico sem repetir a
limpeza já executada pela guarda. Não há fallback por falha do banco nem dispensa
das verificações de sessão e tenant.
