# ADR-002: Tenancy, autorização e convites

Composição atual do Levi: igreja é a fronteira operacional; `church_sessions`
mantém a igreja ativa e cada operação revalida o vínculo por igreja. Papéis
admin/collaborator e convites são domínio do app. A seleção não concede
autoridade; isolamento e revalidação transacional continuam obrigatórios. O
contrato genérico abaixo não exige que o Levi use `activeTenantId`.

- Status: aceito
- Escopo: v0.1

## Contexto

Nem todo produto precisa de multi-tenancy, mas implementações divergentes
aumentariam o risco de vazamento de dados e políticas inconsistentes.

## Decisão

Tenancy é opcional por aplicação. No contrato genérico do pacote tenant, a
sessão mantém `activeTenantId`; selecionar ou trocar esse valor exige membership
válido. A role pertence ao membership, e cada produto configura seu mapa de role
para permissões. Código de autorização verifica permissões em vez de comparar
roles diretamente.

Convites de tenant usam token aleatório de alta entropia, validade limitada e
consumo atômico de uma única vez. Somente o hash do token é persistido; o token
em claro existe apenas no link enviado. Aceite valida hash, expiração, estado,
tenant e destinatário aplicável, sem revelar informações desnecessárias.

## Consequências

- Apps single-tenant não carregam tabelas ou fluxo de tenancy sem necessidade.
- Apps multi-tenant compartilham o mesmo modelo mental e invariantes de
  isolamento.
- `activeTenantId` é contexto selecionado, não prova de autorização; membership
  deve ser validado.
- Alterar roles ou permissões é configuração do produto, não breaking change
  obrigatório da fundação.
- Tokens de convite vazados do banco não podem ser usados diretamente.
