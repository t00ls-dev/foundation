# Administração global

As políticas atuais usam `churchIds`. Administração global não concede acesso local às igrejas; tabelas e recibos de concessões anteriores são evidência histórica, não fonte de autoridade vigente.

O painel interno `/admin` utiliza o login comum Better Auth. Sua única fonte de
autoridade é o secret **LEVI_ADMIN_EMAIL** do Environment `levi-dev` do Foundation,
sincronizado ao binding homônimo pelo publicador oficial. Não há gestão de
administradores pela interface nem concessão por role organizacional.

## Autorização e identidade

O backend exige simultaneamente sessão autenticada e válida, e-mail verificado,
correspondência exata do e-mail autenticado
com a configuração privada. Revalida usuário e sessão atuais no banco; a presença
do secret não substitui a autenticação. O banco continua armazenando contas e
sessões, mas não define quem é administrador global.

A comparação remove espaços das extremidades e normaliza caixa, conforme o
contrato de identidade existente. Não expande aliases, pontos ou `+tag`. Configuração
é um único endereço; listas, curingas, nome de exibição, ausência, vazio ou formato
inválido negam acesso. Identidades históricas ambíguas após normalização também
são recusadas. Nenhum e-mail ou ID informado no corpo, header ou navegador autentica.

Alterar a conta verificada que controla esse endereço pode alterar a autoridade:
esta política acompanha o e-mail, e não um UUID fixo. Proteger a caixa de e-mail e
o Environment é parte do controle operacional. O valor configurado nunca é
enviado ao frontend ou incluído em respostas, diagnósticos, artifacts ou logs.

`requireGlobalAdministrator` protege HTML e APIs. `withGlobalAdministrator` repete
a mesma regra nas operações internas. Mutations revalidam a identidade após esperar
o mutex administrativo e novamente antes de confirmar o commit. Locks de usuário
e sessão, transações, auditoria atômica e controle de versão das flags permanecem.

## Painel e contrato HTTP

Acessar `/admin` diretamente após o login comum. Não existe login separado nem
link na navegação dos usuários comuns. O painel é resolvido antes do onboarding e
da seleção de igreja, permitindo acesso sem igreja ativa. Entradas e saídas
usam navegação completa. Nenhuma permissão sobre dados privados das igrejas
é concedida por ser administrador global.

O guard executa antes de servir HTML, validar corpo, CSRF ou consumir quota.
Visitantes, usuários comuns, identidade não verificada, sessões inválidas/revogadas
e autoridade indisponível recebem HTTP 404 com `NAO_ENCONTRADO`. Métodos,
subcaminhos e variantes de caixa/encoding/barras não contornam essa guarda. Node,
Worker e proxy Vite preservam o status real; `/admin` não pertence à lista pública
`spaPaths`. No Vite, compilar a interface antes de usar o painel servido pelo Node.

Respostas administrativas mantêm headers de segurança e `private, no-store`.
A API mantém a quota de 60 requisições por minuto/usuário, somente após autorização.
Escritas exigem origem confiável, JSON e limites de corpo existentes. O ID da
operação de auditoria continua sendo gerado no servidor.

| Método e caminho             | Contrato                                                            |
| ---------------------------- | ------------------------------------------------------------------- |
| GET /api/admin/session       | UUID da conta e da sessão, sem token ou e-mail configurado          |
| GET /api/admin/churches      | UUID e nome de igrejas, com paginação; sem dados privados           |
| GET /api/admin/features      | Catálogo declarado no código e políticas persistidas                |
| PUT /api/admin/features/:key | Política, seleção, versão esperada e confirmação explícita para all |

Listagem/busca de administradores e concessão/revogação foram retiradas da API e
da interface. Seus caminhos antigos retornam 404 e não escrevem concessões.
O painel mantém revalidação ao retornar/focar, limpeza após logout ou perda de
autoridade e descarte de respostas assíncronas antigas.

## Configuração e publicação

Cadastrar LEVI_ADMIN_EMAIL exclusivamente no GitHub Environment `levi-dev`, sem
valor no chat, source, argumentos de comandos ou variables públicas. O workflow
manual o recebe somente no step publish, junto dos demais secrets autorizados.
O arquivo privado em tmpfs contém o endereço normalizado ou string vazia para
negar acesso quando ausente/inválido. Isso sobrescreve explicitamente uma
configuração remota anterior, sem herança permissiva. Nunca usar AUTH_SECRET,
ADMIN_EMAIL operacional antigo ou concessões históricas como fallback.

A alteração do cadastro exige publicação posterior da master aprovada. Não tem
efeito imediato no Worker já publicado nem cancela uma requisição em andamento.
O publicador confere presença/tipo do novo binding após upload, sem consultar seu
valor. As demais verificações de SHA, CI, versão ativa/última, tráfego, domínio,
Assets, Hyperdrive, TLS, remetente e readiness permanecem inalteradas.
Ver [Deploy DEV](deploy-dev.md). Integração, cadastro e deploy exigem suas
respectivas autorizações; esta implementação não executa essas operações.

## Persistência histórica e Feature Flags

Tabelas `global_administrators` e `admin_bootstrap`, migrations 0005/0006, ACLs,
recibo permanente e seus dados foram preservados. Concessões antigas e resultados
do runner histórico de bootstrap não concedem acesso ao runtime. O bootstrap não
é necessário, não é acionado pela aplicação/deploy e não deve ser usado para
ativar esta política. Não remover recibos, alterar migrations ou limpar tabelas.

As tabelas de flags e auditoria permanecem em uso. `members` continua sendo a
única chave declarada; políticas all/selected/disabled, seleção validada, versões,
rollback conjunto com auditoria e integridade append-only são preservados.
O avaliador persistido não está ligado ao módulo de membros: sua disponibilidade
continua aberta às organizações autenticadas e autorizadas, com isolamento.
Não há nova migration, bootstrap ou operação persistente nesta mudança.

## Validação

Testes usam PostgreSQL e Worker descartáveis, contas/e-mails sintéticos e captura
em memória. Cobrem configuração normalizada, ausência/invalidade, concessão
histórica sem efeito, identidade/sessão atuais, falhas de banco, concorrência,
auditoria, CSRF, quotas, isolamento e HTML protegido. E2E cobre acesso sem tenant,
refresh/histórico/logout, desktop/mobile/Vite e descarte de respostas antigas.
Os contratos de deploy verificam transporte privado, ausência de vazamento e
substituição explícita da configuração. Ver [Testes](../../../docs/runbooks/testing.md).
