# Licenças e distribuição

A licença MIT foi aprovada pelo mantenedor para o código próprio do Foundation.
O texto está em [`LICENSE`](../../LICENSE); os nove pacotes reutilizáveis e a
raiz declaram `MIT`. Os tarballs da distribuição encerrada são históricos; não
há publicação npm vigente.

O código próprio do Levi incorporado em `apps/levi` adota MIT por aprovação do
mantenedor. A cópia inclui [LICENSE](../../apps/levi/LICENSE) e
[avisos de terceiros](../../apps/levi/THIRD_PARTY_NOTICES.md), preservando os
avisos de copyright e atribuição aplicáveis. O histórico incorporado e as
licenças dos demais componentes permanecem preservados.

## Copyright

O mantenedor confirmou o aviso `Copyright (c) 2026 t00ls-dev` para o código
próprio do Foundation. Esse aviso consta no `LICENSE` raiz e nas nove cópias dos
pacotes distribuídos, idênticas entre si. O texto oficial de permissão, condição
e garantia MIT é preservado integralmente. A identificação decorre da decisão
explícita do mantenedor, não de inferência sobre a conta GitHub ou autoria Git.

## Terceiros

Dependências e trechos de terceiros mantêm suas licenças e notices próprios. O
aviso
[`packages/ui/THIRD_PARTY_NOTICES.md`](../../packages/ui/THIRD_PARTY_NOTICES.md)
identifica conteúdo shadcn sob MIT; não identifica o titular do Foundation.
Distribuir dependências ou binários exige respeitar seus avisos e obrigações,
incluindo componentes MPL e LGPL presentes nas ferramentas. A licença raiz não
relicencia esses componentes.

## Skills de terceiros

O [catálogo local](../../.agents/README.md) e o
[manifesto](../../.agents/skills-sources.json) registram origens, revisões e
licenças das 15 importações e da skill preexistente. As cópias de licenças estão
em [licenses](../../.agents/licenses/); a skill React declara MIT no frontmatter
upstream. A licença raiz não relicencia cópias de terceiros. A skill
preexistente `web-design-guidelines` também consta no manifesto: a declaração
MIT do README raiz da revisão correspondente cobre a cópia local. Veja as fontes
imutáveis e a atribuição no catálogo. O conteúdo externo buscado pela skill em
tempo de uso não é incorporado nem relicenciado por este registro.

## Pacotes internos

Todos os workspaces são privados para publicação; o código próprio permanece sob
a licença raiz. A distribuição npm foi encerrada. Versões antigas não são
alteradas retroativamente. Veja [Pacotes internos](packages.md).
