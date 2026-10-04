# Integração TOTP — etapa 2

O Links instala TOTP pelo wrapper Foundation e compõe schema/migration D1, mas
mantém `/two-factor/enable` bloqueado. A UI e o tratamento de challenge no
cliente não foram implementados; habilitar enrollment pertence à próxima etapa.
Não há opção pública de environment para liberar enrollment nesta entrega.

Política: TOTP protege login com senha. Magic Link e Google continuam
alternativas sem desafio local, inclusive em lockout. Senha é necessária para
gerenciar TOTP; disable não exige TOTP extra/freshness além da política nativa
caracterizada. Não são oferecidos backup codes, OTP ou trusted devices, nem APIs
server-side.

## Rate limit em Workers/D1

Escolha: storage `database` do limiter público Better Auth sobre D1. Estado em
memória de um isolate não é limite distribuído; D1 preserva buckets entre novas
instâncias e usa incrementos condicionais do adapter, já caracterizados. O IP
vem exclusivamente de `cf-connecting-ip`, fornecido pelo Cloudflare;
`x-forwarded-for` não troca o bucket. Ausência de IP confiável usa o bucket
compartilhado fail-closed do Better Auth. Preserve essa garantia de origem do
header ao mudar proxy/infraestrutura. Indisponibilidade de D1 bloqueia a
operação.

Os defaults atuais de ativação (produção), rules de senha/reset e limite do
plugin (três requests/path/IP em dez segundos) permanecem do Better Auth.
Integração testa `enabled: true` explicitamente; demais testes funcionais
separam o limiter. Budget de challenge (cinco falhas) e lockout de conta (dez
falhas/quinze minutos) são proteções distintas, persistidas pelo plugin, não
substitutos do limiter. Custo: leituras/escritas D1 e dependência de sua
disponibilidade, sem storage externo ou implementação SQL própria do limiter.

## Persistência e respostas

`0003_links_totp.sql` é forward-only: adiciona flag com default false para
usuários existentes, modelo twoFactor e rateLimit com índices. lockedUntil usa
Date/epoch segundos via Drizzle D1; lastRequest do limiter mantém epoch
milissegundos numérico. Migrations anteriores não foram editadas. A migration
foi gerada com Drizzle Kit; o novo arquivo/tag ainda não aplicado recebeu número
0003 para continuar a sequência existente. Snapshot gerado é 0002,
correspondente ao idx 2 do journal.

Wrapper não promete atomicidade: erros inesperados são estado indeterminado, sem
retry automático ou prova de rollback. Confirmação pode retornar snapshot
anterior, enquanto cookies e sessão pública refletem a rotação; falha pode
deixar flag habilitado com setup pendente. Recovery explícito por alternativa
aprovada e confirmação autenticada não promete revogação global de sessões
órfãs.

Os novos testes usam o wrapper real, migrations reais e APIs públicas; D1 é
descartável. SQL aparece apenas no teste de constraints/defaults/índices da
migration, não para implementar TOTP ou criar/observar seu estado funcional.
Characterization permanece independente com seu schema isolado e migrations
base.

Antes de ativar UI/enrollment: tratar `twoFactorRedirect` sem anunciar login,
preservar cookies, reconciliar estado/identidade após rotações, comunicar
alcance password-only e alternativas, e cobrir fluxos desktop/mobile no cliente.
