# NutriMed — Plano de POC: Latência & Custo (STT + LLM)

> **Autor:** Atlas (@analyst) · **Data:** 2026-06-09 · **Status:** Pronto para execução por @dev
> **Origem:** recomendação da arquitetura (`docs/architecture.md` §14) — validar antes de comprometer a stack.
> **Pré-requisitos de épico:** E2 (Pipeline de Transcrição) + E3 (Walking Skeleton). Ver `docs/epics/`.
> **Nota de escopo:** este documento DESENHA a POC e faz o shortlist dos fornecedores com base em pesquisa de mercado (jun/2026). A EXECUÇÃO (código + chaves de API + medição real) é trabalho de @dev e exige credenciais/infra do usuário.

---

## 1. Por que esta POC existe

A arquitetura classificou o produto como **COMPLEX** e apontou 3 riscos técnicos que só dados reais resolvem **antes** de investir nos épicos caros (E4/E5/E6):

| Risco | Hipótese a validar |
|---|---|
| **T1 — Latência** | É possível ir da fala à sugestão no feed em **~3–4s** (NFR5)? Se não, o board "ativo" não é útil em consulta. |
| **T2 — Custo** | O custo por consulta fica controlado com o board sempre ativo? (gating barato antes do LLM funciona?) |
| **T4 — STT PT-BR clínico** | Existe um STT que transcreva PT-BR com jargão cardiometabólico (GLP-1, tireoide, fármacos) com WER aceitável e baixa latência? |
| **ADR-005** | O orchestrator stateful + WebSocket é viável no runtime escolhido? |

**Regra de ouro:** se a POC falhar em T1 ou T4, **não se prossegue** para E4/E5/E6 sem replanejar — é mais barato descobrir aqui.

---

## 2. Candidatos — STT (PT-BR, tempo real, viés médico)

Shortlist com base em pesquisa jun/2026. **Testar 2–3.**

| Provedor | Pontos fortes | PT-BR | Médico | Latência divulgada |
|---|---|---|:--:|---|
| **Speechmatics** | Anuncia otimização explícita p/ **PT-BR**; modelo médico com **~93% acc / 4% keyword error**; "real-time first". | ✅ explícito | ✅ modelo médico | < 1s |
| **Deepgram (Nova-3 Medical / Flux Multilingual)** | **Nova-3 Medical** + **Keyterm Prompting** (até 100 termos — ideal p/ fármacos/jargão); Flux Multilingual inclui português. | ✅ (Flux) | ✅ médico | ~150ms (voice agent) |
| **Soniox** | Treinado em **PT real de múltiplas regiões/sotaques**; caso de uso explícito de **nota clínica em português**; comparativo próprio vs. 8 provedores. | ✅ forte | ✅ clínico | tempo real |
| **AssemblyAI (Universal-3 / Multilingual Streaming)** | Streaming multilíngue (mai/2026), ~150ms P50, code-switching PT. | ✅ | parcial | ~150ms P50 |
| **ElevenLabs Scribe v2 Realtime** | 150ms, 90+ idiomas incl. PT-BR. | ✅ | — | 150ms |

**Recomendação de teste:** **Speechmatics** (otimização PT-BR + médico) vs. **Deepgram Nova-3 Medical** (keyterm prompting p/ fármacos) vs. **Soniox** (PT clínico). Esses três têm a melhor combinação PT-BR + clínico.

> ⚠️ Atenção: a pesquisa não trouxe **WER específico de PT-BR médico** publicado — por isso o teste com **áudio clínico brasileiro real** é insubstituível.

---

## 3. Candidatos — LLM (estratégia de dois níveis)

A arquitetura (ADR-008) exige **gating barato antes do LLM**. Logo, a POC testa **dois papéis distintos**:

### Nível 1 — Trigger/Classificação (alto volume, precisa ser barato e rápido)
Decide "isto merece uma contribuição?" e classifica o tipo (⚠️/💡/🔍). Roda muito.

| Candidato | Custo aprox. (in/out por 1M) | Latência |
|---|---|---|
| **Gemini 3 Flash-Lite** | ~$0.075 / $0.30 | baixa |
| **GPT-5 nano** | ~$0.05 / $0.40 | baixa |
| **Groq (Llama/Qwen na LPU)** | variável | **sub-100ms TTFT** (mais rápido) |
| **DeepSeek V3.2** | ~$0.14 / $0.28 (mais barato) | média |

### Nível 2 — Geração da contribuição (qualidade clínica importa mais)
Gera o texto da sugestão com contexto RAG. Roda pouco (só quando o gate aprova).

| Candidato | Observação |
|---|---|
| **Claude (Haiku 4.5 / Sonnet 4.6)** | Haiku p/ custo-latência; Sonnet se a qualidade clínica exigir. |
| **Gemini 3 Flash** | Equilíbrio custo/qualidade. |
| **GPT-5 (mini/full)** | Comparar qualidade clínica em PT-BR. |

**Recomendação de teste:** Nível 1 → **Groq** (velocidade) vs. **Gemini 3 Flash-Lite** (custo). Nível 2 → **Claude Haiku 4.5** vs. **Gemini 3 Flash**, com um modelo mais forte (Sonnet/GPT-5) como referência de qualidade.

---

## 4. Orçamento de latência (o que medir)

Decompor a latência fim-a-fim e medir **cada etapa** (não só o total):

