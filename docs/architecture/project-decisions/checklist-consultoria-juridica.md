# Checklist de Consultoria Jurídica — CFM / LGPD (R1/R2)

> **Story 1.8.** Perguntas a resolver com consultoria jurídica **antes de dados de pacientes reais** (piloto E10). Este documento **organiza** as questões — não é parecer jurídico. Cada item rastreia a um requisito/risco de origem (Article IV — No Invention).
>
> **📎 Insumos factuais para o advogado:** [`brief-tecnico-juridico.md`](brief-tecnico-juridico.md) — inventário de dados, fluxos de transferência internacional, segurança, consentimento e retenção (o que o dev já entregou e as lacunas que dependem da consultoria).
>
> **Legenda:** 🔴 **BLOQUEANTE para piloto com pacientes reais** (o E1 marca R1/R2 como bloqueantes) · 🟡 **Evolutivo** (pode ser resolvido após o início do piloto, com salvaguardas).

## Itens

| # | Questão para a consultoria | Origem (FR/NFR/Rxx/ADR) | Classificação |
|---|---|---|---|
| CJ-1 | **Base legal de tratamento** de dados sensíveis de saúde: consentimento do titular (art. 11, I LGPD) é suficiente e adequado, ou cabe tutela da saúde (art. 11, II, f)? Como o consentimento de gravação (FR20, Story 1.4) deve ser colhido/registrado para valer como base legal — e quem é o titular a consentir (paciente), dado que hoje quem registra é o médico? | R2, NFR9, FR20 | 🔴 Bloqueante |
| CJ-2 | **Retenção de áudio e transcrição**: por quanto tempo reter áudio bruto, transcrição e contribuições? Há prazo mínimo (prontuário/CFM) e máximo (minimização LGPD)? Política de descarte/anonimização? **Estado atual (fatos):** o áudio bruto NÃO é persistido; são persistidos cifrados e SEM política de descarte automático: `transcript_segment` (finais crus do STT, migr. 0008), **`transcript_review`** (transcrição corrigida pelo médico, migr. 0010 — novo), `clinical_note` (0004), `nutrition_report` (0009), `board_synthesis` (0007) e a trilha `audit_log` (append-only, 0003). Todos herdam desta decisão. | R1, R2, NFR9; architecture §11 ("retenção de áudio/transcrição") | 🔴 Bloqueante |
| CJ-3 | **Residência e transferência internacional**: a direção do ADR-009 (repouso no BR; processamento efêmero externo via art. 33 com minimização) é suficiente? Há vedação a enviar trechos de transcrição a STT/LLM sem região BR? Quais cláusulas exigir nos DPAs dos fornecedores? | R2, NFR9, ADR-009, ADR-002 | 🔴 Bloqueante |
| CJ-4 | **Papel da IA como apoio à decisão (CFM Res. 2.314/2022 e correlatas)**: o enquadramento "IA assiste, médico decide" (NFR10), com trilha de auditoria com proveniência (Story 1.5) e disclaimers persistentes (FR19, Story 1.7), é suficiente para afastar caracterização de diagnóstico autônomo? Há exigências adicionais de registro/transparência? | R1, NFR10, FR19; ADR-006 | 🔴 Bloqueante |
| CJ-5 | **Responsabilidade médica e termos de uso**: como alocar responsabilidade entre médico usuário e plataforma nos termos de uso? O aceite do nutrólogo precisa de cláusulas específicas sobre o caráter assistivo? | R1, NFR10 | 🔴 Bloqueante |
| CJ-6 | **Consentimento do paciente vs. do médico**: o fluxo atual registra o consentimento via médico autenticado (`granted_by`, Story 1.4). É necessário registro direto do paciente (assinatura, áudio do aceite) ou documento apartado? | R2, FR20 | 🔴 Bloqueante |
| CJ-7 | **Direitos do titular** (acesso, correção, eliminação — art. 18 LGPD) vs. **imutabilidade da trilha de auditoria** (NFR10, Story 1.5 — append-only): como compatibilizar pedido de eliminação com dever de guarda do prontuário e com a trilha de defesa? | R2, NFR9, NFR10 | 🟡 Evolutivo (definir processo antes da 1ª solicitação; salvaguarda: cripto + escopo mínimo de dados no piloto) |
| CJ-8 | **RIPD/DPIA** (Relatório de Impacto, art. 38 LGPD): é exigível antes do piloto? Quem assina como encarregado (DPO)? | R2 | 🟡 Evolutivo (recomendado iniciar no piloto; confirmar exigibilidade) |
| CJ-9 | **Base de conhecimento curada por persona** (FR21): uso de diretrizes/publicações de terceiros na KB exige licenciamento/atribuição? | FR21, R8 (qualidade da KB) | 🟡 Evolutivo |
| CJ-10 | **Incidentes de segurança** (art. 48 LGPD): plano de comunicação ANPD/titulares proporcional ao piloto. | R2, NFR9 | 🟡 Evolutivo (rascunho antes do piloto; formalização durante) |
| CJ-11 | **Importação de laudos por IA (E11/ADR-012)**: enviar um laudo (BIA/exames) a um extrator externo é transferência internacional de dado de saúde (liga a CJ-3) — quais salvaguardas/DPA e qual canal (API direta vs. Bedrock/Vertex vs. Document AI regional) atendem a residência BR? O design já exige **validação médica obrigatória** antes de persistir (ADR-012, NFR10) — isso é suficiente como salvaguarda de exatidão do dado clínico, ou cabe registro adicional do aceite do médico sobre os valores importados? | NFR9, NFR10, ADR-012, ADR-009 | 🟡 Evolutivo (bloqueante só quando a importação for ao ar com pacientes reais; entrada manual não depende disto — NFR13) |
| CJ-12 | **Canal Telegram do paciente (E12/ADR-013)**: o bot de acompanhamento troca fotos/mensagens do paciente por um serviço externo (Telegram, fora do BR) — transferência internacional de dado de saúde do **titular paciente** (liga a CJ-3). O design prevê **consentimento por canal** (default NEGA, revogável), **minimização** (só `chat_id` ao Telegram; sem identificadores do paciente), **imagem não persistida** por default, e **termo de uso exibido no pareamento**. Isso é suficiente? O consentimento colhido via bot (ato de parear) é base legal válida para o titular paciente (liga a CJ-1/CJ-6)? Qual DPA/canal (Telegram vs. WhatsApp Business regional vs. app próprio) atende a residência BR na comercialização? A estimativa aproximada por foto + disclaimer (ADR-015) afasta caracterização de ato clínico autônomo (liga a CJ-4)? | NFR9, NFR10, NFR14, ADR-013, ADR-014, ADR-015, ADR-009 | 🔴 Bloqueante (para o canal do paciente ir ao ar com pacientes reais; o desenvolvimento/testes com fake não dependem disto) |
| CJ-13 | **Relatório nutricional derivado de IA (E13)**: novo documento clínico gerado a partir da transcrição (mesma natureza da nota clínica E9 — rascunho de IA com revisão médica obrigatória, cifrado NFR9, auditado NFR10 com fontes TACO). O desenho "IA extrai o recordatório, código calcula pela tabela TACO (dado público), médico revisa/edita" muda algo na análise de ato clínico (CJ-4) ou na retenção do transcript (CJ-2)? A citação da TACO (NEPA/Unicamp, domínio público) exige atribuição formal no documento? | NFR9, NFR10, FR17 | 🟡 Evolutivo (herda os pareceres da nota clínica E9; não bloqueia o dev) |

## Critério de saída (gate do piloto E10)

O piloto com pacientes reais **não inicia** enquanto CJ-1…CJ-6 não tiverem parecer jurídico documentado e incorporado (atualizando ADR-009 e as stories de produto afetadas). Itens 🟡 têm dono e prazo definidos até o fim do piloto.

Gate específico de canal: o **canal Telegram do paciente (E12)** não vai ao ar com pacientes reais enquanto **CJ-12** não tiver parecer (adicional a CJ-1…CJ-6, dos quais herda base legal/residência). O desenvolvimento e os testes com dados fictícios/fake (`FOOD_ESTIMATOR=fake`) **não dependem** de CJ-12.

## Referências

- `docs/prd.md` — NFR9, NFR10, FR19–FR21, riscos R1/R2
- `docs/architecture.md` — §8, §11 (item para consultoria jurídica), §12 (T7)
- [ADR-009 — Residência de Dados BR](adr-009-residencia-dados-br.md) · ADR-006 (compliance-by-design)
- Stories: 1.4 (consentimento), 1.5 (auditoria), 1.7 (disclaimers)
