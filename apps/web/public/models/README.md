# Corpo 3D do Modo Apresentação

`body.bin` é gerado por [`scripts/build-body-mesh.mjs`](../../../../scripts/build-body-mesh.mjs)
e **não deve ser editado à mão**.

## Origem e licença

Derivado dos assets do [MakeHuman](https://github.com/makehumancommunity/makehuman) —
base mesh (`data/3dobjs/base.obj`) e targets (`data/targets/**`), **explicitamente
liberados como CC0 em setembro de 2020** (a declaração está no cabeçalho de cada
arquivo original). CC0 não exige atribuição; esta nota existe por cortesia e para
rastreabilidade.

O que entra no binário:

| Peça | Origem |
|---|---|
| Malha | `base.obj`, apenas o grupo `body` (helpers de roupa e cubos de rig ficam de fora) |
| Morph `ganho` / `perda` | targets de circunferência (`measure-*-circ-incr/decr`), barriga (`stomach-pregnant-incr`) e glúteo (`buttocks-volume-incr`), combinados na proporção clínica da adiposidade |
| Morph `feminino` / `masculino` | `macrodetails/caucasian-{female,male}-young` |

## Regenerar

```bash
node scripts/build-body-mesh.mjs <dir>
```

onde `<dir>` contém `base.obj` e a pasta `t/` com os `.target`. **Os `.target`
ficam PLANOS dentro de `t/`** — sem as subpastas de origem (`measure/`,
`stomach/`, `macrodetails/`…), porque o script resolve `<dir>/t/<nome>.target`
direto. Eles são baixados do repositório do MakeHuman e não são versionados
aqui. O script imprime a contagem de vértices, triângulos e vértices afetados
por morph, e falha se algum `.target` tiver linha malformada.