```
fala encerrada
  │  (1) STT: áudio → texto final ............. alvo ≤ 1.5s
  ▼
segmento de transcrição
  │  (2) Trigger + Score (Nível 1) ............ alvo ≤ 0.3s
  ▼
candidato aprovado
  │  (3) RAG retrieve + LLM Nível 2 ........... alvo ≤ 1.5s
  ▼
contribuição pronta
  │  (4) transport (WS) + render ............. alvo ≤ 0.3s
  ▼
sugestão visível no feed ........... ALVO TOTAL ≤ 3.6s (não-crítico)
```

⚠️ **Críticos:** medir o caminho priorizado (fura fila/pausa) — alvo mais agressivo.

---

## 5. Modelo de custo (o que calcular)

**Custo por consulta de 30 min** = custo STT (por minuto de áudio × 30) + custo LLM Nível 1 (chamadas de trigger × tokens) + custo LLM Nível 2 (contribuições aprovadas × tokens) + custo de retrieve.

Variáveis a instrumentar:
- nº de segmentos de transcrição por consulta
- % de segmentos que disparam trigger (gating)
- nº de contribuições efetivas por consulta (após rate-limit/dedup)
- tokens médios in/out por contribuição

> **Meta:** custo por consulta que feche a margem no tier Board (~R$ 349–499/mês). Calcular o break-even de consultas/mês.

---

## 6. Protocolo de teste

1. **Corpus de áudio:** gravar/coletar **5–10 consultas simuladas em PT-BR** com casos cardiometabólicos reais (GLP-1, tireoide, hipertensão, dislipidemia, platô de emagrecimento), incluindo sotaques variados e jargão/fármacos. *Esse corpus é o ativo mais importante da POC.*
2. **Ground truth:** transcrição humana de referência + lista de **termos clínicos-chave** (fármacos, exames) para medir *keyword error rate*, não só WER global.
3. **Rodar cada STT candidato** sobre o corpus → medir WER global, **keyword error rate clínico**, e latência de segmento.
4. **Rodar o pipeline de gating + LLM** sobre as transcrições → medir TTFT, latência por etapa, custo por consulta, e **qualidade clínica** das contribuições (avaliação por um médico: as sugestões são corretas/úteis/seguras?).
5. **Validar ADR-005:** subir o orchestrator stateful + WS num ambiente realista; medir comportamento sob 1, 5, 10 sessões concorrentes.

---

## 7. Critérios de sucesso (decision gates)

| Métrica | Verde (segue) | Amarelo (ajusta) | Vermelho (replaneja) |
|---|---|---|---|
| Latência total não-crítico | ≤ 3.5s | 3.5–5s | > 5s |
| Keyword error rate clínico (STT) | ≤ 6% | 6–12% | > 12% |
| Custo por consulta | dentro da margem-alvo | apertado | inviabiliza tier |
| Qualidade clínica (médico) | sugestões úteis e seguras | mistas | perigosas/inúteis |
| Orchestrator stateful (ADR-005) | escala ok | gargalos contornáveis | inviável no runtime |

**Saída da POC:** um **relatório de decisão** que (a) escolhe o STT e os 2 LLMs (Nível 1/2), (b) confirma ou ajusta o orçamento de latência, (c) valida o modelo de runtime (ADR-005), (d) dá sinal verde/amarelo/vermelho para E4/E5/E6.

---

## 8. O que eu (analista) recomendo levar para a POC

- **Comece o corpus de áudio JÁ** — é o gargalo e o ativo mais valioso; independe de escolha de fornecedor. Sua rede de nutricionistas/médicos pode ajudar a gerar consultas simuladas realistas.
- **STT:** Speechmatics + Deepgram Nova-3 Medical + Soniox (3 candidatos).
- **LLM Nível 1:** Groq vs. Gemini 3 Flash-Lite. **Nível 2:** Claude Haiku 4.5 vs. Gemini 3 Flash (Sonnet/GPT-5 como referência de qualidade).
- **Um médico no loop** para avaliar a qualidade clínica das contribuições — sem isso, mede-se latência/custo mas não o que importa de verdade (segurança).

---

## Fontes (pesquisa jun/2026)

- AssemblyAI — Top APIs for real-time STT 2026: https://www.assemblyai.com/blog/best-api-models-for-real-time-speech-recognition-and-transcription
- Speechmatics — Portuguese STT: https://www.speechmatics.com/speech-to-text/portuguese
- Speechmatics — recorde médico 93%: https://www.speechmatics.com/company/articles-and-news/speechmatics-sets-record-in-medical-speech-to-text-with-93-percent-accuracy
- Deepgram — medical STT (Nova-3 Medical, Keyterm): https://deepgram.com/solutions/medical-transcription
- Soniox — nota clínica em português: https://soniox.com/soniox-app/for/physicians-clinical-note-transcription-in-portuguese
- Corti — clinical STT (Symphony 4.1% WER): https://www.corti.ai/speech-to-text
- ElevenLabs Scribe v2 Realtime: https://elevenlabs.io/realtime-speech-to-text
- LLM pricing comparison (jun/2026): https://costgoat.com/compare/llm-api · https://pricepertoken.com/
- Fastest LLM inference: https://aisuperior.com/fastest-llm-inference-api-cost/

---

*Documento gerado por Atlas (@analyst) — AIOX. Próximo: @dev executa a POC (E2+E3) com 2 candidatos por categoria; relatório de decisão alimenta E4/E5/E6.*
