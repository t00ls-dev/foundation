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
operacional do GitHub pertence ao **Environment `dev`**, associado ao job
`deploy`, ao job `migration` do reusable workflow e ao job `recover`. `validate`
consulta apenas evidência GitHub; ele e a CI não usam esse Environment.

Na verificação de 11/10/2026, o workflow `Deploy DEV` está habilitado. A
primeira execução automática após a reativação ainda está pendente de
observação.

### Provisionamento no GitHub

Antes do merge/ativação, um administrador precisa criar/configurar o Environment
`dev` e cadastrar nele estes **Environment Secrets**:

| Secret                          | Uso                                          |
| ------------------------------- | -------------------------------------------- |
| `CLOUDFLARE_D1_MIGRATION_TOKEN` | D1 Edit: expand/backfill/contract e recovery |
| `CLOUDFLARE_D1_READ_TOKEN`      | D1 Read: pré-condição do deploy              |
| `CLOUDFLARE_WORKER_READ_TOKEN`  | Workers Scripts Read: prova pós-deploy       |
| `CLOUDFLARE_API_TOKEN`          | Publicação do Worker DEV                     |
| `CLOUDFLARE_ACCOUNT_ID`         | Conta do alvo DEV, usada pelos mesmos jobs   |
| `DEV_HEALTH_URL`                | Endpoint de health do DEV                    |

Os três nomes já usados por deploy também pertencem a `dev`, pois identificam ou
autorizam esse alvo. Account ID e health URL não são credenciais sigilosas;
poderiam ser Environment Variables (`vars`) em mudança coordenada futura. Neste
contrato permanecem secrets para evitar ampliar a alteração de configuração e de
interfaces. Configuração geral do repositório não deve conter tokens DEV.

O YAML **não configura Environment Secrets nem regras administrativas**. O
GitHub pode criar um Environment vazio quando um job o referencia: isso não
comprova provisionamento/proteção. O ciclo DEV continua automático; não exige
required reviewers ou wait timer. Na verificação de 11/10/2026, o Environment
`dev` possui policy de deployment limitada à `master`, sem branches de PR/fork.
Essa regra administrativa é distinta da proteção de branch; configurações
efetivas devem ser verificadas no GitHub.

Secrets de Environment têm precedência sobre nomes iguais no repositório, mas
`secrets` não comprova sua origem. Depois de provisionar/verificar `dev`, remova
administrativamente duplicatas DEV de Repository Secrets para não manter acesso
implícito fora dessa fronteira. Esta migração administrativa não é feita pelo
código nem nesta sessão. Ausência de token segregado não usa token de deploy
como fallback.

### Reusable workflow

`migrate-dev.yml` associa **seu próprio job** a `environment: dev`; Environment
do caller não é herdado, e o job com `uses` não aceita `environment`. O caller
mantém repasse explícito pelos **mesmos nomes** declarados em
`workflow_call.secrets`, inclusive quando o valor só existe em `dev`. O
Environment do job chamado resolve o valor correspondente. Não há
`secrets: inherit` ou aliases duplicados; expand passa somente account ID/D1
Edit, e backfill/contract acrescentam Workers Read/health. `required: true`
exige repasse no contrato, não garante valor provisionado.

Um valor vazio no contexto do caller não exige duplicar o secret no repositório:
o repasse pelo mesmo nome permite resolver o valor no Environment do job
chamado. Remover `secrets`/as declarações ou repassar por alias quebraria esse
contrato. Os seis nomes são consumidos pelos jobs que precisam deles, não todos
pela migration: D1 Read e o token de deploy pertencem ao job `deploy`.

O executor valida account ID/token D1 não vazios após autorizar o SHA e antes de
consultar o banco. A pré-condição usa D1 Read; fases/recovery usam D1 Edit.
Depois de ler o journal, e antes de inicializar/mutar o banco, exige Workers
Read e health somente quando há backfill/contract pendente; sem pendência, o
no-op continua válido. Falha de resolução produz `missingSecrets` no resultado
sanitizado, com **nomes somente**, sem valores. Isso detecta ausência, não
atesta origem/escopo real de um token nem substitui o cadastro administrativo.

Referência:
[Environments em reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows#using-inputs-and-secrets-in-a-reusable-workflow).

### Configuração do Worker

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

Restrinja recursos/conta e quem pode acessar credenciais conforme suporte
Cloudflare; D1 pode exigir escopo de conta, não presumir restrição por banco que
o provider não ofereça. Token de deploy publica Worker e consulta bindings, não
aplica SQL. Não há fallback entre credenciais.

CI de PR/fork não recebe esses secrets. Migration/recuperação recebe D1 Edit
somente no step autorizado; deploy usa D1 Read na pré-condição. Pós-deploy usa
Workers Read para provar deployment/versão. O inventário do GitHub confirmado em
11/10/2026 contém somente o Environment `dev`; não há Environment `production`
no Foundation. Environment só protege jobs que o referenciam com regras
efetivas. Origem/SHA/serialização são verificados pelo código; revisão e
controle de escrita continuam necessários.

## Aplicações consumidoras

Cada aplicação consumidora define seus próprios ambientes e procedimentos de
deploy. Não existe Worker, banco ou workflow PROD no Foundation.
