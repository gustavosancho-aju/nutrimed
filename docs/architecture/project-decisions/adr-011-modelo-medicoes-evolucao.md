# ADR-011 — Modelo de Medições de Evolução (Blob JSON Cifrado por Linha)

| Campo | Valor |
|---|---|
| **Status** | **Aceito** — implementado na Fase 1 do E11 (Story 11.1) |
| **Data** | 2026-06-23 |
| **Autor** | Aria (@architect) — E11 (Pacientes & Dashboard) |
| **Fontes** | `docs/epics/epic-11-pacientes-dashboard.md` (FR25, NFR9); ADR-006 (compliance-by-design); padrão da nota clínica (E9, Story 9.2) |

## Contexto

O E11 acompanha a evolução longitudinal do paciente em duas séries temporais: composição corporal (bioimpedância) e exames laboratoriais. Cada série tem N medições por paciente, e o conjunto de marcadores pode crescer (hoje peso/massa/cintura/IMC/PGC e LDL/HbA1C/Insulina; amanhã, outros). Todos são dado de saúde ⇒ cifrados em repouso (NFR9).

Alternativa considerada: **uma coluna cifrada por marcador**. Rejeitada — exigiria migration a cada novo marcador, dezenas de colunas `_enc`, e leitura/escrita acopladas ao schema.

## Decisão

Cada medição é **uma linha** (`body_composition`, `lab_exam`) com os valores serializados em **JSON e cifrados num único campo `values_enc`** (AES-256-GCM), decifrado no servidor ao montar a dashboard — **mesmo padrão da nota clínica** (E9). A linha guarda `measured_at`, `source_consultation_id` (origem, nullable) e `patient_id`. Marcadores são opcionais (medição parcial é válida). Idade do paciente **não** é coluna — derivada de `birth_date_enc`.

## Consequências

**Positivas:** schema estável quando surgem novos marcadores (sem migration); reúso direto do padrão cifrado+auditado de E9; cripto-at-rest provada por teste (Story 11.1). **Negativas:** não dá para filtrar/agregar por marcador em SQL (o valor é opaco cifrado) — aceitável, pois a dashboard carrega a série inteira do paciente e ordena/agrega na aplicação.

## Relação com outros ADRs

- **ADR-006 / NFR9:** cripto em repouso por design. **ADR-012:** a importação de laudo grava o resultado confirmado como uma medição deste modelo.
