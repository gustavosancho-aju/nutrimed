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
];
