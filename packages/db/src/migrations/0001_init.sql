-- Migration 0001 — Modelo de dados base (Story 1.3)
-- Entidades base: app_user, consultation, consent, audit_log (architecture.md §8).
-- Idempotente (IF NOT EXISTS). Reaplicável do zero. gen_random_uuid() é nativo (PG13+).
-- Criptografia em REPOUSO de dados sensíveis é feita em nível de aplicação (AES-256-GCM,
-- @nutrimed/crypto): colunas com sufixo `_enc` guardam apenas ciphertext base64 — NFR9.

-- USER (nutrólogo). "user" é palavra reservada no Postgres → tabela `app_user`.
CREATE TABLE IF NOT EXISTS app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- CONSULTATION — conduzida por um USER. `patient_label_enc` é PII/dado de saúde
-- cifrado em repouso (AES-256-GCM); o banco nunca vê o valor em claro.
CREATE TABLE IF NOT EXISTS consultation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES app_user(id),
  patient_label_enc  text NOT NULL,
  status             text NOT NULL DEFAULT 'open',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consultation_user_id ON consultation(user_id);

-- CONSENT — relação 1:1 com CONSULTATION (UNIQUE em consultation_id).
-- Fundação do Consent Service (lógica de gate fica na Story 1.4).
CREATE TABLE IF NOT EXISTS consent (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL UNIQUE REFERENCES consultation(id),
  granted          boolean NOT NULL DEFAULT false,
  granted_by       uuid REFERENCES app_user(id),
  granted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- AUDIT_LOG — fundação da trilha de auditoria com proveniência (NFR10).
-- `contribution_id` fica sem FK aqui: CONTRIBUTION nasce em E4+. A lógica de
-- gravação atômica + imutabilidade (append-only) é a Story 1.5.
CREATE TABLE IF NOT EXISTS audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id  uuid,
  kb_sources       jsonb,
  model_version    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_contribution_id ON audit_log(contribution_id);

-- Follow-up: residência de dados no Brasil (LGPD) é decidida na Story 1.8 (ADR jurídico),
-- não aqui. Ref. AC7 da Story 1.3.
