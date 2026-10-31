# ADR-007: Escopo da v0.1

Atualização de contexto em 31/10/2026: o exemplo D1 foi removido; o preset do
gerador permanece. Levi é o consumidor atual, com deploy manual por aplicação
conforme ADR-006 e pacotes privados conforme ADR-005. A decisão original abaixo
preserva o escopo e os não objetivos, sem reativar o deploy do exemplo.

- Status: aceito
- Escopo: v0.1

## Contexto

O desenho futuro é amplo, mas implementar antecipadamente todas as capabilities
criaria abstrações sem consumidores e atrasaria uma fundação utilizável.

## Decisão

A v0.1 valida o caminho completo de um app: monorepo e qualidade, configuração,
SPA/API no Worker, D1 e PostgreSQL, Better Auth, tenancy/access opcionais,
segurança e observabilidade básicas, e-mail necessário aos fluxos, exemplo D1,
testes, documentação e deploy DEV do exemplo; ambientes DEV/PROD de aplicações
consumidoras são responsabilidade delas. `create-app` e `doctor` começam apenas
no nível necessário para validar configuração e consumo dos pacotes.

Ficam fora: SSR, microservices, Kubernetes, GraphQL, OpenAPI obrigatório,
staging, SMS, Web Push, design system completo, auth ou feature flags próprios,
billing próprio, event bus complexo, marketplace avançado e providers sem uso
real. Billing, webhooks, images, storage, backups automatizados e workflows
sofisticados aguardam consumidor concreto.

## Consequências

- A arquitetura reserva limites de evolução sem prometer implementação imediata.
- Toda nova capability precisa de necessidade real e ADR quando alterar decisões
  importantes.
- Nenhuma regra de negócio de produto entra na fundação.
- A v0.1 permanece pequena, coerente e implantável.
