# Deploy

O deploy do Levi é manual pelo workflow `deploy-levi-dev.yml`, sujeito aos gates
de CI do SHA exato, Environment e autorizações existentes. Consulte o
[guia do Levi](../../apps/levi/README.md) para seus recursos e procedimentos.

Os workflows de publicação, migrations e recuperação D1 do exemplo foram
removidos. Nenhuma exclusão de infraestrutura remota foi executada. Recursos
persistentes antigos exigem inventário e autorização operacional separados.

Criar um PR não autoriza merge, deploy, publicação ou migrations persistentes.

Deploy e diagnóstico não solicitam inputs adicionais: selecionar `master`
captura o SHA no dispatch. O diagnóstico usa exclusivamente User API Tokens;
consulte as
[instruções de criação e cadastro](../../apps/levi/docs/deploy-dev.md#diagnóstico-cloudflare-somente-leitura).
Os seis smokes do deploy continuam obrigatórios e não enviam capacidade de
manutenção. O workflow Smoke Hyperdrive legado foi removido por não possuir
endpoint implementado neste repositório; isso não comprova pooling/cache remoto
nem substitui uma futura validação real do serviço.
