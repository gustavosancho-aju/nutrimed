/**
 * Migrations versionadas (fonte de verdade, em ordem).
 *
 * SQL inline em TS — robusto em qualquer runtime (Node, Vitest, bundle do Next),
 * sem depender de leitura de arquivos `.sql` do disco. Cada entrada é aplicada
 * uma única vez e rastreada em `_migrations` (ver `runMigrations`).
 */
export interface Migration {
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    name: '0001_init',
    sql: `
-- Entidades base (architecture.md §8). Idempotente. gen_random_uuid() é nativo (PG13+).
-- Colunas com sufixo _enc guardam ciphertext base64 (AES-256-GCM, @nutrimed/crypto) — NFR9.

CREATE TABLE IF NOT EXISTS app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consultation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES app_user(id),
  patient_label_enc  text NOT NULL,
  status             text NOT NULL DEFAULT 'open',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consultation_user_id ON consultation(user_id);

CREATE TABLE IF NOT EXISTS consent (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL UNIQUE REFERENCES consultation(id),
  granted          boolean NOT NULL DEFAULT false,
  granted_by       uuid REFERENCES app_user(id),
  granted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id  uuid,
  kb_sources       jsonb,
  model_version    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_contribution_id ON audit_log(contribution_id);
`,
  },
  {
    name: '0002_auth_session',
    sql: `
-- Autenticação (Story 1.2): estende app_user com credencial e adiciona sessões.
-- password_hash é scrypt (salt embutido) — nunca em claro.

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS password_hash text;

CREATE TABLE IF NOT EXISTS session (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(user_id);
`,
  },
  {
    name: '0003_audit_provenance',
    sql: `
-- Audit Service (Story 1.5 / NFR10): proveniência completa + imutabilidade.
-- A tabela está vazia em todos os ambientes (nenhuma escrita de auditoria antes
-- desta story), então SET NOT NULL é seguro.

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS triggered_by text;

ALTER TABLE audit_log ALTER COLUMN triggered_by SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN kb_sources SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN model_version SET NOT NULL;

-- Append-only (defesa CFM): qualquer UPDATE/DELETE pela aplicação é rejeitado
-- no banco, independente de bug ou bypass na camada de serviço.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'audit_log é append-only (NFR10): % proibido', TG_OP;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
`,
  },
  {
    name: '0004_clinical_note',
    sql: `
-- Documentação clínica (Story 9.2 / FR17): nota simples editável, 1:1 com a
-- consulta. Conteúdo é dado de saúde ⇒ cifrado em repouso (NFR9, sufixo _enc).

CREATE TABLE IF NOT EXISTS clinical_note (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL UNIQUE REFERENCES consultation(id),
  content_enc      text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '0005_patients_evolution',
    sql: `
-- Pacientes & Evolução (Story 11.1 / E11, FR22/FR25). O paciente vira entidade
-- de primeira classe (dono = médico). PII e dados de saúde são cifrados em
-- repouso (NFR9, sufixo _enc). Idade NÃO é coluna — é derivada de birth_date_enc
-- no servidor. Cada medição guarda os valores num blob JSON cifrado (values_enc),
-- decifrado no servidor ao montar a dashboard (ADR-011) — mesmo padrão da nota.

CREATE TABLE IF NOT EXISTS patient (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES app_user(id),
  name_enc       text NOT NULL,
  phone_enc      text,
  birth_date_enc text,
  goal_enc       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patient_user_id ON patient(user_id);

-- Consultas passam a apontar para um paciente. NULLABLE de propósito: consultas
-- antigas (rótulo solto em patient_label_enc) continuam válidas, sem backfill.
ALTER TABLE consultation ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES patient(id);
CREATE INDEX IF NOT EXISTS idx_consultation_patient_id ON consultation(patient_id);

-- Evolução de composição corporal (bioimpedância) — N por paciente.
-- values_enc = AES-256-GCM de JSON { peso, massaMuscular, massaGordura, cintura, imc, pgc }.
CREATE TABLE IF NOT EXISTS body_composition (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id             uuid NOT NULL REFERENCES patient(id),
  measured_at            timestamptz NOT NULL,
  source_consultation_id uuid REFERENCES consultation(id),
  values_enc             text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_body_composition_patient_id ON body_composition(patient_id);

-- Evolução de exames laboratoriais — N por paciente.
-- values_enc = AES-256-GCM de JSON { ldl, hba1c, insulina }.
CREATE TABLE IF NOT EXISTS lab_exam (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id             uuid NOT NULL REFERENCES patient(id),
  measured_at            timestamptz NOT NULL,
  source_consultation_id uuid REFERENCES consultation(id),
  values_enc             text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lab_exam_patient_id ON lab_exam(patient_id);
`,
  },
  {
    name: '0006_telegram_nutrition',
    sql: `
-- Bot de Telegram (E12): foto de prato → estimativa nutricional vs. metas.
-- Valores/PII cifrados em repouso (NFR9, values_enc). Toda escrita é auditada (NFR10).
-- Telegram é canal EXTERNO: o vínculo exige consentimento do paciente (ADR-013),
-- default NEGA. Identidade por CÓDIGO DE PAREAMENTO (ADR-014) — sem busca por
-- telefone (phone_enc tem IV aleatório, não é determinístico). A estimativa da
-- foto é aproximada, não prescrição (ADR-015).

-- Metas nutricionais por paciente, definidas pelo nutricionista. Versionadas
-- (append-only, sem UPDATE destrutivo): a meta vigente é a de maior effective_from
-- <= o dia consultado. values_enc = AES-256-GCM de JSON { kcal, protein, carbs, fat }.
CREATE TABLE IF NOT EXISTS nutrition_goal (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL REFERENCES patient(id),
  set_by_user_id uuid NOT NULL REFERENCES app_user(id),
  effective_from date NOT NULL,
  values_enc     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nutrition_goal_patient
  ON nutrition_goal(patient_id, effective_from DESC);

-- Registro diário de consumo (uma linha por foto de prato). photo_ref guarda a
-- REFERÊNCIA do Telegram (file_id), NÃO a imagem — a foto não é persistida (ADR-013).
-- values_enc = AES-256-GCM de JSON { kcal, protein, carbs, fat, confidence, itemsLabel }.
CREATE TABLE IF NOT EXISTS food_log_entry (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES patient(id),
  eaten_at      timestamptz NOT NULL,
  source        text NOT NULL DEFAULT 'telegram',
  photo_ref     text,
  values_enc    text NOT NULL,
  model_version text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_food_log_patient_eaten
  ON food_log_entry(patient_id, eaten_at);

-- Vínculo chat_id do Telegram → paciente. consent_granted = gate do canal (default
-- NEGA — ADR-013). O índice único parcial garante NO MÁXIMO 1 canal ativo por
-- paciente, sem impedir o histórico de vínculos revogados.
CREATE TABLE IF NOT EXISTS telegram_link (
  chat_id           text PRIMARY KEY,
  patient_id        uuid NOT NULL REFERENCES patient(id),
  consent_granted   boolean NOT NULL DEFAULT false,
  linked_by_user_id uuid REFERENCES app_user(id),
  linked_at         timestamptz,
  revoked_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_link_patient_active
  ON telegram_link(patient_id) WHERE revoked_at IS NULL;

-- Código de pareamento efêmero (uso único). Guarda apenas o HASH (SHA-256) do
-- código — nunca o código em claro (ADR-014). Busca por hash é determinística
-- (é token efêmero de pareamento, não PII médica).
CREATE TABLE IF NOT EXISTS telegram_pairing_code (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         uuid NOT NULL REFERENCES patient(id),
  created_by_user_id uuid NOT NULL REFERENCES app_user(id),
  code_hash          text NOT NULL,
  expires_at         timestamptz NOT NULL,
  consumed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pairing_code_hash ON telegram_pairing_code(code_hash);
`,
  },
  {
    name: '0007_board_synthesis',
    sql: `
-- Sínteses do board persistidas (histórico da consulta). Cada síntese do
-- Aurélio (E6) vira uma linha cifrada (NFR9) no momento em que é gerada — o
-- histórico sobrevive a restart/fim da consulta. A transcrição segue EFÊMERA
-- por minimização LGPD (retenção é a questão CJ-2); o registro permanente da
-- consulta continua sendo a nota clínica validada pelo médico (NFR10).

CREATE TABLE IF NOT EXISTS board_synthesis (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES consultation(id),
  content_enc     text NOT NULL,
  model_version   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_board_synthesis_consultation
  ON board_synthesis(consultation_id, created_at);
`,
  },
  {
    name: '0008_transcript_segment',
    sql: `
-- Transcript persistido incrementalmente (A4). Revisa a postura do 0007: um
-- deploy/restart no MEIO da consulta apagava o transcript em memória e a nota
-- clínica ficava impossível ("Sem transcrição nesta sessão" — incidente de
-- 2026-07-01). Cada segmento FINAL vira uma linha cifrada (NFR9) no momento em
-- que chega. Retenção/descarte pós-nota segue sendo a questão jurídica CJ-2.

CREATE TABLE IF NOT EXISTS transcript_segment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES consultation(id),
  seq             int NOT NULL,
  content_enc     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultation_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_transcript_segment_consultation
  ON transcript_segment(consultation_id, seq);
`,
  },
  {
    name: '0009_nutrition_report',
    sql: `
-- Relatório nutricional da consulta (E13): recordatório extraído da transcrição,
-- quantificado DETERMINISTICAMENTE pela tabela TACO. content_enc = markdown
-- editável pelo médico (cifrado, NFR9); data_enc = JSON estruturado do cálculo
-- (recordatório + itens TACO + totais) para auditoria e re-render da tabela na UI.
-- 1:1 com a consulta — regenerar sobrescreve o rascunho (mesma postura da nota E9).

CREATE TABLE IF NOT EXISTS nutrition_report (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL UNIQUE REFERENCES consultation(id),
  content_enc      text NOT NULL,
  data_enc         text,
  model_version    text,
  taco_version     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '0010_transcript_review',
    sql: `
-- Transcrição REVISADA pelo médico (Transcrição Confiável). Os finais crus do STT
-- (transcript_segment) permanecem intactos como proveniência ("o que a máquina
-- ouviu"); esta tabela guarda a versão CORRIGIDA pelo médico ("o que de fato foi
-- dito"). 1:1 com a consulta. Quando existe, é a fonte dos documentos (nota E9 +
-- relatório E13) — o médico decide o que vira registro clínico. content_enc cifrado
-- (NFR9); cada save gera trilha 'transcript-reviewed' (NFR10).
CREATE TABLE IF NOT EXISTS transcript_review (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL UNIQUE REFERENCES consultation(id),
  content_enc      text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '0011_custom_exams_body_goal',
    sql: `
-- Exames personalizados POR PACIENTE (até 3 slots — nome/unidade definidos pelo
-- médico na dashboard). O nome do exame revela condição de saúde => cifrado
-- (NFR9, sufixo _enc). custom_exams_enc = AES-256-GCM de JSON
-- [{ slot, name, unit? }]. Os VALORES vão no blob values_enc de lab_exam
-- (chaves custom1..custom3, estáveis por slot) — sem mudança de schema lá.
ALTER TABLE patient ADD COLUMN IF NOT EXISTS custom_exams_enc text;

-- Metas corporais por paciente (peso/IMC/massa/gordura/cintura/PGC), definidas
-- pelo médico e VERSIONADAS por append — mesmo padrão de nutrition_goal (a
-- vigente é a de maior effective_from <= o dia consultado; sem UPDATE
-- destrutivo). values_enc = AES-256-GCM de JSON com campos opcionais
-- { peso, imc, massaMuscular, massaGordura, cintura, pgc }.
CREATE TABLE IF NOT EXISTS body_goal (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL REFERENCES patient(id),
  set_by_user_id uuid NOT NULL REFERENCES app_user(id),
  effective_from date NOT NULL,
  values_enc     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_body_goal_patient
  ON body_goal(patient_id, effective_from DESC);
`,
  },
  {
    name: '0012_totp_2fa',
    sql: `
-- Verificação em duas etapas (TOTP) do login do médico. Opcional por padrão
-- (totp_enabled=false) — não quebra logins existentes. O secret revela o segundo
-- fator => cifrado (NFR9, AES-256-GCM base32 do secret).
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS totp_secret_enc text;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;
`,
  },
  {
    name: '0013_soft_delete',
    sql: `
-- Edição/exclusão de medições pelo médico (feedback do piloto 2026-07-15).
-- SOFT-delete: a linha permanece para trilha/retensão (parecer jurídico CJ-2
-- pendente); deleted_at marca a exclusão e o audit_log registra quem/quando.
ALTER TABLE body_composition ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE lab_exam         ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
`,
  },
  {
    name: '0014_consultation_telemetry',
    sql: `
-- Telemetria agregada persistida por consulta (E10): o registry em memória
-- morria a cada deploy e cegava a investigação de relatos do piloto (15/07).
-- SEM conteúdo clínico — só contadores/durações (NFR9 ok, sem cifra).
-- report = ConsultationReport pronto (JSONB) — a fonte do painel; colunas
-- planas só para agregação SQL.
CREATE TABLE IF NOT EXISTS consultation_telemetry (
  consultation_id uuid PRIMARY KEY REFERENCES consultation(id),
  started_at      timestamptz,
  ended_at        timestamptz,
  llm_calls       integer NOT NULL DEFAULT 0,
  llm_input_tokens  bigint NOT NULL DEFAULT 0,
  llm_output_tokens bigint NOT NULL DEFAULT 0,
  stt_segments    integer NOT NULL DEFAULT 0,
  contributions_delivered integer NOT NULL DEFAULT 0,
  case_state_updates      integer NOT NULL DEFAULT 0,
  report          jsonb NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '0015_patient_profession',
    sql: `
-- Profissão do paciente (pedido do piloto). PII => cifrada (NFR9); opcional,
-- espelho de goal_enc.
ALTER TABLE patient ADD COLUMN IF NOT EXISTS profession_enc text;
`,
  },
  {
    name: '0016_consultation_record',
    sql: `
-- Prontuário manual da consulta: Conduta + Anotações do médico. 1:1 com a
-- consulta, ambos opcionais (o médico preenche um sem o outro). 100% manual —
-- nenhum campo é gerado por IA ("IA assiste, médico decide"). Cifrado (NFR9);
-- cada save gera trilha 'consultation-record-edit' (NFR10).
CREATE TABLE IF NOT EXISTS consultation_record (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL UNIQUE REFERENCES consultation(id),
  conduct_enc      text,
  annotations_enc  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '0017_patient_lifecycle',
    sql: `
-- Briefing do piloto (2026-07-19): ciclo de vida do paciente.
-- deleted_at: SOFT-delete do paciente (mesmo padrão de 0013 — a linha fica
-- para trilha/retensão até o parecer CJ-2; o audit_log registra quem/quando).
-- height_cm_enc: altura informada pelo médico — dado clínico => cifrado (NFR9);
-- quando ausente, o dashboard segue derivando de peso+IMC da bioimpedância.
-- photo_enc: foto do paciente (base64 pequena) — PII => cifrada; opcional.
ALTER TABLE patient ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE patient ADD COLUMN IF NOT EXISTS height_cm_enc text;
ALTER TABLE patient ADD COLUMN IF NOT EXISTS photo_enc text;
`,
  },
];
