# Checklist de Consultoria Jurídica — CFM / LGPD (R1/R2)

> **Story 1.8.** Perguntas a resolver com consultoria jurídica **antes de dados de pacientes reais** (piloto E10). Este documento **organiza** as questões — não é parecer jurídico. Cada item rastreia a um requisito/risco de origem (Article IV — No Invention).
>
> **Legenda:** 🔴 **BLOQUEANTE para piloto com pacientes reais** (o E1 marca R1/R2 como bloqueantes) · 🟡 **Evolutivo** (pode ser resolvido após o início do piloto, com salvaguardas).

## Itens

| # | Questão para a consultoria | Origem (FR/NFR/Rxx/ADR) | Classificação |
|---|---|---|---|
| CJ-1 | **Base legal de tratamento** de dados sensíveis de saúde: consentimento do titular (art. 11, I LGPD) é suficiente e adequado, ou cabe tutela da saúde (art. 11, II, f)? Como o consentimento de gravação (FR20, Story 1.4) deve ser colhido/registrado para valer como base legal — e quem é o titular a consentir (paciente), dado que hoje quem registra é o médico? | R2, NFR9, FR20 | 🔴 Bloqueante |
| CJ-2 | **Retenção de áudio e transcrição**: por quanto tempo reter áudio bruto, transcrição e contribuições? Há prazo mínimo (prontuário/CFM) e máximo (minimização LGPD)? Política de descarte/anonimização? | R1, R2, NFR9; architecture §11 ("retenção de áudio/transcrição") | 🔴 Bloqueante |
| CJ-3 | **Residência e transferência internacional**: a direção do ADR-009 (repouso no BR; processamento efêmero externo via art. 33 com minimização) é suficiente? Há vedação a enviar trechos de transcrição a STT/LLM sem região BR? Quais cláusulas exigir nos DPAs dos fornecedores? | R2, NFR9, ADR-009, ADR-002 | 🔴 Bloqueante |
| CJ-4 | **Papel da IA como apoio à decisão (CFM Res. 2.314/2022 e correlatas)**: o enquadramento "IA assiste, médico decide" (NFR10), com trilha de auditoria com proveniência (Story 1.5) e disclaimers persistentes (FR19, Story 1.7), é suficiente para afastar caracterização de diagnóstico autônomo? Há exigências adicionais de registro/transparência? | R1, NFR10, FR19; ADR-006 | 🔴 Bloqueante |
| CJ-5 | **Responsabilidade médica e termos de uso**: como alocar responsabilidade entre médico usuário e plataforma nos termos de uso? O aceite do nutrólogo precisa de cláusulas específicas sobre o caráter assistivo? | R1, NFR10 | 🔴 Bloqueante |
| CJ-6 | **Consentimento do paciente vs. do médico**: o fluxo atual registra o consentimento via médico autenticado (`granted_by`, Story 1.4). É necessário registro direto do paciente (assinatura, áudio do aceite) ou documento apartado? | R2, FR20 | 🔴 Bloqueante |
| CJ-7 | **Direitos do titular** (acesso, correção, eliminação — art. 18 LGPD) vs. **imutabilidade da trilha de auditoria** (NFR10, Story 1.5 — append-only): como compatibilizar pedido de eliminação com dever de guarda do prontuário e com a trilha de defesa? | R2, NFR9, NFR10 | 🟡 Evolutivo (definir processo antes da 1ª solicitação; salvaguarda: cripto + escopo mínimo de dados no piloto) |
| CJ-8 | **RIPD/DPIA** (Relatório de Impacto, art. 38 LGPD): é exigível antes do piloto? Quem assina como encarregado (DPO)? | R2 | 🟡 Evolutivo (recomendado iniciar no piloto; confirmar exigibilidade) |
| CJ-9 | **Base de conhecimento curada por persona** (FR21): uso de diretrizes/publicações de terceiros na KB exige licenciamento/atribuição? | FR21, R8 (qualidade da KB) | 🟡 Evolutivo |
| CJ-10 | **Incidentes de segurança** (art. 48 LGPD): plano de comunicação ANPD/titulares proporcional ao piloto. | R2, NFR9 | 🟡 Evolutivo (rascunho antes do piloto; formalização durante) |

## Critério de saída (gate do piloto E10)

O piloto com pacientes reais **não inicia** enquanto CJ-1…CJ-6 não tiverem parecer jurídico documentado e incorporado (atualizando ADR-009 e as stories de produto afetadas). Itens 🟡 têm dono e prazo definidos até o fim do piloto.

## Referências

- `docs/prd.md` — NFR9, NFR10, FR19–FR21, riscos R1/R2
- `docs/architecture.md` — §8, §11 (item para consultoria jurídica), §12 (T7)
- [ADR-009 — Residência de Dados BR](adr-009-residencia-dados-br.md) · ADR-006 (compliance-by-design)
- Stories: 1.4 (consentimento), 1.5 (auditoria), 1.7 (disclaimers)
