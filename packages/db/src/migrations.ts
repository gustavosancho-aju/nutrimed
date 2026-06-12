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
];
