# NutriMed — UX do Board Proativo

> **Autor:** Atlas (Business Analyst) · **Data:** 2026-06-08 · **Status:** Draft v1.0
> **Decisões:** Board **Ativo** + **Painel lateral fixo** · MVP só texto, vídeo por IA
> **Relacionado:** `docs/personas-board.md` · `docs/personas-knowledge-base-seed.md`

---

## Decisões fechadas

| Decisão | Escolha | Implicação |
|---|---|---|
| Intrusividade | **Board Ativo** | Sugestões aparecem em tempo real com destaque — presença máxima dos mentores |
| Layout | **Painel lateral fixo** | 3 vídeos pequenos + feed de sugestões numa coluna lateral sempre visível |
| Modalidade | Apenas texto (MVP) | Contribuições escritas; vídeo é presença silenciosa |
| Vídeo | Gerado por IA | Loops: ouvindo / pensando / sinalizando |

---

## Layout do Painel Lateral Fixo

```
┌─────────────────────────────────┬──────────────────────────┐
│                                  │   BOARD NUTRIMED         │
│                                  │ ┌──────┬──────┬──────┐   │
│                                  │ │🩺Auré│❤️Paulo│🔬Yara│   │  ← 3 vídeos IA (loop)
│     ÁREA PRINCIPAL               │ │ lio  │      │      │   │     estado: ouvindo
│   (transcrição ao vivo /         │ └──────┴──────┴──────┘   │
│    prontuário / vídeo da         │ ──────────────────────── │
│    consulta)                     │  FEED DE SUGESTÕES       │
│                                  │                          │
│                                  │ ⚠️ Paulo · 14:32         │  ← alerta (topo, destaque)
│                                  │ Paciente em GLP-1 +      │
│                                  │ palpitação: checar PA/FC │
│                                  │ [expandir] [✓] [silenciar]│
│                                  │                          │
│                                  │ 🔍 Yara · 14:31          │
│                                  │ E se for tireoide? Su-   │
│                                  │ giro TSH e T4 livre      │
│                                  │                          │
│                                  │ 💡 Aurélio · 14:30       │
│                                  │ Vale perguntar sobre     │
│                                  │ rotina de sono           │
│                                  │ ──────────────────────── │
│                                  │ [🔇 Modo Foco]           │
└─────────────────────────────────┴──────────────────────────┘
```

- O **vídeo do doutor que acabou de sugerir** muda para o estado "sinalizando" por alguns segundos, puxando o olhar — reforça quem falou.
- O feed é **cronológico inverso** (mais recente no topo), mas ⚠️ críticos **fixam no topo** até resolvidos.

---

## Hierarquia de mensagens (4 tipos)

| Tipo | Ícone | Cor sugerida | Comportamento no Board Ativo |
|---|---|---|---|
| **Ponto de atenção** | ⚠️ | Âmbar/vermelho | Fixa no topo + leve pulso visual; pode emitir destaque mais forte |
| **Sugestão de pergunta** | 💡 | Azul | Entra no topo do feed, destaque suave que desvanece |
| **Hipótese / insight** | 🔍 | Roxo | Entra no topo do feed, destaque suave |
| **Síntese** | 📋 | Neutro | Aurélio agrupa ao final da rodada ou sob demanda |

> Mesmo no Board Ativo, **a cor/peso de ⚠️ é sempre maior que 💡/🔍**. Segurança nunca compete visualmente com sugestão comum.

---

## Guarda-corpos contra ruído (críticos no modo Ativo)

Você escolheu presença máxima — então estes mecanismos deixam de ser "nice to have" e viram **essenciais** para o board ativo não virar caótico:

1. **Score de relevância:** o doutor só publica se a confiança/relevância passar de um limiar. Palpite fraco não vira mensagem.
2. **Rate limit por doutor:** teto de sugestões por minuto (ex.: 1–2), com fila de prioridade. ⚠️ sempre fura a fila; redundância é descartada.
3. **Deduplicação:** se dois doutores apontam o mesmo, Aurélio consolida em uma só mensagem.
4. **Surgimento em pausas:** 💡/🔍 entram em pausas naturais da fala; só ⚠️ críticos aparecem imediatamente.
5. **Decaimento visual:** o destaque de uma sugestão desvanece após X segundos para não acumular ruído visual permanente.

---

## Controles do nutrólogo

| Controle | Função |
|---|---|
| **Silenciar doutor** | Desliga um especialista pontualmente (ex.: "hoje não preciso do cardio") |
| **Expandir** | Abre o detalhe da sugestão / permite perguntar mais àquele doutor (texto) |
| **✓ Dispensar** | Marca como visto/resolvido; some do destaque |
| **📌 Fixar** | Mantém uma sugestão à vista |
| **🔇 Modo Foco** | Silencia tudo exceto ⚠️ críticos — para momentos delicados com o paciente |

---

## ⚠️ Risco a validar (decorrente da escolha "Board Ativo")

> **O Board Ativo entrega mais "uau" no demo, mas tem maior risco de distração na consulta real.** Isso precisa ser **testado com nutrólogos reais** o quanto antes:
> - O médico consegue manter contato visual com o paciente com o painel ativo ao lado?
> - As sugestões em tempo real ajudam ou competem pela atenção?
> - Qual a frequência tolerável antes de virar ruído?
>
> **Mitigação já embutida:** os 5 guarda-corpos acima + o **Modo Foco**. Recomendação: medir no piloto a taxa de uso do "silenciar/Modo Foco" — se for alta, é sinal de que o default deveria migrar para o "Quiet Board".

---

## Decisões em aberto
- [ ] Calibrar o **limiar de relevância** e o **rate limit** (depende de teste com médicos)
- [ ] Definir gatilho preciso de "pausa natural" na fala (silêncio de N segundos? fim de turno?)
- [ ] Especificar visual final (cores, animação do pulso, transição dos estados de vídeo)
- [ ] Validar com nutrólogos reais o nível de intrusividade (ver risco acima)

---

*Documento gerado por Atlas (Business Analyst) — AIOX. Sugestão: este design merece passar por @ux-design-expert (Uma) para wireframes e por @pm (Morgan) no PRD.*
