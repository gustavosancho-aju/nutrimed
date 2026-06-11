# ADR-009 — Residência de Dados de Saúde no Brasil (LGPD)

| Campo | Valor |
|---|---|
| **Status** | **Aceito (direção)** — confirmação final condicionada à consultoria jurídica (ver [checklist](checklist-consultoria-juridica.md)) e à decisão de runtime da POC (ADR-005) |
| **Data** | 2026-06-11 |
| **Autor** | Aria (@architect) — Story 1.8 |
| **Fontes** | `docs/prd.md` NFR9, R2; `docs/architecture.md` §8 ("Considerar residência de dados no Brasil"), §9, §10 (ADR-006), §11, §12 (T7); `docs/epics/epic-01-fundacao-compliance.md` (IN: decisão de residência como ADR de follow-up) |

## Contexto

O NutriMed trata **dados sensíveis de saúde** (art. 5º, II e art. 11 da LGPD): áudio de consulta, transcrição, rótulo de paciente e contribuições clínicas das personas. O ADR-006 (Aceito) estabeleceu compliance-by-design — cripto, auditoria, consentimento e "residência BR desde o dia 1" — mas deixou a **decisão de residência** como follow-up formal (levantado também pelo AC7 da Story 1.3). O risco R2 (LGPD, severidade Alta) e o tech-risk T7 exigem que essa direção esteja documentada **antes do piloto com pacientes reais**.

Restrições vigentes:
- O runtime de produção ainda **não está decidido** (ADR-005 Proposto — POC de latência/custo, E3, define o modelo).
- A camada de fornecedores é abstraída (ADR-002/NFR8) — STT/LLM/Vídeo são trocáveis, mas cada fornecedor tem sua própria geografia de processamento.
- Dados em repouso já são cifrados na aplicação (AES-256-GCM, Story 1.3/NFR9) e em trânsito (TLS obrigatório).

## Decisão

1. **Dados de saúde e PII em repouso residem no Brasil.** Banco de dados de produção (Postgres), backups e qualquer storage de áudio/transcrição persistido DEVEM ser provisionados em região brasileira (ex.: `sa-east-1`/São Paulo ou equivalente do provedor escolhido na POC). Isso vale para réplicas e backups — sem replicação cross-border por default.
2. **Processamento efêmero por subprocessadores (STT/LLM) é tratado como transferência internacional** quando o fornecedor não processa no Brasil. Direção: **preferir fornecedores com endpoint/região BR**; onde não existir (provável para LLM/STT de ponta), a transferência deve ser amparada por mecanismo do art. 33 da LGPD (cláusulas contratuais/DPA do fornecedor) e **minimizada** (enviar somente o trecho necessário, sem identificadores do paciente — o rótulo do paciente nunca sai cifrado/decifrado para fornecedores). ⚠️ Item bloqueante do checklist jurídico (CJ-3).
3. **A escolha de infraestrutura na POC (E3) herda esta restrição como critério eliminatório:** candidato de runtime/banco sem região BR está fora. A latência adicional BR↔fornecedores externos entra no orçamento de latência da POC (architecture §11).
4. **Chaves de criptografia** (NFR9) são gerenciadas em KMS/secret manager na mesma jurisdição (BR) e nunca co-residem com os backups dos dados cifrados.

## Consequências

**Positivas:** postura LGPD defensável (R2); sem retrofit caro de migração de região; argumento comercial junto a nutrólogos/clínicas; coerente com ADR-006.

**Negativas/custos:** restringe o leque de fornecedores e regiões (alguns serviços gerenciados não têm região BR); latência adicional para STT/LLM sem endpoint BR — medida na POC (E3); eventual custo maior de região SA.

**Follow-ups técnicos (pós-decisão de runtime):** story de provisionamento de infra em região BR; DPA/contratos com fornecedores escolhidos; revisão deste ADR se a consultoria jurídica (checklist) apontar exigência mais estrita (ex.: vedação total de processamento externo de transcrição).

## Relação com outros ADRs

- **ADR-006** (compliance-by-design): este ADR formaliza o item "residência BR" que lá estava como princípio.
- **ADR-005** (runtime stateful — Proposto): a POC que o valida deve aplicar o critério eliminatório da Decisão 3.
- **ADR-002** (abstração de fornecedores): é o mecanismo que permite trocar fornecedor caso a exigência de região BR mude o vencedor da POC.
