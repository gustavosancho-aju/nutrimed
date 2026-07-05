# POC 2.5 — STT clínico: Deepgram nova-2+keywords vs. nova-3+keyterm

> Épico **Transcrição Confiável**, Story 3. Objetivo: escolher a configuração de
> transcrição por **acurácia de termo clínico** (não WER genérico), porque é o termo
> clínico corrompido — "precordial" → "primordial", "palpitação" → "próvercoação"
> (consulta real cbb25091) — que corrói a confiança do nutrólogo.

## Estado

- ✅ **Adapter POC-ready** — `buildListenUrl` (packages/stt-deepgram) escolhe o parâmetro
  de boost pelo modelo: `keywords` no nova-2, **`keyterm` no nova-3** (o Deepgram IGNORA
  `keywords` no nova-3). Basta setar `DeepgramConfig.model`.
- ✅ **Métricas** — `clinicalTermRecall` + `wordErrorRate` + `scoreTranscript`
  (packages/domain/src/stt-accuracy.ts), testadas.
- ✅ **Harness** — `scripts/poc-stt-score.mjs`, runnable, agrega por configuração.
- ⛔ **Falta o insumo empírico**: áudio clínico real em pt-BR + a Deepgram key
  (rotacionar antes — a atual vazou pelo chat). Sem isso a POC não roda; o resto está pronto.

## Resultados — 1º ciclo (áudio TTS, 2026-07-04)

Rodado com `scripts/poc-stt-run.mjs`: 12 frases clínicas pt-BR sintetizadas por **Gemini TTS**
(referência conhecida) → transcritas por cada config do Deepgram (pré-gravado, linear16) →
pontuadas com as métricas de `@nutrimed/domain`. Vocabulário completo (64 termos) como boost.

| Config | Recall clínico | WER médio | Termos perdidos |
|---|---|---|---|
| nova-2 + keywords | **92,3%** (24/26) | 10,4% | precordial, hipotireoidismo |
| **nova-3 + keyterm** | **100%** (26/26) | **4,4%** | — |

**Sinal direcional: nova-3 + keyterm vence** — recall clínico perfeito e metade do WER. O nova-2
ainda produziu tokens estranhos ("D" no lugar de "precordial"/"dislipidemia") que valem investigar
(possível artefato de `keywords`/redação), mas o nova-3 foi consistentemente mais limpo.

⚠️ **Caveat (não pular):** áudio TTS é mais limpo que consulta real → estes números são um **teto
otimista**. Antes de trocar produção para nova-3, confirmar com **áudio clínico real** (ruído,
sotaque, fala sobreposta). O adapter já está pronto: basta `DeepgramConfig.model = 'nova-3'` (o
boost vira `keyterm` automaticamente). Registrar a decisão em ADR-010 com os números do ciclo real.

## Arms comparados

| Config | model | boost | observação |
|---|---|---|---|
| A (atual) | `nova-2` | `keywords=` (CLINICAL_VOCABULARY) | baseline em produção |
| B | `nova-3` | `keyterm=` (CLINICAL_VOCABULARY) | contextual, multilíngue, ~100 termos |

⚠️ **Não assumir que B vence**: o suporte a `keyterm` em **pt-BR** do Nova-3 precisa ser
medido, não presumido. A Deepgram anunciou keyterm multilíngue e pt-BR no Nova-3, mas a
eficácia em termos clínicos pt-BR é justamente a hipótese da POC.

## Como coletar o dataset (ground truth)

A própria feature de **Transcrição Confiável** dá o ground truth barato: o médico já
revisa o transcript no fim da consulta → a versão revisada (`transcript_review`) é a
**referência**. Para cada amostra:

1. **Referência** = transcript revisado pelo médico (texto corrido), salvo em `poc/ref/NN.txt`.
2. **Hipóteses** = rodar o MESMO áudio por cada config do adapter e salvar a saída crua
   (sem revisão) em `poc/hyp/NN-a.txt` (nova-2) e `poc/hyp/NN-b.txt` (nova-3).
   - Áudio: consultas reais **com consentimento** (FR20) OU, como proxy inicial sem
     paciente, TTS de 20–30 frases clínicas plantadas com os termos do vocabulário.
3. Mínimo sugerido: **≥ 15 amostras** cobrindo cardio/endo/nutro + recordatório alimentar.

Manifest (`poc/manifest.json`):

```json
{ "samples": [
  { "reference": "ref/01.txt",
    "hypotheses": { "nova2-keywords": "hyp/01-a.txt", "nova3-keyterm": "hyp/01-b.txt" } }
] }
```

## Rodar

```bash
node --experimental-strip-types scripts/poc-stt-score.mjs poc/manifest.json
```

Saída por configuração: **recall clínico** (por termo e média/amostra), **WER médio** e os
**termos mais perdidos** — a lista que diz onde a confiança quebra.

## Critério de decisão / aceite

- **Métrica primária**: recall de termo clínico. **Meta de produção: ≥ 95%.**
- **Desempate**: menor WER.
- Escolher a config vencedora → setar `DeepgramConfig.model` no runtime (apps/web) e,
  se for nova-3, o boost já vira `keyterm` automaticamente. Registrar a decisão em
  ADR-010 (runtime/STT) com os números.
- Se nenhuma atingir 95%, a saída não é "reprovar": é (a) manter a revisão humana como
  rede (já em produção) e (b) expandir o vocabulário/keyterm nos termos mais perdidos.

## Dependências

1. **Rotacionar a Deepgram key** (frente 2 — segurança) antes de qualquer chamada real.
2. Áudio consentido (liga a CJ — consultoria jurídica) OU proxy TTS para o 1º ciclo.
